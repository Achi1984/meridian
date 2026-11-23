import gzip
import hashlib
import tempfile
import unittest
from datetime import date
from pathlib import Path

from tardis_btc_eur import FIELDS, MINUTE, normalize


class ArchiveTiming(unittest.TestCase):
    def test_decision_boundary_and_arrival_order(self):
        day = date(2026, 8, 1)
        decision = 1785571200000000
        with tempfile.TemporaryDirectory() as directory:
            def archive(kind, lines):
                path = Path(directory) / kind
                header = ','.join(FIELDS[kind].split())
                path.write_bytes(gzip.compress(('\n'.join([header, *lines]) + '\n').encode()))
                return path, hashlib.sha256(path.read_bytes()).hexdigest()

            def trade(at, received, price):
                return f'kraken,BTC/EUR,{decision+at},{decision+received},1,buy,{price},1'

            def quote(at, received, bid, ask):
                return f'kraken,BTC/EUR,{decision+at},{decision+received},1,{ask},{bid},1'

            trades, th = archive('trades', [trade(-3, -3, 7), trade(-5, -2, 8), trade(-1, 0, 99)])
            quotes, qh = archive('quotes', [quote(-1, -1, 1, 2), quote(-6000000, 0, 1, 2),
                                            quote(1, 1, 3, 2), quote(5000000, 5000000, 4, 5),
                                            quote(MINUTE, MINUTE + 5000001, 6, 7)])
            result = normalize(day, trades, quotes, th, qh)
            slot, missing = result['decisions'][:2]
            bar = result['bars'][slot['last_closed_bar']]
            self.assertEqual((bar['open'], bar['close'], bar['trades']), ('8', '7', 2))
            self.assertEqual(slot['quote']['bid_price'], '4')
            self.assertEqual((missing['quote_status'], missing['quote']), ('no_eligible_update', None))
            self.assertEqual((len(result['decisions']), len(result['bars'])), (480, 570))
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                normalize(day, trades, quotes, 'incorrect', qh)
            quotes, qh = archive('quotes', [quote(2, 2, 1, 2), quote(1, 1, 1, 2)])
            with self.assertRaisesRegex(ValueError, 'clock'):
                normalize(day, trades, quotes, th, qh)


if __name__ == '__main__':
    unittest.main()
