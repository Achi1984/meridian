"""Frozen R42 relative-momentum walk-forward replay. Research only."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from pairs_scan import INTERVAL, SYMBOLS, validate
from pairs_walkforward import funding_map

GROSS_USD=2000.0
LOOKBACK_BARS=186  # 32 daily closes, matching the production collector
HOLD_BARS=42       # seven days
MAX_LOSS_USD=100.0
MAX_DRAWDOWN_USD=500.0
MAX_NET_BETA=.10


def signal(prices,end):
    indices=np.arange(end-LOOKBACK_BARS,end+1,6)
    if len(indices)!=32: return None
    btc=np.diff(np.log(prices['BTCUSDT'][indices])); variance=float(np.var(btc))
    if variance<=0: return None
    rows=[]
    for symbol in SYMBOLS:
        closes=prices[symbol][indices]
        returns=np.diff(np.log(closes))
        beta=float(np.cov(returns,btc,ddof=0)[0,1]/variance)
        rows.append({'symbol':symbol,'return30d':float(closes[-1]/closes[-31]-1),'beta':beta})
    if any(not np.isfinite(r['beta']) or r['beta']<=0 for r in rows): return None
    rows.sort(key=lambda r:(-r['return30d'],r['symbol']))
    longs=rows[:2]; shorts=rows[-2:]
    legs=[{'symbol':r['symbol'],'weight':.25,'beta':r['beta']} for r in longs]
    legs +=[{'symbol':r['symbol'],'weight':-.25,'beta':r['beta']} for r in shorts]
    net_beta=sum(l['weight']*l['beta'] for l in legs)
    if abs(net_beta)>MAX_NET_BETA: return None
    return {'legs':legs,'netBeta':net_beta}


def replay(data,costs_bps):
    validate(data); funding=funding_map(data)
    if not np.isfinite(costs_bps) or costs_bps<=0: raise ValueError('Positive round-trip costs required')
    times=np.asarray(data['series'][SYMBOLS[0]])[:,0].astype(np.int64)+INTERVAL
    prices={s:np.asarray(data['series'][s],dtype=float)[:,1] for s in SYMBOLS}
    trades=[]; position=None; cash=0.; peak=0.; max_drawdown=0.; sealed=False; rejected=0

    def mark(pos,i):
        price_pnl=sum(l['qty']*(prices[l['symbol']][i]-l['entry']) for l in pos['legs'])
        funding_pnl=0.
        for leg in pos['legs']:
            for at,rate,mark_price in funding[leg['symbol']]:
                if pos['entryAt']<at<=times[i]: funding_pnl-=leg['qty']*mark_price*rate
        costs=GROSS_USD*costs_bps/10000
        return price_pnl+funding_pnl-costs,price_pnl,funding_pnl,costs

    for i in range(LOOKBACK_BARS,len(times)):
        if position:
            net,price_pnl,funding_pnl,costs=mark(position,i)
            reason='LOSS_LIMIT' if net<=-MAX_LOSS_USD else 'TIME_EXIT' if i-position['entryIndex']>=HOLD_BARS else None
            if reason:
                cash+=net; peak=max(peak,cash); max_drawdown=max(max_drawdown,peak-cash)
                trades.append({'entryAt':position['entryAt'],'exitAt':int(times[i]),'exitReason':reason,
                  'netBeta':position['netBeta'],'legs':[{k:l[k] for k in ('symbol','side')} for l in position['legs']],
                  'pricePnlUsd':price_pnl,'fundingPnlUsd':funding_pnl,'costsUsd':costs,'netPnlUsd':net})
                position=None
                if peak-cash>=MAX_DRAWDOWN_USD: sealed=True
        if sealed or position or (i-LOOKBACK_BARS)%HOLD_BARS: continue
        decision=signal(prices,i)
        if not decision: rejected+=1; continue
        legs=[]
        for leg in decision['legs']:
            entry=prices[leg['symbol']][i]; side=1 if leg['weight']>0 else -1
            legs.append({'symbol':leg['symbol'],'side':'LONG' if side>0 else 'SHORT','entry':entry,
                         'qty':side*GROSS_USD*abs(leg['weight'])/entry})
        position={'entryIndex':i,'entryAt':int(times[i]),'netBeta':decision['netBeta'],'legs':legs}
    wins=sum(t['netPnlUsd']>0 for t in trades); gross_win=sum(max(0,t['netPnlUsd']) for t in trades)
    gross_loss=-sum(min(0,t['netPnlUsd']) for t in trades)
    return {'policy':'MOMENTUM-WALKFORWARD-V1','executionImpact':False,'asOf':data['asOf'],
      'parameters':{'grossUsd':GROSS_USD,'lookbackDays':30,'holdDays':7,'roundTripCostsBps':costs_bps,
        'maxLossUsd':MAX_LOSS_USD,'maxDrawdownUsd':MAX_DRAWDOWN_USD,'maxNetBeta':MAX_NET_BETA},
      'scheduledRebalances':(len(times)-1-LOOKBACK_BARS)//HOLD_BARS+1,'rejectedRebalances':rejected,
      'closedBaskets':len(trades),'winRate':wins/len(trades) if trades else None,
      'profitFactor':gross_win/gross_loss if gross_loss else None,'netPnlUsd':sum(t['netPnlUsd'] for t in trades),
      'maxDrawdownUsd':max_drawdown,
      'sealed':sealed,'openAtEnd':bool(position),'trades':trades,
      'limitation':'Four-hour close simulation; fixed historical universe; no order-book replay or profitability claim'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('input');parser.add_argument('--costs-bps',type=float,required=True)
    args=parser.parse_args();raw=Path(args.input).read_bytes();result=replay(json.loads(raw),args.costs_bps)
    result['inputSha256']=hashlib.sha256(raw).hexdigest();print(json.dumps(result,indent=2,allow_nan=False))
