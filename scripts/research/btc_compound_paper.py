"""Forward-only BTC perpetual paper cohort. All OKX requests are public."""
import json
import math
import time
from pathlib import Path

from okx_rejection_paper import read

HOUR = 3600000
SYMBOL = "BTC-USDT-SWAP"
FEE = 0.0005
SLIP = 0.0003
WARMUP = 112


def account():
    return dict(balance=1000., equity=1000., peak=1000., drawdown=0., closed=0)


def cohort(now):
    first = (now + HOUR - 1) // HOUR * HOUR
    return dict(instrument=SYMBOL, version=1, start=first, cursor=first, phase="running",
                bots={side: dict(position=None, compound=account(), fixed=account(), trades=[])
                      for side in ("Long", "Short")})


def series(first, end):
    bars = {}
    cursor = end
    while cursor > first:
        rows = read("market/history-candles", instId=SYMBOL, bar="1H", after=cursor, limit=100)
        if not rows:
            raise ValueError("missing BTC history")
        for ts,o,h,l,c,*rest in rows:
            t = int(ts)
            if first <= t < end and rest[-1] == "1":
                bar = tuple(map(float,(o,h,l,c)))
                if not all(map(math.isfinite,bar)) or not 0 < bar[2] <= min(bar[0],bar[3]) <= max(bar[0],bar[3]) <= bar[1]:
                    raise ValueError("invalid candle")
                bars[t] = bar
        oldest = min(int(r[0]) for r in rows)
        if oldest >= cursor:
            raise ValueError("nonadvancing candles")
        cursor = oldest
    if sorted(bars) != list(range(first,end,HOUR)):
        raise ValueError("incomplete hourly candles")
    return bars


def funding(first, end):
    rates = {}
    cursor = end
    while cursor > first:
        rows = read("public/funding-rate-history", instId=SYMBOL, after=cursor, limit=100)
        if not rows:
            raise ValueError("incomplete funding history")
        for row in rows:
            t = int(row["fundingTime"])
            rate = float(row["realizedRate"])
            if t % HOUR or not math.isfinite(rate):
                raise ValueError("unexpected funding observation")
            rates[t] = rate
        oldest = min(int(r["fundingTime"]) for r in rows)
        if oldest >= cursor:
            raise ValueError("nonadvancing funding history")
        cursor = oldest
    return rates


def setup(history, t, sign):
    # Aggregate UTC-aligned, fully closed 4h candles. Compare adjacent 3-bar ranges.
    closed = t // (4*HOUR) * 4*HOUR
    legs = [[history[u+i*HOUR] for i in range(4)] for u in range(closed-24*HOUR,closed,4*HOUR)]
    def extremes(leg):
        return max(b[1] for group in leg for b in group), min(b[2] for group in leg for b in group)
    earlier, recent = extremes(legs[:3]), extremes(legs[3:])
    if any(sign*(b-a)<=0 for a,b in zip(earlier,recent)):
        return None, "4h-Trend fehlt"
    pull, confirm = history[t-2*HOUR], history[t-HOUR]
    if sign*(pull[3]-pull[0]) >= 0:
        return None, "Wartet auf Rücksetzer"
    if sign*(confirm[3]-pull[1 if sign==1 else 2]) <= 0:
        return None, "Bestätigung fehlt"
    stop = min(pull[2],confirm[2]) if sign==1 else max(pull[1],confirm[1])
    return stop, "Signal bestätigt"


def trail(history,t,sign):
    window = [history[u] for u in range(t-22*HOUR,t+HOUR,HOUR)]
    atr = sum(max(h-l,abs(h-prev[3]),abs(l-prev[3])) for prev,(_,h,l,_) in zip(window,window[1:])) / 22
    return (max(b[1] for b in window[1:])-3*atr if sign==1
            else min(b[2] for b in window[1:])+3*atr)


def step(bot, history, t, sign, rate):
    o,h,l,c = history[t]
    p = bot["position"]
    if p:
        reason = "Position gehalten"
        p["fundingPerBTC"] -= sign*o*rate
    else:
        stop, reason = setup(history,t,sign)
        entry = o*(1+sign*SLIP)
        if stop is not None and sign*(o-stop)<=0:
            reason = "Eröffnung jenseits des Stops"
        elif stop is not None:
            stop_fill = stop*(1-sign*SLIP)
            unit = sign*(entry-stop_fill) + FEE*(entry+stop_fill)
            qty = {k:min((a["balance"]*.005 if k=="compound" else 5)/unit,
                         a["balance"]/entry) for k,a in ((k,bot[k]) for k in ("compound","fixed"))}
            reason = "Risikobudget erschöpft"
            if min(qty.values())>0:
                reason = "Position eröffnet"
                p = bot["position"] = dict(at=t,entry=entry,stop=stop,qty=qty,fundingPerBTC=0.)
    hit = p and (l<=p["stop"] if sign==1 else h>=p["stop"])
    if p:
        price = (min(o,p["stop"]) if sign==1 else max(o,p["stop"])) if hit else c
        fill = price*(1-sign*SLIP)
        per_btc = sign*(fill-p["entry"])-FEE*(fill+p["entry"])+p["fundingPerBTC"]
        for k,q in p["qty"].items():
            a = bot[k]
            a["equity"] = a["balance"]+q*per_btc
            a["peak"] = max(a["peak"],a["equity"])
            a["drawdown"] = max(a["drawdown"],1-a["equity"]/a["peak"])
            if hit:
                a["balance"] = a["equity"]
                a["closed"] += 1
        if hit:
            bot["trades"].append(dict(entryBar=p["at"],exitBar=t,entry=p["entry"],exit=fill,
                                      fees={k:q*FEE*(fill+p["entry"]) for k,q in p["qty"].items()},
                                      funding={k:q*p["fundingPerBTC"] for k,q in p["qty"].items()},
                                      net={k:q*per_btc for k,q in p["qty"].items()}))
            reason = "Am Stop geschlossen"
            bot["position"] = None
        else:
            level = trail(history,t,sign)
            p["stop"] = max(p["stop"],level) if sign==1 else min(p["stop"],level)
    bot["decision"] = {"closeMs": t+HOUR, "reason": reason}


def main():
    now = int(time.time()*1000)
    end = now//HOUR*HOUR
    path = Path("previous.json")
    report = json.loads(path.read_text()) if path.exists() else cohort(now)
    if report["instrument"] != SYMBOL or report["version"] != 1:
        raise ValueError("incompatible cohort")
    first = report["cursor"]
    # Validate the feed on startup as well. Old bars are warmup only.
    bars = series(min(first,end)-WARMUP*HOUR,end)
    rates = funding(first,end) if first<end else {}
    for t in range(first,end,HOUR):
        for side,sign in (("Long",1),("Short",-1)):
            step(report["bots"][side],bars,t,sign,rates.get(t,0))
        report["cursor"] = t+HOUR
    report["asOf"] = now
    print(json.dumps(report,allow_nan=False))


if __name__=="__main__":
    main()
