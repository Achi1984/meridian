"""Four closed-candle BTC retracement strategies sharing one OKX demo position."""
import base64
import json
import os
import subprocess
import time
from decimal import Decimal as D

from okx_demo_preflight import INSTRUMENT, NAMES, VenueError, check, get, request
from okx_demo_round_trip import SIZE, ORDER
from okx_filter_demo import quote, read_order

FRAMES = {"4H": 240, "1H": 60, "30m": 30, "15m": 15}
FEE = D(".0005")
RESOURCE = "repos/Achi1984/meridian/contents/fib-demo.json"
BRANCH = "paper-dashboard-data"


def api(*args):
    return subprocess.check_output(["gh", "api", *args], text=True).strip()


class Journal:
    def __init__(self):
        # Listing distinguishes a missing journal from a failed network/auth request.
        self.sha = api(RESOURCE.rsplit("/", 1)[0]+"?ref="+BRANCH, "--jq",
                       '.[] | select(.name=="fib-demo.json") | .sha')
        self.data = {"instrument": INSTRUMENT, "frames": {}, "demo": [], "paper": []}
        if self.sha:
            blob = json.loads(api(RESOURCE+"?ref="+BRANCH))
            if blob["sha"] != self.sha:
                raise ValueError("journal changed")
            self.data = json.loads(base64.b64decode(blob["content"]))
            if self.data["instrument"] != INSTRUMENT:
                raise ValueError("journal instrument mismatch")

    def save(self):
        self.data["asOf"] = int(time.time()*1000)
        encoded = base64.b64encode(json.dumps(self.data).encode()).decode()
        args = ["-f", "sha="+self.sha] if self.sha else []
        self.sha = api("-X", "PUT", RESOURCE, "-f", "branch="+BRANCH, "-f", "content="+encoded,
                       "-f", "message=Update Fibonacci demo observations", *args, "--jq", ".content.sha")


def candles(keys, frame):
    rows = get("/api/v5/market/candles", keys, instId=INSTRUMENT, bar=frame, limit="100")
    bars = sorted((int(r[0]), *map(D, r[1:5])) for r in rows if r[8] == "1")
    interval = FRAMES[frame]*60000
    age = int(time.time()*1000)-bars[-1][0]-interval if bars else -1
    if (len(bars)<26 or not 0<=age<interval or
            any(b[0]-a[0]!=interval for a,b in zip(bars,bars[1:])) or
            any(not 0<l<=min(o,c)<=max(o,c)<=h for _,o,h,l,c in bars)):
        raise ValueError("incomplete "+frame+" market data")
    return bars


def worthwhile(entry, stop, target, sign):
    cost = (entry+target)*FEE
    return (target-entry)*sign-cost >= D("1.5")*((entry-stop)*sign+(entry+stop)*FEE) and (entry-stop)*sign>0


def signal(bars, tick):
    # Anchor on the preceding 24 bars. The next two bars form pullback and confirmation.
    leg, pull, confirm = bars[-26:-2], bars[-2], bars[-1]
    top = max(leg, key=lambda b:b[2])
    base = min(leg, key=lambda b:b[3])
    if top[0] == base[0]:
        return
    width = top[2]-base[3]
    long = top[0]>base[0]
    extreme = top[2] if long else base[3]
    sign = 1 if long else -1
    depth = sign*(extreme-pull[4])
    if not width*D(".5") <= depth <= width*D(".618"):
        return
    if sign*(extreme-confirm[4]) >= width*D(".5"):
        return
    if max(pull[2],confirm[2])>=top[2] or min(pull[3],confirm[3])<=base[3]:
        return
    stop = min(pull[3],confirm[3])-tick if long else max(pull[2],confirm[2])+tick
    if worthwhile(confirm[4],stop,extreme,sign):
        return dict(side="buy" if long else "sell", entry=str(confirm[4]), stop=str(stop), target=str(extreme))


def mark_paper(trade, bars, interval):
    if trade["state"]!="open":
        return
    if bars[0][0]>trade["next"]:
        trade["state"]="data_gap"
        return
    for t,o,h,l,_ in bars:
        if t<trade["next"]:
            continue
        trade["next"]=t+interval
        long = trade["side"]=="buy"
        stop,target = D(trade["stop"]),D(trade["target"])
        if (l<=stop if long else h>=stop):
            price=min(o,stop) if long else max(o,stop)
        elif (h>=target if long else l<=target):
            price=target
        else:
            continue
        entry=D(trade["entry"])
        trade.update(state="closed", exit=str(price), net=str(SIZE*((price-entry)*(1 if long else -1)-(price+entry)*FEE)))
        break


