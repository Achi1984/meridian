"""Chronological OKX BTC-USDC spot replay of a fixed breakout/retest rule."""
import json
import os
import time
from datetime import datetime, timezone
from math import isfinite
from statistics import median

from okx_demo_preflight import NAMES, get

HOUR = 3600000
PAIR = "BTC-USDC"
HOURS = 90 * 24


def history(keys, end):
    bars = {}
    cursor = end
    start = end - HOURS * HOUR
    while cursor > start:
        rows = get("/api/v5/market/history-candles", keys, instId=PAIR,
                   bar="1H", after=str(cursor), limit="100")
        if not rows:
            break
        oldest = min(int(row[0]) for row in rows)
        if oldest >= cursor:
            raise ValueError("candle pagination stalled")
        for row in rows:
            stamp = int(row[0])
            if not start <= stamp < end or row[8] != "1":
                continue
            prices = tuple(map(float, row[1:5]))
            op, hi, lo, close = prices
            if (stamp % HOUR or not all(isfinite(x) for x in prices)
                    or not 0 < lo <= min(op, close) <= max(op, close) <= hi
                    or (stamp in bars and bars[stamp] != prices)):
                raise ValueError("invalid OHLC")
            bars[stamp] = prices
        cursor = oldest
        time.sleep(.25)
    if len(bars) != HOURS:
        raise ValueError(f"incomplete history: {len(bars)} of {HOURS} candles")
    return [bars[t] for t in range(start, end, HOUR)]


def replay(bars, start, end, retest):
    trades = []
    i = max(24, start)
    while i + 5 < end:
        level = max(b[1] for b in bars[i-24:i])
        if bars[i][3] <= level:
            i += 1
            continue
        trigger = i
        if retest:
            trigger = next((t for t in range(i+1, min(i+4, end))
                            if bars[t][2] <= level < bars[t][3]), None)
            if trigger is None:
                i += 4
                continue
        entry = trigger + 1
        exit_at = entry + 4
        if exit_at >= end:
            break
        trades.append(bars[exit_at][0] / bars[entry][0])
        i = exit_at
    return trades


def summary(trades):
    def pnl(ratio, cost):
        return 100 * (ratio * (1-cost)/(1+cost) - 1)
    net = [pnl(r, .001) for r in trades]
    return dict(closed=len(net), netUSDC=round(sum(net), 4),
                withoutBestUSDC=round(sum(net)-max(net), 4) if net else None,
                medianUSDC=round(median(net), 4) if net else None,
                stressNetUSDC=round(sum(pnl(r,.002) for r in trades),4))


if __name__ == "__main__":
    end = int(time.time()*1000)//HOUR*HOUR
    bars = history(tuple(os.environ[n] for n in NAMES), end)
    print("BTC-USDC spot · 100 USDC je Trade · Kostenmodell 10 / Stress 20 Basispunkte je Seite")
    print("Letzter Kerzenschluss UTC:", datetime.fromtimestamp(end/1000,timezone.utc).isoformat())
    for label, start, stop in (("erste 60 Tage",0,1440), ("letzte 30 Tage",1440,HOURS)):
        for arm in ("Ausbruch", "Ruecktest"):
            print(label, arm, json.dumps(summary(replay(bars,start,stop,arm=="Ruecktest"))))
