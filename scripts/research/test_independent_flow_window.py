import unittest
from unittest.mock import patch

from independent_flow_window import HOUR, signals
from spot_confirmation_audit import audit


class FlowWindowTests(unittest.TestCase):
    def test_same_signal_and_exit_timing_as_original_replay(self):
        begin, end = 0, 48*HOUR
        bars = {t:[100,101,99,100] for t in range(-25*HOUR,end,HOUR)}
        for t in (2*HOUR,30*HOUR):
            bars[t] = [100,106,99,105]
            bars[t+5*HOUR] = [102,103,99,100]
        with patch('independent_flow_window.perp_candles',return_value=bars):
            events=signals('BTC',begin,end)
        rows=[]
        for start,stop in [(begin,end//2),(end//2,end)]:
            part,missing=audit(bars,bars,start,stop)
            self.assertEqual(missing,0)
            rows.extend(part)
        self.assertEqual(len(events),2)
        for new,old in zip(events,rows):
            self.assertEqual([new[k] for k in ('at','side','grossPct')],
                             [old[k] for k in ('at','side','grossPct')])

    def test_missing_hour_invalidates_window(self):
        with patch('independent_flow_window.perp_candles',return_value={}):
            with self.assertRaisesRegex(ValueError,'incomplete OKX candles'):
                signals('BTC',0,48*HOUR)
