import importlib.util
import os
import tempfile
import unittest
import zipfile
from pathlib import Path

os.environ["QH_ASSET"]="BTCUSDT"
os.environ["QH_MONTH"]="2025-01"

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"scripts"/"audit-quarter-hour-boundary-imbalance-v1-data-v1-shard.py"
spec=importlib.util.spec_from_file_location("qh_v1_shard",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def write_zip(path, name, rows):
    with zipfile.ZipFile(path,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(name,"\n".join(rows)+"\n")


class QuarterHourDataV1ShardTests(unittest.TestCase):
    def setUp(self):
        self.orig=(m.MONTH_START_MS,m.MONTH_END_MS,m.EXPECTED_MINUTES,m.EXPECTED_QH_BINS)
        m.MONTH_START_MS=1_735_689_600_000
        m.MONTH_END_MS=m.MONTH_START_MS+30*60_000
        m.EXPECTED_MINUTES=30
        m.EXPECTED_QH_BINS=2

    def tearDown(self):
        m.MONTH_START_MS,m.MONTH_END_MS,m.EXPECTED_MINUTES,m.EXPECTED_QH_BINS=self.orig

    def test_timestamp_normalization_is_explicit(self):
        ms=1_735_689_600_123
        us=1_735_689_600_123_456
        self.assertEqual(m.normalize_timestamp_ms(ms),(ms,"MILLISECOND"))
        self.assertEqual(m.normalize_timestamp_ms(us),(1_735_689_600_123,"MICROSECOND"))

    def test_aggtrades_validates_schema_direction_field_and_qh_coverage_without_imbalance(self):
        start=m.MONTH_START_MS
        rows=[
            "agg_trade_id,price,quantity,first_trade_id,last_trade_id,timestamp,is_buyer_maker",
            f"1,100,2,10,10,{start+1},true",
            f"2,101,1,11,11,{start+15*60_000+1},false",
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"agg.zip"
            write_zip(p,"agg.csv",rows)
            r=m.audit_aggtrades(p)
        self.assertEqual(r["rows"],2)
        self.assertEqual(r["timestampUnitDetected"],"MILLISECOND")
        self.assertEqual(r["emptyQuarterHourBins"],0)
        self.assertTrue(r["coveragePass"])
        self.assertNotIn("buy", "".join(r.keys()).lower())
        self.assertNotIn("sell", "".join(r.keys()).lower())

    def test_aggtrades_rejects_bad_buyer_maker_value(self):
        start=m.MONTH_START_MS
        rows=[f"1,100,2,10,10,{start+1},UNKNOWN"]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"agg.zip"
            write_zip(p,"agg.csv",rows)
            with self.assertRaisesRegex(ValueError,"invalid boolean"):
                m.audit_aggtrades(p)

    def test_aggtrades_rejects_nonmonotonic_trade_id(self):
        start=m.MONTH_START_MS
        rows=[
            f"2,100,2,10,10,{start+1},true",
            f"2,101,1,11,11,{start+2},false",
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"agg.zip"
            write_zip(p,"agg.csv",rows)
            with self.assertRaisesRegex(RuntimeError,"not strictly increasing"):
                m.audit_aggtrades(p)

    def test_kline_requires_exact_one_minute_coverage(self):
        start=m.MONTH_START_MS
        rows=["open_time,open,high,low,close,volume,close_time,quote_volume,trades,taker_base,taker_quote,ignore"]
        for i in range(30):
            ot=start+i*60_000
            rows.append(f"{ot},100,101,99,100,10,{ot+59_999},1000,5,4,400,0")
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"k.zip"
            write_zip(p,"k.csv",rows)
            r=m.audit_klines(p)
        self.assertEqual(r["rows"],30)
        self.assertTrue(r["coveragePass"])

    def test_kline_gap_fails_closed(self):
        start=m.MONTH_START_MS
        rows=[
            f"{start},100,101,99,100,10,{start+59_999},1000,5,4,400,0",
            f"{start+120_000},100,101,99,100,10,{start+179_999},1000,5,4,400,0",
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"k.zip"
            write_zip(p,"k.csv",rows)
            with self.assertRaisesRegex(RuntimeError,"cadence gap"):
                m.audit_klines(p)

    def test_funding_accepts_header_and_reports_only_quality_metadata(self):
        start=m.MONTH_START_MS
        m.MONTH_END_MS=start+24*60*60_000
        rows=[
            "calc_time,funding_interval_hours,last_funding_rate",
            f"{start},8,0.0001",
            f"{start+8*60*60_000},8,0.0002",
            f"{start+16*60*60_000},8,-0.0001",
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"f.zip"
            write_zip(p,"f.csv",rows)
            r=m.audit_funding(p)
        self.assertEqual(r["rows"],3)
        self.assertEqual(r["maxInterEventGapHours"],8)
        self.assertTrue(r["coveragePass"])
        self.assertNotIn("return", "".join(r.keys()).lower())

    def test_source_urls_are_fixed_to_usdm_monthly_public_archives(self):
        self.assertEqual(
            m.source_url("aggTrades"),
            "https://data.binance.vision/data/futures/um/monthly/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2025-01.zip"
        )
        self.assertIn("/klines/BTCUSDT/1m/",m.source_url("klines1m"))
        self.assertIn("/fundingRate/BTCUSDT/",m.source_url("fundingRate"))


if __name__=="__main__":
    unittest.main()
