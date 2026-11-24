import unittest
from unittest.mock import patch
from volume_momentum import Position, comparison, entry_signal, run, signed_flow

ROW = dict(mint='m', pool='p', quote='q', created='1970-01-01T00:00:00Z')


def trade(i, at, buy=True):
    return dict(id=i, attributes=dict(block_timestamp=at, from_token_address='q' if buy else 'm',
        to_token_address='m' if buy else 'q', volume_in_usd='7', tx_from_address='w'))


class VolumeMomentumTests(unittest.TestCase):
    def test_flow_deduplicates_and_rejects_truncation(self):
        buy = trade(1, '1970-01-01T00:59:20Z')
        self.assertEqual(signed_flow([buy, buy], ROW, 3540, 3600), 7)
        self.assertIsNone(signed_flow([buy]*300, ROW, 3540, 3600))

    def test_volume_and_pressure(self):
        bars = [[t, 100, 104, 99, 104, 20 if t>=3300 else 10] for t in range(1800,3600,60)]
        def fetch(url, age):
            if '/trades' in url:
                return dict(data=[trade(1,'1970-01-01T00:59:20Z')])
            return dict(meta=dict(base=dict(address='m')),data=dict(attributes=dict(ohlcv_list=bars)))
        self.assertTrue(entry_signal(ROW,3600,fetch)[0])
        bars.pop(0)
        self.assertFalse(entry_signal(ROW,3600,fetch)[0])

    def test_delayed_exit_and_missing_baseline(self):
        p = Position(ROW, 100, 20_000_000, 1000, True)
        p.observe(1060, 19_990_000, False)
        p.observe(1120, 19_990_000, False)
        self.assertIsNone(p.pending)
        p.observe(1180, 19_900_000, True)
        self.assertIsNone(p.strategy)
        p.observe(1240, 19_800_000, False)
        self.assertEqual(p.strategy,-300_000)
        p.observe(1300, 19_700_000, False)
        self.assertEqual(p.strategy_delayed,-400_000)
        p.observe(1800, 20_000_000, False)
        self.assertEqual(comparison([p])['standard']['unresolved'],1)
        self.assertEqual(comparison([p])['oneQuoteLater']['incomplete'],1)

    def test_paper_entry_gate_and_comparator_through_runner(self):
        now = [3600]
        events = []
        def scan(emit, **kwargs):
            emit('scannerSummary',asOf=3600)
            return [ROW]
        def quote(src, dst, quantity):
            return 123 if src != 'm' else 19_650_000
        with patch('volume_momentum.scan', scan), patch('volume_momentum.entry_signal',return_value=(True,{})):
            run(fetch=lambda *a: {}, quote=quote, output=lambda kind, **e: events.append((kind,e)),
                clock=lambda: now[0], sleep=lambda delay: now.__setitem__(0,now[0]+delay))
        decision=dict(events)['momentumDecision']
        self.assertFalse(decision['accepted'])
        self.assertTrue(decision['baseline'])
        report=dict(events)['momentumSummary']
        self.assertEqual(report['standard']['closed'],1)
        self.assertEqual(report['filterComparison']['avoidedLossUsdc'],.45)
