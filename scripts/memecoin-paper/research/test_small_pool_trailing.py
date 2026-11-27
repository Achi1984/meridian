import json
import tempfile
import unittest
from pathlib import Path

from small_pool_trailing import score


class TrailingComparisonTest(unittest.TestCase):
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
            def replay(events):
                (path / 'events.jsonl').write_text('\n'.join(map(json.dumps, events + [row('finished', 7)])))
                return score(path)
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
