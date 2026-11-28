"""Forward paper cohort, 28 Nov to 12 Dec UTC. Uses only public OKX data."""
import json
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

START = 1795881600000  # 2026-11-28 16:00 UTC
BAR = 14_400_000
END = START + 14 * 86_400_000
COINS = "BTC ETH SOL XRP DOGE ADA AVAX LINK SUI LTC".split()
FEE, SLIP = 0.0005, 0.0005


def read(path, **params):
    url = "https://www.okx.com/api/v5/" + path + "?" + urlencode(params)
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "Meridian-paper/1"}), timeout=20) as reply:
                result = json.load(reply)
            if result["code"] != "0":
                raise ValueError(result["code"])
            return result["data"]
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def history(symbol, now):
    candles = {}
    cursor = now
    while cursor > START - 360 * BAR:
        rows = read("market/history-candles", instId=symbol, bar="4H", after=cursor, limit=100)
        if not rows:
            break
        for t, o, h, l, c, *rest in rows:
            if rest[-1] == "1" and int(t) + BAR <= now:
                candles[int(t)] = tuple(map(float, (o, h, l, c)))
        oldest = min(int(r[0]) for r in rows)
        if oldest >= cursor:
            raise ValueError("pagination")
        cursor = oldest
    if not candles or max(candles) + 2 * BAR <= now:
        raise ValueError(symbol + " missing recent candles")
    return candles


def evaluate(series, rates, filtered, now):
    cash = 1000.0
    positions, pending = {}, {}
    closed = 0
    times = sorted({t for candles in series.values() for t in candles if START <= t < END})
    marked = cash
    for t in times:
        for sym, bars in series.items():
            if t not in bars:
                raise ValueError(sym + " missing cohort candle")
            o, high, low, close = bars[t]
            if sym in positions:
                entry, stop, qty = positions[sym]
                for stamp, rate in rates[sym]:
                    if stamp == t:
                        cash += qty * o * rate
            if sym in pending:
                stop = pending.pop(sym)
                entry = o * (1 - SLIP)
                if entry < stop and len(positions) < 5:
                    qty = min(100 / entry, 5 / (stop - entry))
                    positions[sym] = (entry, stop, qty)
                    cash -= qty * entry * FEE
            if sym in positions:
                entry, stop, qty = positions[sym]
                target = entry - 2 * (stop-entry)
                # When both barriers are touched, assume the stop executes first.
                exit_price = max(o, stop) if high >= stop else target if low <= target else None
                for stamp, rate in rates[sym]:
                    if t < stamp < t + BAR:
                        # Conservative intrabar funding when exit time is ambiguous.
                        if exit_price is None or rate < 0:
                            cash += qty * close * rate
                if exit_price is not None:
                    fill = exit_price * (1 + SLIP)
                    cash += qty * (entry - fill - fill * FEE)
                    closed += 1
                    del positions[sym]
                continue
            prior = [bars.get(t-i*BAR) for i in range(360, 0, -1)]
            if any(v is None for v in prior):
                continue
            level = max(v[1] for v in prior[-42:])
            # Earlier independent visit within 2%, followed by a 10% decline.
            past = prior[:-42]
            rejected = any(abs(v[1]/level-1) <= .02 and
                           min(x[2] for x in past[i+1:i+7]) <= v[1]*.90
                           for i,v in enumerate(past[:-6]))
            if high > level and close < level and close < o and (rejected or not filtered):
                pending[sym] = high
        marked = cash + sum(q*(e-series[s][t][3]) for s,(e,_,q) in positions.items())
    return {"cash":round(cash,2),"equity":round(marked,2),"closed":closed,"open":len(positions)}


def main():
    now = min(int(time.time()*1000), END)
    series, rates = {}, {}
    for coin in COINS:
        symbol = coin + "-USDT-SWAP"
        series[symbol] = history(symbol, now)
        funding = []
        cursor = now
        while cursor > START or not funding:
            batch = read("public/funding-rate-history", instId=symbol, after=cursor, limit=100)
            if not batch:
                break
            oldest = min(int(r["fundingTime"]) for r in batch)
            if oldest >= cursor:
                raise ValueError("funding pagination")
            funding.extend(batch)
            cursor = oldest
        if not funding or min(int(r["fundingTime"]) for r in funding) > START:
            raise ValueError(symbol + " funding history incomplete")
        rates[symbol] = [(int(r["fundingTime"]),float(r["realizedRate"])) for r in funding]
    phase = "planned" if now < START else "final" if now >= END else "running"
    print(json.dumps({"phase":phase,"asOf":datetime.fromtimestamp(now/1000,timezone.utc).isoformat(),
                      "historyFilter":evaluate(series,rates,True,now),
                      "control":evaluate(series,rates,False,now)}, indent=2))


if __name__ == "__main__":
    main()
