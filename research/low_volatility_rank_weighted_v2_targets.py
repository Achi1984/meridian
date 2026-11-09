"""Pure target-weight adapter for the frozen Low-Volatility Rank-Weighted V2."""
from __future__ import annotations

from collections.abc import Mapping
from math import isfinite

import low_volatility_rank_weighted_v2 as v2


SCHEMA_VERSION = "MERIDIAN-LOWVOL-V2-TARGETS-V1"
INSTRUMENT_TYPE = "USD_M_PERPETUAL"
QUOTE_CURRENCY = "USDT"
EXPOSURE_TOLERANCE = 1e-12


def _integer_timestamp(value, label):
    if type(value) is not int or value < 0:
        raise ValueError(f"{label}_MUST_BE_NONNEGATIVE_INTEGER_MS")
    return value


def _validate_anchor(decision_at):
    decision_at = _integer_timestamp(decision_at, "DECISION_AT")
    if decision_at % v2.WEEK != 2 * v2.parent.DAY:
        raise ValueError("DECISION_AT_NOT_SATURDAY_00_UTC")
    return decision_at


def _validate_rows(asset, rows, decision_at):
    if not isinstance(rows, list) or len(rows) != v2.parent.FORMATION_ROWS:
        raise ValueError(f"{asset}:HOURLY_ROW_COUNT_NE_673")

    first_at = decision_at - v2.parent.FORMATION_ROWS * v2.HOUR
    validated = []
    for index, row in enumerate(rows):
        if not isinstance(row, (list, tuple)) or len(row) != 5:
            raise ValueError(f"{asset}:INVALID_HOURLY_ROW")
        timestamp = _integer_timestamp(row[0], f"{asset}_ROW_TIMESTAMP")
        expected_at = first_at + index * v2.HOUR
        if timestamp != expected_at:
            raise ValueError(f"{asset}:HOURLY_TIMESTAMP_GAP_OR_ORDER")
        close = float(row[4])
        if not isfinite(close) or close <= 0:
            raise ValueError(f"{asset}:INVALID_HOURLY_CLOSE")
        validated.append(list(row))

    if validated[-1][0] != decision_at - v2.HOUR:
        raise ValueError(f"{asset}:LAST_HOURLY_ROW_NOT_CLOSED_AT_DECISION")
    return validated


def compute_targets(decision_at, hourly_by_asset):
    """Return frozen V2 weights from exactly 673 closed hourly OHLC rows per asset.

    Rows use the frozen collector shape [open_time_ms, open, high, low, close].
    The adapter has no funding, forward-outcome, execution, or persistence input.
    """
    decision_at = _validate_anchor(decision_at)
    if not isinstance(hourly_by_asset, Mapping) or set(hourly_by_asset) != set(v2.ASSETS):
        raise ValueError("ASSET_UNIVERSE_MISMATCH")

    raw_by_asset = {
        asset: {"hourly": _validate_rows(asset, hourly_by_asset[asset], decision_at)}
        for asset in v2.ASSETS
    }
    prices = v2.parent.prepare_dataset(raw_by_asset)
    signals = {
        asset: prices[asset].lowvol_signal(decision_at)
        for asset in v2.ASSETS
    }
    weights = v2.rank_weights(signals)
    gross = sum(abs(weights[asset]) for asset in v2.ASSETS)
    net = sum(weights[asset] for asset in v2.ASSETS)
    if abs(gross - v2.GROSS_TARGET) > EXPOSURE_TOLERANCE:
        raise ValueError("GROSS_EXPOSURE_NOT_ONE")
    if abs(net) > v2.MAX_NET_ABS:
        raise ValueError("NET_EXPOSURE_NOT_ZERO")

    return {
        "schemaVersion": SCHEMA_VERSION,
        "ruleset": v2.RULESET,
        "instrumentType": INSTRUMENT_TYPE,
        "quoteCurrency": QUOTE_CURRENCY,
        "decisionAt": decision_at,
        "targets": [
            {
                "asset": asset,
                "symbol": f"{asset}{QUOTE_CURRENCY}",
                "weight": weights[asset],
            }
            for asset in v2.ASSETS
        ],
        "grossExposure": gross,
        "netExposure": net,
        "researchOnly": True,
        "executionAuthorized": False,
        "paperAuthorized": False,
        "liveAuthorized": False,
        "autoPromotion": False,
    }
