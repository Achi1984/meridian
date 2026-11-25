"""Record synchronized public OKX spot ask/perpetual bid for a fixed 84-day paper observation."""
import json
import time
import sys
from pathlib import Path
from decimal import Decimal as D, ROUND_DOWN
from concurrent.futures import ThreadPoolExecutor
from matched_spot_carry import DAY
from top100_paper import ok

def snapshot(asset):
    spot,swap=asset+'-USDT',asset+'-USDT-SWAP'
    sp=ok('public/instruments',instType='SPOT',instId=spot)[0]
    sw=ok('public/instruments',instType='SWAP',instId=swap)[0]
    if sw['ctValCcy']!=asset or sw['ctType']!='linear' or sw['state']!='live' or sp['state']!='live':
        raise ValueError('incompatible instruments')
    unit=D(sw['ctVal'])*D(sw['ctMult'] or 1)
    for _ in range(5):
        with ThreadPoolExecutor(2) as pool:
            a,b=pool.map(lambda inst:ok('market/books',instId=inst,sz=1)[0],(spot,swap))
        times=[int(q['ts']) for q in (a,b)]
        now=time.time()*1000
        if max(times)-min(times)<=2000 and 0<=now-max(times)<=10000:
            break
    else:
        raise ValueError('no fresh matching quotes')
    ask,offer=map(D,a['asks'][0][:2])
    bid,depth=map(D,b['bids'][0][:2])
    lot=D(sw['lotSz'])
    contracts=(D(500)/max(ask,bid)/unit/lot).to_integral_value(rounding=ROUND_DOWN)*lot
    qty=contracts*unit
    if not (qty>=D(sp['minSz']) and qty%D(sp['lotSz'])==0 and contracts>=D(sw['minSz'])
            and contracts<=depth and qty<=offer):
        raise ValueError('quantity or depth mismatch')
    return dict(asset=asset,spotInst=spot,swapInst=swap,capitalUsdt=1000,spotAsk=str(ask),perpBid=str(bid),
                qty=str(qty),contracts=str(contracts),spotTs=times[0],perpTs=times[1],
                exitDueMs=max(times)+84*DAY,spotAvailable=str(offer),swapAvailableContracts=str(depth))

if __name__=='__main__':
    p=Path(sys.argv[1])
    with ThreadPoolExecutor(2) as pool:
        records=list(pool.map(snapshot,('BTC','ETH')))
    with p.open('x') as stream:
        json.dump(dict(status='indicative paper entry observations',holdDays=84,records=records),stream,indent=2)
        stream.write('\n')
    print(records)
