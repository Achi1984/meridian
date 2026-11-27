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
                return score(path)['trailing']
            before = replay(rows[:-1])
            self.assertEqual(before['open'], [key])
            self.assertEqual(before['realizedUsdc'], 0)
            after = replay(rows + [rows[-1]])
            self.assertEqual(after['cashUsdc'], 1002)
            self.assertEqual(after['trades'][0]['at'], 6)
            with self.assertRaisesRegex(ValueError, 'Conflicting'):
                replay(rows + [dict(rows[-1], usdcRaw=1)])
