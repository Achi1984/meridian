import unittest
from exit_warning_replay import replay


class ExitWarningTests(unittest.TestCase):
    def test_next_full_size_quote_only(self):
        fill=dict(account='C',qty=10,positionId='p')
        rows=[dict(event='entry',positionId='p',at=0,fills=[dict(fill,side='buy',usdcRaw=20000000)])]
        for at,qty,bid in [(1,10,17000000),(1,10,19000000),(2,5,11000000),(3,10,18000000)]:
            rows.append(dict(event='resaleMark',positionId='p',at=at,qty=qty,usdcRaw=bid,fills=[]))
        rows.append(dict(event='exit',positionId='p',at=4,fills=[dict(fill,side='sell',usdcRaw=16000000)]))
        self.assertEqual(replay(rows)['netChangeUsdc'],2)
