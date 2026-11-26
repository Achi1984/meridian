from concurrent.futures import Future
import unittest
from unittest.mock import patch

from holder_signal import HolderSampler, TOKEN, measure, signer_address


class HolderEvidenceTests(unittest.TestCase):
    def test_owner_aggregation_with_one_slot_denominator(self):
        keys = [f'a{i}' for i in range(11)]
        def record(kind, **info):
            return dict(owner=TOKEN, data=dict(parsed=dict(type=kind, info=info)))
        def read(method, params):
            if method == 'getTokenLargestAccounts':
                return dict(context=dict(slot=21), value=[dict(address=k) for k in keys])
            self.assertEqual(params[0], ['mint', *keys])
            self.assertEqual(params[1]['minContextSlot'], 21)
            rows = [record('account', mint='mint', owner=f'w{i%10}',
                           tokenAmount=dict(amount='10')) for i in range(11)]
            return dict(context=dict(slot=22), value=[record('mint', supply='200'), *rows])
        with patch('holder_signal.signer_address', return_value=True):
            result = measure('mint', read)
            self.assertEqual(result['largestOwnerBps'], 1000)
            self.assertEqual(result['supplyRaw'], '200')
            self.assertEqual(result['largestObservedOwners'], [
                dict(owner='w0', amountRaw='20', tokenAccounts=[
                    dict(address='a0', amountRaw='10'), dict(address='a10', amountRaw='10')])])
        with patch('holder_signal.signer_address', return_value=False), self.assertRaises(ValueError):
            measure('mint', read)

    def test_token_2022_balance_coverage(self):
        from holder_signal import TOKEN_2022
        keys = [f'key{i}' for i in range(10)]
        def row(kind, **info):
            return dict(owner=TOKEN_2022, data=dict(parsed=dict(type=kind, info=info)))
        mint = row('mint', supply='100', extensions=[dict(extension='metadataPointer')])
        accounts = [row('account', mint='m', owner=k, tokenAmount=dict(amount='5'),
                        extensions=[dict(extension='immutableOwner')]) for k in keys]
        def read(method, params):
            if method == 'getTokenLargestAccounts':
                return dict(context=dict(slot=7), value=[dict(address=k) for k in keys])
            return dict(context=dict(slot=7), value=[mint, *accounts])
        with patch('holder_signal.signer_address', return_value=True):
            result = measure('m', read)
            self.assertEqual(result['largestOwnerBps'], 500)
            self.assertEqual([entry['owner'] for entry in result['largestObservedOwners']], keys)
            accounts[0]['owner'] = TOKEN
            with self.assertRaisesRegex(ValueError, 'unsupported account'):
                measure('m', read)
            accounts[0]['owner'] = TOKEN_2022
            accounts[0]['data']['parsed']['info']['extensions'] = [dict(extension='confidentialTransferAccount')]
            with self.assertRaisesRegex(ValueError, 'unsupported token extension'):
                measure('m', read)

    def test_curve_and_invalid_address(self):
        # RFC 8032 Ed25519 basepoint compressed to base58
        self.assertTrue(signer_address('6x5SYnLroiN7WYq8NQYU9KHcH4YjpBbwpUfVu3EB7ieH'))
        with self.assertRaises(ValueError):
            signer_address('malformed')

    def test_entry_cutoff_expiry_and_threshold(self):
        s = HolderSampler()
        self.addCleanup(s.pool.shutdown)
        self.assertEqual(s.at_entry('m', 2)['state'], 'unknown')
        f = s.pending['m'] = Future()
        f.set_result(dict(startedAt=1, receivedAt=3, largestOwnerBps=2000))
        self.assertEqual(s.at_entry('m', 2)['state'], 'unknown')
        self.assertEqual(s.at_entry('m', 3)['state'], 'high')
        self.assertEqual(s.at_entry('m', 122)['state'], 'unknown')

    def test_matched_accounts_after_runner_handoff(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        import newcomer_eight_hour as campaign

        clock = [1000]
        def session(**kwargs):
            if clock[0] == 1000:
                for mint, bid in [('largeLoss', 10_000_000), ('triple', 62_000_000), ('missing', 19_000_000)]:
                    row = dict(arm='wave', mint=mint, qty=100)
                    campaign.collector.emit('entry', **row)
                    campaign.collector.emit('exit', usdcRaw=bid, **row)
                    if mint == 'triple':
                        campaign.collector.emit('quotedTriple', usdcRaw=bid, **row)
            clock[0] += 14400

        with TemporaryDirectory() as tmp, patch.object(campaign.time, 'time', side_effect=lambda:clock[0]), \
                patch.object(campaign.time, 'sleep'), patch.object(campaign.collector, 'run', side_effect=session), \
                patch.object(campaign.collector, 'spot_quote', return_value=18000000), patch.object(campaign.collector, 'emit'), patch.object(HolderSampler, 'at_entry',
                    side_effect=lambda mint, at: dict(state='unknown' if mint == 'missing' else 'high')):
            path = Path(tmp)
            campaign.run(path, 1, True)
            campaign.run(path, 2, True)
            report = json.loads((path/'status.json').read_text())
            comparison = report['holderComparison']
            self.assertTrue(report['ledgerVerified'])
            self.assertEqual(report['accounts']['H']['closedTrades'], 1)
            self.assertEqual(comparison['avoidedLargeLosses'], 1)
            self.assertEqual(comparison['skippedQuotedTriples'], 1)
            self.assertEqual(comparison['realizedDeltaUsdc'], -31.8)
