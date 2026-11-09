#!/usr/bin/env python3
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "research"))

import low_volatility_rank_weighted_v2 as v2
from low_volatility_rank_weighted_v2_targets import (
    INSTRUMENT_TYPE,
    QUOTE_CURRENCY,
    SCHEMA_VERSION,
    compute_targets,
)


def fixture_rows(decision_at, group_by_asset=None):
    group_by_asset = group_by_asset or {
        asset: index // 2 + 1 for index, asset in enumerate(v2.ASSETS)
    }
    first_at = decision_at - v2.parent.FORMATION_ROWS * v2.HOUR
    result = {}
    for asset in v2.ASSETS:
        scale = group_by_asset[asset]
        rows = []
        close = 100.0
        rows.append([first_at, close, close, close, close])
        for index in range(1, v2.parent.FORMATION_ROWS):
            step = ((index % 7) - 3) * 0.0001 * scale
            close *= math.exp(step)
            timestamp = first_at + index * v2.HOUR
            rows.append([timestamp, close, close, close, close])
        result[asset] = rows
    return result


class LowVolRankWeightedV2TargetTests(unittest.TestCase):
    def setUp(self):
        self.decision_at = v2.DEVELOPMENT_START
        self.hourly_by_asset = fixture_rows(self.decision_at)

    def test_targets_match_frozen_feature_and_weight_functions(self):
        raw = {
            asset: {"hourly": self.hourly_by_asset[asset]}
            for asset in v2.ASSETS
        }
        prices = v2.parent.prepare_dataset(raw)
        signals = {
            asset: prices[asset].lowvol_signal(self.decision_at)
            for asset in v2.ASSETS
        }
        expected_weights = v2.rank_weights(signals)

        result = compute_targets(self.decision_at, self.hourly_by_asset)
        self.assertEqual(
            {target["asset"]: target["weight"] for target in result["targets"]},
            expected_weights,
        )
        self.assertEqual(compute_targets(self.decision_at, self.hourly_by_asset), result)
        self.assertEqual([x["asset"] for x in result["targets"]], list(v2.ASSETS))
        self.assertAlmostEqual(result["grossExposure"], 1.0, delta=1e-12)
        self.assertAlmostEqual(result["netExposure"], 0.0, delta=1e-12)

    def test_output_binds_frozen_identity_without_execution_authority(self):
        result = compute_targets(self.decision_at, self.hourly_by_asset)
        self.assertEqual(result["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(result["ruleset"], v2.RULESET)
        self.assertEqual(result["instrumentType"], INSTRUMENT_TYPE)
        self.assertEqual(result["quoteCurrency"], QUOTE_CURRENCY)
        self.assertEqual(result["decisionAt"], self.decision_at)
        self.assertEqual(
            [target["symbol"] for target in result["targets"]],
            [f"{asset}USDT" for asset in v2.ASSETS],
        )
        self.assertTrue(result["researchOnly"])
        self.assertFalse(result["executionAuthorized"])
        self.assertFalse(result["paperAuthorized"])
        self.assertFalse(result["liveAuthorized"])
        self.assertFalse(result["autoPromotion"])

    def test_equal_non_degenerate_signals_keep_frozen_average_rank_ties(self):
        result = compute_targets(self.decision_at, self.hourly_by_asset)
        weights = {target["asset"]: target["weight"] for target in result["targets"]}
        for index in range(0, len(v2.ASSETS), 2):
            self.assertEqual(weights[v2.ASSETS[index]], weights[v2.ASSETS[index + 1]])

    def test_degenerate_cross_section_fails_like_frozen_weighting(self):
        same_signal = fixture_rows(
            self.decision_at, {asset: 1 for asset in v2.ASSETS}
        )
        with self.assertRaisesRegex(ValueError, "DEGENERATE_RANK_CROSS_SECTION"):
            compute_targets(self.decision_at, same_signal)

    def test_exact_universe_required(self):
        missing = dict(self.hourly_by_asset)
        del missing[v2.ASSETS[0]]
        with self.assertRaisesRegex(ValueError, "ASSET_UNIVERSE_MISMATCH"):
            compute_targets(self.decision_at, missing)
        extra = dict(self.hourly_by_asset)
        extra["EXTRA"] = self.hourly_by_asset[v2.ASSETS[0]]
        with self.assertRaisesRegex(ValueError, "ASSET_UNIVERSE_MISMATCH"):
            compute_targets(self.decision_at, extra)

    def test_saturday_midnight_anchor_required(self):
        with self.assertRaisesRegex(ValueError, "DECISION_AT_NOT_SATURDAY_00_UTC"):
            compute_targets(self.decision_at + v2.HOUR, self.hourly_by_asset)
        with self.assertRaisesRegex(ValueError, "DECISION_AT_MUST_BE_NONNEGATIVE_INTEGER_MS"):
            compute_targets(float(self.decision_at), self.hourly_by_asset)

    def test_exactly_673_ordered_contiguous_rows_ending_at_prior_hour_required(self):
        too_short = dict(self.hourly_by_asset)
        too_short[v2.ASSETS[0]] = too_short[v2.ASSETS[0]][1:]
        with self.assertRaisesRegex(ValueError, "HOURLY_ROW_COUNT_NE_673"):
            compute_targets(self.decision_at, too_short)

        for mutation in ("duplicate", "unsorted", "gap", "future"):
            rows = {
                asset: [list(row) for row in values]
                for asset, values in self.hourly_by_asset.items()
            }
            if mutation == "duplicate":
                rows[v2.ASSETS[0]][10][0] = rows[v2.ASSETS[0]][9][0]
            elif mutation == "unsorted":
                rows[v2.ASSETS[0]][10], rows[v2.ASSETS[0]][11] = (
                    rows[v2.ASSETS[0]][11], rows[v2.ASSETS[0]][10]
                )
            elif mutation == "gap":
                rows[v2.ASSETS[0]][10][0] += v2.HOUR
            else:
                rows[v2.ASSETS[0]][-1][0] = self.decision_at
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(ValueError, "HOURLY_TIMESTAMP_GAP_OR_ORDER"):
                    compute_targets(self.decision_at, rows)

    def test_close_must_be_finite_and_positive(self):
        for close in (0, -1, float("nan"), float("inf"), "not-a-price"):
            rows = {asset: [list(row) for row in values]
                    for asset, values in self.hourly_by_asset.items()}
            rows[v2.ASSETS[0]][10][4] = close
            with self.subTest(close=close):
                with self.assertRaises(ValueError):
                    compute_targets(self.decision_at, rows)

    def test_exact_five_column_ohlc_row_shape_required(self):
        rows = {asset: [list(row) for row in values]
                for asset, values in self.hourly_by_asset.items()}
        rows[v2.ASSETS[0]][10].append("unexpected")
        with self.assertRaisesRegex(ValueError, "INVALID_HOURLY_ROW"):
            compute_targets(self.decision_at, rows)

    def test_invalid_frozen_engine_open_is_rejected(self):
        rows = {asset: [list(row) for row in values]
                for asset, values in self.hourly_by_asset.items()}
        rows[v2.ASSETS[0]][10][1] = 0
        with self.assertRaisesRegex(ValueError, "NONPOSITIVE_PRICE"):
            compute_targets(self.decision_at, rows)


if __name__ == "__main__":
    unittest.main()