def reconcile(keys, trade):
    row = read_order(keys,trade["id"],trade["side"],False)
    if row is None:
        return  # Ambiguous submission stays reserved. Never resend or claim a fill.
    if row["state"]=="canceled":
        if D(row["accFillSz"])!=0:
            raise ValueError("partial canceled order")
        trade["state"]="unfilled"
        return
    if D(row["accFillSz"])!=SIZE or row["feeCcy"]!="USDC":
        raise ValueError("unexpected entry fill")
    trade.update(state="filled",fill=row["avgPx"])
    try:
        algo, = get("/api/v5/trade/order-algo",keys,algoClOrdId=trade["id"]+"P")
    except VenueError as exc:
        if exc.code=="51603":
            return
        raise
    if algo["instId"]!=INSTRUMENT or algo["algoClOrdId"]!=trade["id"]+"P":
        raise ValueError("exit identity mismatch")
    trade["protection"]=algo["state"]
    if algo["state"]!="effective":
        return
    ids=algo.get("ordIdList") or [algo.get("ordId")]
    if len(ids)!=1 or not ids[0]:
        return
    close, = get(ORDER,keys,instId=INSTRUMENT,ordId=ids[0])
    if (close["state"]=="filled" and close["instId"]==INSTRUMENT and close["side"]!=trade["side"]
            and D(close["accFillSz"])==SIZE and close["feeCcy"]=="USDC"):
        trade.update(state="closed",exit=close["avgPx"],afterFees=str(D(close["pnl"])+D(close["fee"])+D(row["fee"])))


def execute(keys, journal, trade, price):
    cid="MerFib"+trade["frame"]+str(trade["bar"])
    order=dict(id=cid,frame=trade["frame"],side=trade["side"],state="reserved",bar=trade["bar"],
               stop=trade["stop"],target=trade["target"])
    journal.data["demo"].append(order)
    journal.save()
    body=dict(instId=INSTRUMENT,tdMode="cross",clOrdId=cid,side=trade["side"],ordType="ioc",
              sz=str(SIZE),px=str(price),attachAlgoOrds=[dict(attachAlgoClOrdId=cid+"P",
              tpTriggerPx=trade["target"],tpOrdPx="-1",slTriggerPx=trade["stop"],slOrdPx="-1")])
    try:
        ack,=request("POST",ORDER,keys,json.dumps(body),int(time.time()*1000)+5000)
    except VenueError as exc:
        # OKX code 1 is an explicit failure of every operation in the request.
        if exc.code == "1":
            order.update(state="rejected", reason=str(exc))
            journal.save()
        raise
    if ack.get("clOrdId")!=cid or ack.get("sCode")!="0":
        raise ValueError("unconfirmed entry")
    time.sleep(2)
    reconcile(keys,order)
    journal.save()


def main():
    keys=tuple(os.environ[n] for n in NAMES)
    journal=Journal()
    data=journal.data
    contracts=get("/api/v5/account/instruments",keys,instType="FUTURES",instId=INSTRUMENT)
    contract,=contracts
    tick=D(contract["tickSz"])
    signals=[]
    for frame,minutes in FRAMES.items():
        bars=candles(keys,frame)
        interval=minutes*60000
        for trade in data["paper"]:
            if trade["frame"]==frame:
                mark_paper(trade,bars,interval)
        ts=bars[-1][0]
        if frame == "15m":
            data["valuation"] = {"price": str(bars[-1][4]), "closeMs": ts + interval,
                                 "sizeBTC": str(SIZE), "feeRate": str(FEE)}
        if data["frames"].get(frame,{}).get("bar")==ts:
            continue
        setup=signal(bars,tick)
        data["frames"][frame]={"bar":ts,"signal":setup["side"] if setup else "wait"}
        if setup and not any(t["frame"]==frame and t["state"]=="open" for t in data["paper"]):
            trade=dict(**setup,frame=frame,bar=ts,next=ts+interval,state="open")
            data["paper"].append(trade)
            if 0<=time.time()*1000-ts-interval<900000:
                signals.append(trade)
    journal.save()
    for trade in data["demo"]:
        if trade["state"] in ("reserved","filled"):
            reconcile(keys,trade)
            journal.save()
    if not signals or any(t["state"] in ("reserved","filled") for t in data["demo"]):
        return
    if any(D(p["pos"]) for p in get("/api/v5/account/positions",keys,instId=INSTRUMENT)):
        return
    if get("/api/v5/trade/orders-pending",keys,instId=INSTRUMENT):
        return
    check(keys)
    _,bid,ask=quote(keys)
    for t in signals:
        long=t["side"]=="buy"
        price=ask if long else bid
        if worthwhile(price,D(t["stop"]),D(t["target"]),1 if long else -1):
            execute(keys,journal,t,price)
            break


if __name__=="__main__":
    main()
