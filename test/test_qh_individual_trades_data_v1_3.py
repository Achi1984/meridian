import importlib.util, os, tempfile, unittest, zipfile
from pathlib import Path

os.environ["QH_ASSET"]="SOLUSDT"
os.environ["QH_MONTH"]="2025-07"
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"scripts"/"audit-qh-individual-trades-data-v1-3-shard.py"
spec=importlib.util.spec_from_file_location("qh_trades_v13",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def write_zip(path,name,rows):
    with zipfile.ZipFile(path,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(name,"\n".join(rows)+"\n")

class DataV13Tests(unittest.TestCase):
    def setUp(self):
        self.orig=(m.MONTH_START_MS,m.MONTH_END_MS,m.EXPECTED_MINUTES,m.EXPECTED_QH_BINS)
        m.MONTH_START_MS=1_751_328_000_000
        m.MONTH_END_MS=m.MONTH_START_MS+30*60_000
        m.EXPECTED_MINUTES=30
        m.EXPECTED_QH_BINS=2

    def tearDown(self):
        m.MONTH_START_MS,m.MONTH_END_MS,m.EXPECTED_MINUTES,m.EXPECTED_QH_BINS=self.orig

    def test_raw_quote_mismatch_is_diagnostic_not_hard_failure(self):
        s=m.MONTH_START_MS
        rows=[
          "id,price,qty,quote_qty,time,is_buyer_maker",
          f"10,100,2,1.9,{s+1},true",
          f"12,101,1,101,{s+15*60_000+1},false"
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows);r=m.audit_trades(p)
        self.assertEqual(r["rawQuoteQtyMismatchRows"],1)
        self.assertEqual(r["tradeIdGapEvents"],1)
        self.assertTrue(r["coveragePass"])
        self.assertAlmostEqual(r["derivedPriceTimesQtySum"],301.0)
        self.assertNotEqual(r["derivedPriceTimesQtySum"],r["rawQuoteQtySum"])

    def test_duplicate_trade_id_is_retained_as_distinct_source_record(self):
        s=m.MONTH_START_MS
        rows=[
          f"10,100,1,100,{s+1},true",
          f"10,101,2,202,{s+15*60_000+1},false"
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows);r=m.audit_trades(p)
        self.assertEqual(r["rows"],2)
        self.assertEqual(r["lastSourceRecordOrdinal"],2)
        self.assertEqual(r["tradeIdNonIncreasingEvents"],1)
        self.assertEqual(r["duplicateAdjacentTradeIdEvents"],1)
        self.assertFalse(r["tradeIdsStrictlyIncreasingDiagnostic"])
        self.assertTrue(r["coveragePass"])

    def test_timestamp_decrease_is_diagnostic_and_timestamp_binning_still_applies(self):
        s=m.MONTH_START_MS
        rows=[
          f"10,100,1,100,{s+15*60_000+2},true",
          f"11,100,1,100,{s+1},false"
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows);r=m.audit_trades(p)
        self.assertEqual(r["sourceRowTimestampDecreaseEvents"],1)
        self.assertFalse(r["sourceRowTimestampsNondecreasingDiagnostic"])
        self.assertTrue(r["coveragePass"])
        self.assertEqual(r["nonEmptyQuarterHourBins"],2)

    def test_source_record_identity_is_archive_member_plus_contiguous_ordinal(self):
        s=m.MONTH_START_MS
        rows=[
          f"20,100,1,100,{s+1},true",
          f"21,100,1,100,{s+15*60_000+1},false"
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"member.csv",rows);r=m.audit_trades(p)
        self.assertEqual(r["zipMember"],"member.csv")
        self.assertEqual(r["sourceRecordIdentityPolicy"],"ARCHIVE_SHA256_ZIP_MEMBER_DATA_ROW_ORDINAL")
        self.assertTrue(r["sourceRecordOrdinalsContiguous"])
        self.assertEqual(r["firstSourceRecordOrdinal"],1)
        self.assertEqual(r["lastSourceRecordOrdinal"],2)

    def test_buyer_maker_is_schema_validated_only(self):
        s=m.MONTH_START_MS
        rows=[f"10,100,1,100,{s+1},UNKNOWN"]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows)
            with self.assertRaisesRegex(ValueError,"invalid Boolean"):m.audit_trades(p)

    def test_empty_quarter_hour_fails_primary_coverage(self):
        s=m.MONTH_START_MS
        rows=[f"10,100,1,100,{s+1},true"]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows);r=m.audit_trades(p)
        self.assertFalse(r["coveragePass"])
        self.assertEqual(r["emptyQuarterHourBins"],1)

    def test_first_10_second_coverage_is_diagnostic(self):
        s=m.MONTH_START_MS
        rows=[
          f"10,100,1,100,{s+20_000},true",
          f"11,100,1,100,{s+15*60_000+20_000},false"
        ]
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"t.zip";write_zip(p,"t.csv",rows);r=m.audit_trades(p)
        self.assertTrue(r["coveragePass"])
        self.assertEqual(r["emptyFirst10SecondWindows"],2)

    def test_cross_source_mismatch_is_reported_not_promoted_to_pass_or_fail(self):
        trades={
          "rows":3,"baseVolumeSum":4.5,"derivedPriceTimesQtySum":450.0,
          "_minuteCounts":[1,2],"_minuteBase":[1.0,3.5],"_minuteDerivedQuote":[100.0,350.0]
        }
        klines={
          "reportedTradeCount":2,"baseVolumeSum":3.5,"quoteVolumeSum":350.0,
          "_minuteCounts":[1,1],"_minuteBase":[1.0,2.5],"_minuteQuote":[100.0,250.0]
        }
        old=m.EXPECTED_MINUTES;m.EXPECTED_MINUTES=2
        try:r=m.cross_source_diagnostics(trades,klines)
        finally:m.EXPECTED_MINUTES=old
        self.assertFalse(r["monthly"]["tradeCountMatches"])
        self.assertEqual(r["unionMismatchMinutes"],1)
        self.assertFalse(r["hardGate"])

    def test_source_url_is_individual_trades(self):
        self.assertEqual(m.source_url("trades"),
          "https://data.binance.vision/data/futures/um/monthly/trades/SOLUSDT/SOLUSDT-trades-2025-07.zip")

    def test_timestamp_units_explicit(self):
        ms=1_751_328_000_123;us=1_751_328_000_123_456
        self.assertEqual(m.ts_ms(ms),(ms,"MILLISECOND"))
        self.assertEqual(m.ts_ms(us),(1_751_328_000_123,"MICROSECOND"))

if __name__=="__main__":unittest.main()
