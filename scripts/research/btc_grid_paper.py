"""Fixed forward BTC-USDT spot comparison. No order or private API access."""
import json
import math
import statistics
import time

from okx_rejection_paper import read

START = 1795881600000  # 28 November 2026 16:00 UTC
BAR = 900000
END = START + 2 * 86400000
FEE = .001
SLIP = .0003


def candles(now):
    cursor = min(now, END)
    bars = {}
    first = START - 7 * 86400000
    while cursor > first:
        batch = read("market/history-candles", instId="BTC-USDT", bar="15m", after=cursor, limit=100)
        if not batch:
            break
        for t, o, h, l, c, *rest in batch:
            if rest[-1] == "1" and first <= int(t) and int(t)+BAR <= min(now, END):
                bars[int(t)] = tuple(map(float, (o,h,l,c)))
        older = min(int(row[0]) for row in batch)
        if older >= cursor:
            raise ValueError("pagination")
        cursor = older
    expected = list(range(first, min(now, END)//BAR*BAR, BAR))
    if sorted(bars) != expected:
        raise ValueError("Incomplete 15m history")
    return [bars[t] for t in expected]


def features(window):
    changes = [abs(b[3]-a[3]) for a,b in zip(window,window[1:])]
    drift = abs(window[-1][3]-window[0][3])/max(sum(changes),1e-9)
    ranges = [(h-l)/c for _,h,l,c in window]
    volatility = statistics.median(ranges)
    shock = min(4, ranges[-1]/max(volatility,.00001))
    return drift, volatility, shock


def quotes(window, account, fixed, anchor):
    price = window[-1][3]
    share = account["btc"]*price/(account["cash"]+account["btc"]*price)
    drift, vol, shock = features(window)
    if fixed:
        step = anchor*.004
        level = math.floor((price-anchor)/step)
        bid = anchor+(level-1 if abs(price-(anchor+level*step))<1e-8 else level)*step
        ask = anchor+(level+1)*step
    else:
        if drift>.55 or shock>2.5 or vol<2*(FEE+SLIP):
            return []
        step = price*max(.0035, vol*.85)
        center = statistics.median([b[3] for b in window[-5:]])-(share-.5)*2*step
        bid, ask = min(price-step*.5,center-step), max(price+step*.5,center+step)
    buy = 25 if fixed else 25*min(1,(1-share)*2)
    sell = 25 if fixed else 25*min(1,share*2)
    wealth = account["cash"]+account["btc"]*price
    return [(1,bid,min(buy,max(0,(.75-share)*wealth))),
            (-1,ask,min(sell,max(0,(share-.25)*wealth)))]


def settle(account, orders, bar, scale):
    _,high,low,close = bar
    # Require penetration beyond the limit. Reserve both orders from pre-bar inventory.
    cash, btc = account["cash"], account["btc"]
    for side,limit,size in orders:
        qty=size*scale/limit
        if qty<=0 or (side==1 and low>=limit*(1-SLIP)) or (side==-1 and high<=limit*(1+SLIP)):
            continue
        if side==1:
            qty=min(qty,cash/(limit*(1+FEE)))
        else:
            qty=min(qty,btc)
        if qty<=0:
            continue
        account["btc"]+=side*qty
        account["cash"]-=side*qty*limit+qty*limit*FEE
        account["fills"]+=1
    return account["cash"]+account["btc"]*close


def simulate(bars):
    cut=7*96
    # k-nearest-neighbor training examples: incremental one-bar quote P/L versus holding.
    examples=[]
    for i in range(16,min(cut,len(bars))):
        window=bars[i-16:i]
        price=window[-1][3]
        account={"btc":500/price,"cash":500,"fills":0}
        orders=quotes(window,account,False,price)
        held=500+account["btc"]*bars[i][3]
        gain=settle(account,orders,bars[i],1)-held
        if account["fills"]:
            drift,vol,shock=features(window)
            examples.append(((drift,vol*100,shock/4),gain))
    anchor=bars[min(len(bars),cut)-1][3]
    accounts={k:{"btc":500/anchor,"cash":500,"fills":0,"equity":1000,"peak":1000,"drawdown":0}
              for k in ("fixed","adaptive","model")}
    decisions={"full":0,"half":0,"pause":0}
    for i in range(cut,len(bars)):
        window=bars[i-16:i]
        for name,a in accounts.items():
            orders=quotes(window,a,name=="fixed",anchor)
            scale=1
            if name=="model" and orders:
                drift,vol,shock=features(window)
                x=(drift,vol*100,shock/4)
                near=sorted(examples,key=lambda e:math.dist(x,e[0]))[:15]
                score=statistics.mean(g for _,g in near) if len(near)==15 else 0
                scale=1 if score>.02 else .5 if score>0 else 0
                decisions[{1:"full",.5:"half",0:"pause"}[scale]]+=1
            equity=settle(a,orders,bars[i],scale)
            a["equity"]=equity
            a["peak"]=max(a["peak"],equity)
            a["drawdown"]=max(a["drawdown"],a["peak"]-equity)
    hold_equity = 500 + (500 / anchor) * bars[-1][3]
    results = {}
    for name, account in accounts.items():
        results[name] = {key: round(account[key], 2) for key in ("equity", "drawdown", "fills")}
        results[name]["vsHold"] = round(account["equity"] - hold_equity, 2)
    return {"accounts": results, "holdEquity": round(hold_equity, 2),
            "decisions":decisions,"trainingFills":len(examples),"bars":max(0,len(bars)-cut)}


if __name__=="__main__":
    now=int(time.time()*1000)
    report=simulate(candles(now))
    report.update(asOf=min(now,END),phase="planned" if now<START else "final" if now>=END else "running")
    print(json.dumps(report,indent=2))
