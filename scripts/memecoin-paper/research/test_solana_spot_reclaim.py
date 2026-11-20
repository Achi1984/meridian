import unittest
from solana_spot_reclaim import DAY, STEP, entry_signal, replay, validate


class SolanaSpotReclaimTests(unittest.TestCase):
    def test_baseline_and_unusual_volume_use_prior_completed_bars(self):
        history = [[i*STEP,100,101,99,100,5000] for i in range(12)]
        bar = [12*STEP,99,102,97,100,9000]
        self.assertTrue(entry_signal(history,bar,0))
        self.assertFalse(entry_signal(history,bar,2))
        bar[-1]=2500
        self.assertTrue(entry_signal(history,bar,0,20))
        self.assertFalse(entry_signal(history,bar,0,80))
        bar[-1]=10000
        self.assertTrue(entry_signal(history,bar,2))

    def test_next_open_entry_and_close_triggered_next_open_exit(self):
        rows = [[i*STEP,100,101,99,100,5000] for i in range(12)]
        rows += [[12*STEP,100,101,98,100,12000],[13*STEP,101,109,100,108,5000],
                 [14*STEP,106,107,105,106,5000]]
        validate(rows)
        r = replay(rows,0,DAY,2,.005)
        self.assertEqual(r['exits'],{'target':1})
        self.assertAlmostEqual(r['net'],79.95/(101*1.005)*106*.995-.05-80)
        rows[13][0]+=STEP
        rows[14][0]+=STEP
        self.assertEqual(replay(rows,0,DAY,2,.005)['trades'],0)
