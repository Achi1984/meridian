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
        self.feed.book.side_effect=lambda:dict(self.quote,received=self.now)
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
