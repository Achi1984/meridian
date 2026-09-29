import importlib.util, os, tempfile, unittest, zipfile
from pathlib import Path

os.environ["QH_ASSET"]="SOLUSDT"
os.environ["QH_MONTH"]="2025-07"
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"scripts"/"audit-qh-individual-trades-data-v1-1-shard.py"
spec=importlib.util.spec_from_file_location("qh_trades_v11",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def write_zip(path,name,rows):
    with zipfile.ZipFile(path,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(name,"\n".join(rows)+"\n")

class DataV11Tests(unittest.TestCase):
    def setUp(self):
        self.orig=(m.MONTH_START_MS,m.MONTH_END_MS,m.EXPECTED_MINUTES,m.EXPECTED_QH_BINS)
        m.MONTH_START_MS=1_751_328_000_000
        m.MONTH_END_MS=m.MONTH_START_MS+30*60_000
        m.EXPECTED_MINUTES=30
        m.EXPECTED_QH_BINS=2
    def tearDown(self):
        m.MONTH_START_MS,m.MONTH_END_MS,m.EXPECTED_MINUTES,m.EXPECTED_QH_BINS=self.orig

    def test_trade_schema_allows_id_gaps_but_counts_them(self):
        s=m.MONTH_START_MS
        rows=[
          "id,price,qty,quote_qty,time,is_buyer_maker",
          f"10,100,2,200,{s+1},true",
          f"12,101,1,101,{s+15*60_000+1},false"
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows);r=m.audit_trades(p)
        self.assertEqual(r["rows"],2)
        self.assertTrue(r["tradeIdsStrictlyIncreasing"])
        self.assertEqual(r["tradeIdGapEvents"],1)
        self.assertEqual(r["missingTradeIdCount"],1)
        self.assertEqual(r["maxMissingIdsInSingleGap"],1)
        self.assertEqual(r["emptyQuarterHourBins"],0);self.assertTrue(r["coveragePass"])
        self.assertNotIn("buy", "".join(r.keys()).lower())
        self.assertNotIn("sell", "".join(r.keys()).lower())

    def test_larger_trade_gap_is_diagnostic_not_data_loss_by_itself(self):
        s=m.MONTH_START_MS
        rows=[
          f"10,100,1,100,{s+1},true",
          f"15,100,1,100,{s+15*60_000+1},false"
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows);r=m.audit_trades(p)
        self.assertEqual(r["tradeIdGapEvents"],1)
        self.assertEqual(r["missingTradeIdCount"],4)
        self.assertEqual(r["maxMissingIdsInSingleGap"],4)

    def test_trade_duplicate_fails_closed(self):
        s=m.MONTH_START_MS
        rows=[f"10,100,1,100,{s+1},true",f"10,100,1,100,{s+2},false"]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows)
            with self.assertRaisesRegex(RuntimeError,"not strictly increasing"):m.audit_trades(p)

    def test_quote_consistency_fails_closed(self):
        s=m.MONTH_START_MS
        rows=[f"10,100,2,199,{s+1},true"]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows)
            with self.assertRaisesRegex(RuntimeError,"quoteQty inconsistent"):m.audit_trades(p)

    def test_timestamp_must_not_decrease(self):
        s=m.MONTH_START_MS
        rows=[f"10,100,1,100,{s+2},true",f"11,100,1,100,{s+1},false"]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows)
            with self.assertRaisesRegex(RuntimeError,"timestamp decreased"):m.audit_trades(p)

    def test_buyer_maker_strict(self):
        s=m.MONTH_START_MS
        rows=[f"10,100,1,100,{s+1},UNKNOWN"]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows)
            with self.assertRaisesRegex(ValueError,"invalid Boolean"):m.audit_trades(p)


    def test_cross_source_reconciliation_passes_on_count_and_volume_match(self):
        trades={"rows":3,"baseVolumeSum":4.5,"quoteVolumeSum":450.0}
        klines={"reportedTradeCount":3,"baseVolumeSum":4.5,"quoteVolumeSum":450.0}
        r=m.cross_source_reconciliation(trades,klines)
        self.assertTrue(r["pass"])
        self.assertTrue(r["tradeCountMatches"])
        self.assertTrue(r["baseVolumeMatches"])
        self.assertTrue(r["quoteVolumeMatches"])

    def test_cross_source_reconciliation_fails_on_missing_market_trade(self):
        trades={"rows":2,"baseVolumeSum":3.5,"quoteVolumeSum":350.0}
        klines={"reportedTradeCount":3,"baseVolumeSum":4.5,"quoteVolumeSum":450.0}
        r=m.cross_source_reconciliation(trades,klines)
        self.assertFalse(r["pass"])
        self.assertFalse(r["tradeCountMatches"])

    def test_source_url_is_individual_trades(self):
        self.assertEqual(m.source_url("trades"),
          "https://data.binance.vision/data/futures/um/monthly/trades/SOLUSDT/SOLUSDT-trades-2025-07.zip")

    def test_timestamp_units_explicit(self):
        ms=1_751_328_000_123;us=1_751_328_000_123_456
        self.assertEqual(m.ts_ms(ms),(ms,"MILLISECOND"))
        self.assertEqual(m.ts_ms(us),(1_751_328_000_123,"MICROSECOND"))

if __name__=="__main__":unittest.main()
