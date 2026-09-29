import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from quarter_hour_order_flow_v1_data_v1 import (
    RULESET,ASSETS,month_range,frozen_counts,parse_checksum,
    validate_agg_csv,parse_funding_csv,agg_monthly_url,funding_monthly_url
)

class QuarterHourDataV1Tests(unittest.TestCase):
    def test_frozen_identity_counts_and_universe(self):
        self.assertEqual(RULESET,"QUARTER-HOUR-ORDER-FLOW-V1-DATA-V1-FROZEN")
        self.assertEqual(ASSETS,("BTC","ETH","XRP","SOL","DOGE","ADA"))
        self.assertEqual(month_range()[0],"2025-01")
        self.assertEqual(month_range()[-1],"2026-08")
        self.assertEqual(frozen_counts(),{
            "assets":6,"months":20,"assetMonths":120,
            "aggSentinels":12,"fundingSentinels":12
        })

    def test_archive_urls_are_usdm_public_archives(self):
        self.assertEqual(
          agg_monthly_url("BTC","2025-01"),
          "https://data.binance.vision/data/futures/um/monthly/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2025-01.zip"
        )
        self.assertEqual(
          funding_monthly_url("ADA","2026-08"),
          "https://data.binance.vision/data/futures/um/monthly/fundingRate/ADAUSDT/ADAUSDT-fundingRate-2026-08.zip"
        )

    def test_checksum_requires_exact_archive_name(self):
        d="a"*64
        self.assertEqual(parse_checksum(d+"  BTCUSDT-aggTrades-2025-01.zip","BTCUSDT-aggTrades-2025-01.zip"),d)
        with self.assertRaises(ValueError):
            parse_checksum(d+"  ETHUSDT-aggTrades-2025-01.zip","BTCUSDT-aggTrades-2025-01.zip")

    def test_agg_schema_header_and_monotonicity(self):
        text=(
          "agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker\n"
          "10,100.0,2.5,20,21,1736899200001,false\n"
          "11,100.1,1.0,22,22,1736899201000,true\n"
        )
        r=validate_agg_csv(text,"2025-01-15")
        self.assertEqual(r["rows"],2)
        self.assertEqual(r["firstAggId"],10)
        self.assertEqual(r["lastAggId"],11)

    def test_agg_rejects_duplicate_id_or_microsecond_timestamp(self):
        dup=(
          "10,100,1,20,20,1736899200001,false\n"
          "10,101,1,21,21,1736899201000,true\n"
        )
        with self.assertRaises(ValueError):
            validate_agg_csv(dup,"2025-01-15")
        micro="10,100,1,20,20,1736899200001000,false\n"
        with self.assertRaises(ValueError):
            validate_agg_csv(micro,"2025-01-15")

    def test_funding_schema_header(self):
        text=(
          "calc_time,funding_interval_hours,last_funding_rate\n"
          "1735718400000,8,0.0001\n"
          "1735747200000,8,-0.0002\n"
        )
        r=parse_funding_csv(text)
        self.assertEqual(r["rows"],2)
        self.assertAlmostEqual(r["lastRate"],-0.0002)

if __name__=="__main__":
    unittest.main()
