"""Read a flat-start BTC swing signal from confirmed OKX spot sessions."""
import json
from datetime import datetime, timezone
from math import isfinite
from subprocess import check_output

from regime_breakout import regime
from swing_indicators import DailyIndicators, confirmed_entry_target

DAY_MS = 86400000
URL = "https://eea.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1Dutc&limit=100"


def observe(rows, today):
    sessions = {}
    for row in rows:
        if row[8] == "0":
            continue
        stamp = int(row[0])
        close, low, high = map(float, (row[4], row[3], row[2]))
        if (row[8] != "1" or stamp % DAY_MS or stamp >= today or stamp in sessions
                or not all(isfinite(v) for v in (close, low, high)) or not 0 < low <= close <= high):
            raise ValueError("invalid confirmed session")
        sessions[stamp] = close, low, high
    dates = sorted(sessions)
    if (len(dates) < 60 or dates[-1] != today - DAY_MS or
            any(b - a != DAY_MS for a, b in zip(dates, dates[1:]))):
        raise ValueError("missing or stale BTC sessions")
    indicator = DailyIndicators()
    closes = []
    for stamp in dates:
        close, low, high = sessions[stamp]
        indicator.update(close, (low, high))
        closes.append(close)
    trend = regime(closes[-60:])
    macd = indicator.votes["macd"]
    target = confirmed_entry_target(0, trend, trend if trend == macd else 0)
    return {"strategy": "grid_macd_1_base", "source": "OKX BTC-USDT spot",
            "lastSessionUtc": datetime.fromtimestamp(dates[-1]/1000, timezone.utc).date().isoformat(),
            "sessions": len(dates), "trend": trend, "macd": macd,
            "flatStartSignal": {-1: "SHORT", 0: "FLAT", 1: "LONG"}[target]}


def load_candles():
    payload = json.loads(check_output(["curl", "--fail", "--silent", "--show-error", "--retry", "2",
                                       "--max-time", "20", URL]))
    if payload["code"] != "0":
        raise ValueError("OKX candles unavailable")
    return payload["data"]


if __name__ == "__main__":
    today = int(datetime.now(timezone.utc).timestamp()) // 86400 * DAY_MS
    print(json.dumps(observe(load_candles(), today)))
