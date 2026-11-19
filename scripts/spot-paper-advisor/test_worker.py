import json
import unittest
from unittest.mock import Mock
from feeds import FeedError
from worker import connect, cycle, STEP


class PaperTest(unittest.TestCase):
    def setUp(self):
        self.db=connect(':memory:','fixed-model')
        self.slot=86400
        self.now=self.slot+2
        self.feed=Mock()
        self.feed.FeedError=FeedError
        self.feed.POLICY_VERSION='test'
        self.quote=dict(bid=9999,ask=10000,bidSize=1,askSize=1,received=self.now)
        self.feed.market.side_effect=lambda _:dict(ten=[[i,1,1,1,i+1] for i in range(20)],
                                                   hour=[],book=dict(self.quote,ask=9900))
        self.feed.book.side_effect=lambda:dict(self.quote,received=self.now,bidAt=self.now,askAt=self.now)
        self.feed.decide.return_value=('BUY','Test',dict(input=200,cached=20,output=50))
    def run_slot(self):
        return cycle(self.db,self.slot,'fixed-model','test',self.feed,[1,.5,2],lambda:self.now)
    def test_new_book_restart_and_three_arms(self):
        r=self.run_slot()
        self.assertEqual(r['last']['execution'],'PAPER_BUY')
        self.assertLess(r['arms']['model']['btc'],.01)
        self.assertEqual(r['arms']['model'],r['arms']['reference'])
        self.assertEqual(r['arms']['cash']['lives'],1)
        self.assertAlmostEqual(r['apiCostEur'],.00029)
        self.assertIsNone(self.run_slot())
        self.feed.decide.assert_called_once()
        self.slot+=86400-STEP
        self.now=self.slot+3
        self.feed.market.side_effect=FeedError('INCOMPLETE_OHLC')
        r=self.run_slot()
        self.assertEqual(r['last']['execution'],'PAPER_SELL')
        self.assertEqual(r['arms']['reference']['btc'],0)
        self.assertLess(r['arms']['model']['lives'],1)
        self.feed.decide.assert_called_once()
    def test_depth_failure_then_incomplete_usage(self):
        self.quote['askSize']=.000001
        r=self.run_slot()
        self.assertEqual(r['last']['execution'],'INSUFFICIENT_ASK_SIZE')
        self.assertEqual(r['arms']['model']['lives'],1)
        self.slot+=STEP
        self.now+=STEP
        self.feed.decide.side_effect=FeedError('MODEL_INCOMPLETE',dict(input=100,cached=0,output=0))
        self.assertAlmostEqual(self.run_slot()['apiCostEur'],.00039)
    def test_model_failure_preserves_hold_and_sanitizes_diagnostics(self):
        for error, expected in [(FeedError('HTTP_403'), 'HTTP_403'), (ValueError('private'), 'UNCLASSIFIED'),
                                (FeedError('HTTP_401:private'), 'UNCLASSIFIED')]:
            self.feed.decide.side_effect = error
            report = self.run_slot()
            self.assertEqual(report['last']['reason'], f'MODEL_UNAVAILABLE: {expected}')
            self.assertEqual(report['last']['execution'], 'HOLD')
            self.assertNotIn('private', json.dumps(report))
            self.assertIsNone(report['apiCostEur'])
            self.slot += STEP
            self.now += STEP

    def test_missing_key_still_liquidates(self):
        self.run_slot()
        self.slot+=86400-STEP
        self.now=self.slot+3
        r=cycle(self.db,self.slot,'fixed-model',None,self.feed,clock=lambda:self.now)
        self.assertEqual(r['last']['execution'],'PAPER_SELL')
        self.feed.market.assert_called_once()
        self.feed.decide.assert_called_once()

    def test_book_aging_after_receipt(self):
        self.feed.book.side_effect=lambda:dict(self.quote,received=self.now-1,bidAt=self.now-5.2,askAt=self.now-2)
        self.assertEqual(self.run_slot()['last']['execution'],'NO_FRESH_BOOK')

    def test_unresolved_reservation(self):
        self.db.execute('INSERT INTO slots VALUES (?,NULL)',(self.slot-STEP,))
        self.db.commit()
        self.assertIsNone(self.run_slot()['apiCostEur'])
    def test_late_result_is_not_filled(self):
        def slow(*_):
            self.now+=91
            return 'BUY','late',dict(input=1,cached=0,output=1)
        self.feed.decide.side_effect=slow
        self.assertEqual(self.run_slot()['last']['execution'],'DECISION_WINDOW_EXPIRED')

