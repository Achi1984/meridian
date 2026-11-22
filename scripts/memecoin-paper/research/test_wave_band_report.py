import unittest
from wave_band_report import report


class BandReportTests(unittest.TestCase):
    def test_open_trade_deducts_only_cost_of_that_arm(self):
        rows = [dict(event='cohortSelection',mint='m',band='moderate'),
                dict(event='cohort',at=10,mints=['m'])]
        rows += [dict(event='entry',mint='m',arm=a,usdc=20) for a in ('early','wave')]
        rows += [dict(event='exit',mint='m',arm='early',netUsdc=40)]
        rows += [dict(event='summary',arm=a,entries=1,closed=int(a=='early'),unresolved=int(a=='wave')) for a in ('early','wave')]
        early,wave = report([rows])
        self.assertEqual((early['triples'],early['netIfUnpricedWorthZeroUsdc']), (1,40))
        self.assertEqual(wave['waveMinusEarly']['unresolved'],1)
        self.assertIsNone(wave['waveMinusEarly']['groups']['both']['deltaUsdc'])
        self.assertEqual((wave['unresolved'],wave['netIfUnpricedWorthZeroUsdc']), (1,-20.05))

    def test_incomplete_log_rejected(self):
        with self.assertRaises(ValueError):
            report([[dict(event='cohort',at=10,mints=[])]])

    def test_holding_policies_and_winner_concentration(self):
        def run(at,policy,net):
            return [dict(event='cohort',at=at,mints=['m'],**policy),
                    dict(event='entry',mint='m',arm='early',usdc=20),
                    dict(event='exit',mint='m',arm='early',netUsdc=net),
                    dict(event='summary',arm='early',entries=1,closed=1,unresolved=0),
                    dict(event='summary',arm='wave',entries=0,closed=0,unresolved=0)]
        policy = dict(holdingPolicy='tenMinutesFromEntry')
        rows = report([run(1,{},13),run(2,policy,10),run(3,policy,-3)])
        wave = [r for r in rows if r['arm']=='wave' and r['holdingPolicy']=='tenMinutesFromEntry'][0]
        self.assertEqual(wave['waveMinusEarly']['groups']['earlyOnly'],dict(count=2,deltaUsdc=-7))
        legacy,equal = [r for r in rows if r['arm']=='early']
        self.assertIsNone(legacy['realizedWithoutBestUsdc'])
        self.assertEqual((equal['realizedUsdc'],equal['realizedWithoutBestUsdc']),(7,-3))

    def test_no_entry_with_observation_gap_counted_once_per_mint(self):
        rows = [dict(event='cohort',at=1,mints=['a','b'])]
        rows.extend([dict(event='observationUnavailable',mint='a')] * 2)
        rows.extend(dict(event='summary',arm=arm,entries=0,closed=0,unresolved=0)
                    for arm in ('early','wave'))
        pair = report([rows])[1]['waveMinusEarly']
        self.assertEqual(pair['noEntryWithObservationGap'],1)
        self.assertEqual(pair['neitherEntered'],1)
        self.assertEqual(sum(group['count'] for group in pair['groups'].values()),0)
