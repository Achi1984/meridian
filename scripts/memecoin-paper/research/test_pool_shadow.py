import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import new_pool_watch as watch
from pool_shadow import LIMIT, Shadow, compare


class ShadowTests(unittest.TestCase):
    def test_scanner_still_records_exit_when_model_skips_or_fails(self):
        mint='1'*32
        pool='2'*32
        clock=[100000]
        def response(*args):
            price=1 if clock[0]==100000 else 1.2
            return {'data':[{'id':'solana_'+pool,'attributes':{
                'address':pool,'pool_created_at':'2026-11-20T00:00:00Z','base_token_price_usd':price,
                'reserve_in_usd':12000,'volume_usd':{'m5':4000},'transactions':{'m5':{'buys':7,'sells':4}}},
                'relationships':{role:{'data':{'id':'solana_'+addr}} for role,addr in
                                 [('base_token',mint),('quote_token',watch.WSOL)]}}]}
        for failure in (False,True):
            clock[0]=100000
            with TemporaryDirectory() as folder, patch.dict('os.environ',ANTHROPIC_API_KEY='unit-test'), \
                 patch.object(watch,'get',side_effect=response), \
                 patch.object(watch,'quote',side_effect=[2000,19800000,19000000]), \
                 patch.object(watch.time,'time',side_effect=lambda:clock[0]), \
                 patch.object(watch.time,'monotonic',side_effect=lambda:clock[0]), \
                 patch.object(watch.time,'sleep',side_effect=lambda s:clock.__setitem__(0,clock[0]+s)), \
                 patch('pool_shadow.ask', side_effect=OSError if failure else None,
                       return_value=dict(vote='SKIP',usage={})) as api:
                watch.run(Path(folder),9,claude=True)
                events=[json.loads(l) for l in (Path(folder)/'events.jsonl').read_text().splitlines()]
                report=compare(events)
                self.assertEqual(api.call_count,1)
                self.assertEqual(report['priced'],1)
                if failure:
                    self.assertEqual(report['pairedPriced'],0)
                    self.assertIsNone(report['differenceBeforeApiCostsUsd'])
                else:
                    self.assertAlmostEqual(report['differenceBeforeApiCostsUsd'],1.10)
                    vote=next(e for e in events if e['event']=='shadowVote')
                    events.remove(vote)
                    with self.assertRaises(ValueError):
                        compare(events+[vote])

    def test_no_historical_votes_and_unpriced_separate(self):
        r=compare([dict(event='paperProbe',mint='a'),dict(event='unresolvedAtEnd',mint='a')])
        self.assertEqual(r['unpriced'],1)
        self.assertIsNone(r['scannerPairedUsd'])

    def test_attempt_limit_counts_failures(self):
        with patch.dict('os.environ',ANTHROPIC_API_KEY='unit-test'), patch('pool_shadow.ask',side_effect=OSError) as api:
            s=Shadow(True)
            for _ in range(LIMIT+2):
                s.record('a',{},lambda *args,**kwargs:None)
            self.assertEqual(api.call_count,LIMIT)
