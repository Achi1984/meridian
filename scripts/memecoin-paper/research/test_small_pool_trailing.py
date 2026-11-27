import json
import tempfile
import unittest
from pathlib import Path

from small_pool_trailing import entry_cost_profile, paired_exit_detail, score


class TrailingComparisonTest(unittest.TestCase):
    def test_entry_cost_uses_initial_full_size_quote_only(self):
        usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        rows = []
        for mint, bid in [('a', 19_400_000), ('b', 19_000_000), ('c', 20_000_000)]:
            common = dict(positionId=mint, qty=12, mint=mint, provider='Jupiter')
            rows.append(dict(common, event='entry', inputRaw=20_000_000, inputMint=usdc, outputMint=mint))
            if mint == 'c':
                rows.append(dict(event='missingExitQuote'))
            rows.append(dict(common, event='resaleMark', inputRaw=12, inputMint=mint, outputMint=usdc, usdcRaw=bid))
        bands = entry_cost_profile(rows, {'a','b','c'}, {'b':-100_000, 'c':3_000_000})
        self.assertEqual(bands['upTo3Pct']['open'], 1)
        self.assertEqual(bands['over3To5Pct']['losses'], 1)
        self.assertEqual(bands['unknown']['netUsdc'], 3)

    def test_missing_quote_does_not_sell_and_first_mark_does_not_arm(self):
        key = '1:wave:mint'
        def fill(side, amount):
            return dict(account='F', side=side, positionId=key, qty=10, usdcRaw=amount)
        def row(kind, at, fills=(), **fields):
            return dict(event=kind, eventId=str(at), at=at, fills=fills, arm='wave',
                        session=1, mint='mint', positionId=key, qty=10, **fields)
        rows = [row('start', 1), row('entry', 2, [fill('buy', 20_000_000)]),
                row('resaleMark', 3, usdcRaw=40_000_000),
                row('resaleMark', 4, [fill('sell', 24_100_000)], usdcRaw=24_100_000),
                row('missingExitQuote', 5), row('resaleMark', 6, usdcRaw=22_100_000)]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            status = dict(startedAt=1, updatedAt=7, lastEvent='finished', ledgerVerified=True,
                          accounts={'F':dict(policy='smallPoolFixed', closedTrades=1,
                                             realizedUsdc=4, openPositions=[])})
            (path / 'status.json').write_text(json.dumps(status))
            def replay(events, **options):
                (path / 'events.jsonl').write_text('\n'.join(map(json.dumps, events + [row('finished', 7)])))
                return score(path, **options)
            for fields in (dict(mint='other'), dict(session=2), dict(qty=10.0)):
                with self.subTest(fields=fields), self.assertRaisesRegex(ValueError, 'exit quote'):
                    replay(rows[:-1] + [dict(rows[-1], **fields)])
            # A missing quote cannot execute a stop; recovery resets the loss sequence.
            first_loss = dict(rows[2], usdcRaw=18_100_000)
            second_loss = dict(rows[-1], usdcRaw=17_100_000)
            candidate_rows = rows[:2] + [first_loss, rows[4], second_loss]
            def guarded(sequence):
                # The recorded fixed sale closes F independently of this challenger.
                return replay(sequence + [dict(rows[3], at=7, eventId='reference')],
                              confirmed_loss_exit=True)['trailing']
            stopped = guarded(candidate_rows)
            self.assertEqual((stopped['trades'][0]['reason'], stopped['cashUsdc']), ('confirmedLoss', 997))
            for middle in (dict(rows[-1], at=3, usdcRaw=17_100_000),
                           dict(rows[-1], usdcRaw=20_100_000)):
                ready = guarded(rows[:2] + [first_loss, middle])
                self.assertEqual(ready['open'], [key])
            before = replay(rows[:-1])
            self.assertEqual(before['trailing']['open'], [key])
            self.assertEqual(before['trailing']['realizedUsdc'], 0)
            self.assertEqual(before['comparison']['bothClosed'], 0)
            self.assertEqual(before['comparison']['sharedStillOpenOnEitherSide'], 1)
            after = replay(rows + [rows[-1]])
            self.assertEqual(after['trailing']['cashUsdc'], 1002)
            self.assertEqual(after['trailing']['trades'][0]['at'], 6)
            self.assertEqual(after['comparison']['pairedTrailingMinusFixedUsdc'], -2)
            self.assertEqual(after['comparison']['bothClosed'], 1)
            pair = after['pairedExits']['trades'][0]
            self.assertEqual((pair['fixedExitAt'], pair['trailingExitAt'],
                              pair['trailingMinusFixedExitSeconds']), (4, 6, 2))
            simultaneous = replay(rows[:3] + [dict(rows[3], event='exit')])
            self.assertEqual(simultaneous['pairedExits']['trades'][0]['trailingMinusFixedExitSeconds'], 0)
            earlier = replay(rows[:3] + [dict(rows[3], fills=[]), rows[-1],
                                         dict(row('exit', 7, rows[3]['fills'], usdcRaw=24_100_000), eventId='fixed-exit')])
            self.assertEqual(earlier['pairedExits']['trades'][0]['trailingMinusFixedExitSeconds'], -1)
            with self.assertRaisesRegex(ValueError, 'Conflicting'):
                replay(rows + [dict(rows[-1], usdcRaw=1)])

    def test_skipped_winning_and_open_reference_entries(self):
        rows = []
        def record(event, fills=(), **fields):
            at = len(rows) + 1
            rows.append(dict(event=event, at=at, eventId=str(at), fills=fills, **fields))

        record('start')
        for index in range(51):
            key = f'1:wave:{index}'
            fields = dict(arm='wave', session=1, mint=str(index), positionId=key, qty=10)
            fill = dict(account='F', positionId=key, qty=10)
            record('entry', [dict(fill, side='buy', usdcRaw=20_000_000)], **fields)
            if index < 50:
                record('resaleMark', [dict(fill, side='sell', usdcRaw=24_100_000)],
                       usdcRaw=24_100_000, **fields)
        record('finished')
        fixed = dict(policy='smallPoolFixed', closedTrades=50, realizedUsdc=200,
                     openPositions=[dict(positionId=key, qty=10)])
        status = dict(startedAt=1, updatedAt=len(rows), lastEvent='finished',
                      ledgerVerified=True, accounts={'F': fixed})
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            (path / 'status.json').write_text(json.dumps(status))
            (path / 'events.jsonl').write_text('\n'.join(map(json.dumps, rows)))
            result = score(path)
        self.assertEqual(result['trailing']['skippedForCash'], 2)
        self.assertEqual(result['comparison'], dict(
            sharedEntries=49, bothClosed=0, sharedStillOpenOnEitherSide=49,
            pairedFixedNetUsdc=0, pairedTrailingNetUsdc=0, pairedTrailingMinusFixedUsdc=0,
            skippedFixedClosed=1, skippedFixedStillOpen=1, skippedFixedRealizedUsdc=4))

    def test_paired_exit_sensitivity_uses_only_joint_closures(self):
        fixed = dict(a=0, b=3_000_000, c=-1, open_in_trailing=100)
        trailing = dict(c=-1, a=1_000_000, b=1_000_000, open_in_fixed=50)
        detail = paired_exit_detail(fixed, trailing)
        self.assertEqual([trade['positionId'] for trade in detail['trades']], ['c', 'a', 'b'])
        self.assertEqual((detail['trailingBetter'], detail['fixedBetter'], detail['equal']), (1, 1, 1))
        self.assertEqual(detail['minDeltaAfterOmittingOneUsdc'], -2)
        self.assertEqual(detail['maxDeltaAfterOmittingOneUsdc'], 1)
        for subset in ({}, {'a': 1}):
            detail = paired_exit_detail(fixed, subset)
            self.assertIsNone(detail['minDeltaAfterOmittingOneUsdc'])
            self.assertIsNone(detail['maxDeltaAfterOmittingOneUsdc'])