class ChallengerTest(unittest.TestCase):
    setUp = PaperTest.setUp
    run_slot = PaperTest.run_slot
    def test_challenger_context_and_record(self):
        self.db = connect(':memory:', 'fixed-model', challenger=True)
        self.feed.market.side_effect = lambda _: dict(
            ten=[[i, 100, 101, 99, 100] for i in range(6)] + [[6, 100, 150, 95, 103]],
            book=self.quote)
        for action in ('BUY', 'HOLD', 'SELL'):
            self.feed.decide.return_value = (action, 'Test', None)
            report = self.run_slot()
            context = self.feed.decide.call_args.args[0]
            self.assertNotIn('recent', context)
            self.assertEqual(context['policy'], 'btc-eur-spot-intraday-v2')
            evidence = context['executionContext']
            self.assertEqual(evidence['priorHourHighEur'], 101)
            self.assertTrue(evidence['askCoversEntry'])
            self.assertAlmostEqual(evidence['entryBreakEvenExitBidEur'], 10000*1.001*1.005/(.999*.995))
            self.assertEqual(report['last']['execution'], {'BUY':'PAPER_BUY','HOLD':'HOLD','SELL':'PAPER_SELL'}[action])
            self.slot += STEP
            self.now += STEP

    def test_small_visible_size_is_compared_to_paper_quantity(self):
        from worker import challenger_inputs, initial
        snapshot = dict(book=dict(self.quote, askSize=.001), ten=[[i,100,101,99,100] for i in range(7)])
        self.assertFalse(challenger_inputs(snapshot, initial(), self.slot)['askCoversEntry'])

    def test_baseline_ledger_cannot_be_reopened_as_challenger(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pilot.sqlite'
            connect(path, 'fixed-model').close()
            with self.assertRaisesRegex(ValueError, 'separate challenger database'):
                connect(path, 'fixed-model', challenger=True)

    def test_cost_filter_and_position_context(self):
        self.db = connect(':memory:', 'fixed-model', cost_aware=True)
        bars = [[i, 9990, 10000, 9980, 9995] for i in range(7)]
        self.feed.market.side_effect = lambda _: dict(ten=bars, book=self.quote.copy())
        def next_slot():
            self.slot += STEP
            self.now += STEP
            return self.run_slot()
        self.assertEqual(self.run_slot()['last']['execution'], 'HOLD')
        self.feed.decide.assert_not_called()
        bars[-1][2] = 10200
        self.feed.book.side_effect = lambda: dict(self.quote, ask=10250, received=self.now,
                                                 bidAt=self.now, askAt=self.now)
        self.assertEqual(next_slot()['last']['execution'], 'HOLD')
        self.feed.book.side_effect = lambda: dict(self.quote, received=self.now, bidAt=self.now, askAt=self.now)
        bought = next_slot()
        self.assertEqual(bought['last']['execution'], 'PAPER_BUY')
        bars[-1][2] = 10000
        self.feed.decide.return_value = ('SELL', 'Exit', None)
        sold = next_slot()
        self.assertEqual(sold['last']['execution'], 'PAPER_SELL')
        context = self.feed.decide.call_args.args[0]
        self.assertEqual(context['position']['minutesHeld'], 10)
        self.assertAlmostEqual(context['position']['entryCostEur'], 1000 - bought['arms']['model']['cashEur'])
        self.assertAlmostEqual(context['position']['liquidationPnlEur'], sold['arms']['model']['cashEur']-1000)
