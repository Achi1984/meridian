"""Prospective hourly breakout and retest paper pilot. Public GET requests only."""
import argparse
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HOUR = 3600
FEE = D('.0005')
SLIP = D('.001')
NOTIONAL = D(100)
# Explicit CoinGecko asset IDs and OKX linear contract bases. Unmapped ranks remain visible.
PAIRS = dict(pair.split(':') for pair in """
bitcoin:BTC ethereum:ETH binancecoin:BNB ripple:XRP solana:SOL tron:TRX
hyperliquid:HYPE zcash:ZEC monero:XMR dogecoin:DOGE chainlink:LINK cardano:ADA
stellar:XLM bitcoin-cash:BCH near:NEAR litecoin:LTC avalanche-2:AVAX uniswap:UNI sui:SUI
hedera-hashgraph:HBAR bittensor:TAO quant-network:QNT crypto-com-chain:CRO shiba-inu:SHIB
okb:OKB aave:AAVE pepe:PEPE world-liberty-financial:WLFI ondo-finance:ONDO ethena:ENA
venice-token:VVV mantle:MNT just:JST polkadot:DOT internet-computer:ICP morpho:MORPHO
sky:SKY ethereum-classic:ETC worldcoin-wld:WLD pump-fun:PUMP polygon-ecosystem-token:POL
midnight-3:NIGHT arbitrum:ARB jupiter-exchange-solana:JUP kaspa:KAS render-token:RENDER
algorand:ALGO cosmos:ATOM pi-network:PI injective-protocol:INJ xdce-crowd-sale:XDC
blockstack:STX pancakeswap-token:CAKE filecoin:FIL
""".split())


def get(url, **params):
    with urlopen(Request(url+'?'+urlencode(params), headers={'User-Agent':'Meridian-Paper/1'}),timeout=10) as r:
        return json.load(r)


def ok(path, **params):
    r = get('https://www.okx.com/api/v5/'+path, **params)
    if r['code'] != '0' or not r['data']:
        raise ValueError('missing '+path)
    return r['data']


def universe():
    ranks = get('https://api.coingecko.com/api/v3/coins/markets',vs_currency='usd',
                order='market_cap_desc',per_page=100,page=1)
    if len(ranks)!=100 or len({r['id'] for r in ranks})!=100:
        raise ValueError('incomplete top 100')
    specs = {x['instId']:x for x in ok('public/instruments',instType='SWAP')}
    listing, tradable = [], {}
    for r in ranks:
        asset = PAIRS.get(r['id'])
        inst = str(asset)+'-USDT-SWAP'
        x = specs.get(inst)
        eligible = bool(asset and r['symbol'].upper()==asset and x and x['state']=='live'
                        and x['ctType']=='linear' and x['ctValCcy']==asset)
        listing.append(dict(id=r['id'],rank=r['market_cap_rank'],symbol=r['symbol'],
                            instrument=inst if eligible else None))
        if eligible:
            tradable[inst] = [x['ctVal'],x['ctMult'] or '1',x['lotSz'],x['minSz']]
    if 'BTC-USDT-SWAP' not in tradable:
        raise ValueError('BTC contract unavailable')
    return dict(at=int(time.time()),listing=listing,specs=tradable)


def features(rows, slot):
    candles = {int(r[0])//1000:[float(v) for v in r[1:6]] for r in rows if r[-1]=='1'}
    bars = [candles[t] for t in range(slot-25*HOUR,slot,HOUR)]
    if not all(all(math.isfinite(v) for v in b) and 0<b[2]<=min(b[0],b[3])
               and max(b[0],b[3])<=b[1] and b[4]>=0 for b in bars):
        raise ValueError('invalid OHLCV')
    prior, last = bars[:-1],bars[-1]
    high,low=max(b[1] for b in prior),min(b[2] for b in prior)
    avg=sum(b[4] for b in prior)/24
    return dict(close=last[3], high=last[1], low=last[2], rangeHigh=high,rangeLow=low,
                side=1 if last[3]>high else -1 if last[3]<low else 0,
                volumeRatio=last[4]/avg if avg else None,return24h=last[3]/prior[0][3]-1)


def bars_for(inst_slot):
    inst,slot=inst_slot
    try:
        return inst,features(ok('market/candles',instId=inst,bar='1H',limit=30),slot)
    except (OSError,ValueError,KeyError,IndexError) as e:
        return inst,dict(error=str(e)[:120])


def fill(inst, spec, buy, after, contracts=None):
    for _ in range(5):
        b=ok('market/books',instId=inst,sz=1)[0]
        ts=int(b['ts'])
        if after*1000 < ts <= time.time()*1000 and time.time()-ts/1000 <= 5:
            break
        time.sleep(.4)
    else:
        raise ValueError('no fresh subsequent quote')
    bid,ask=D(b['bids'][0][0]),D(b['asks'][0][0])
    if not 0<bid<=ask:
        raise ValueError('crossed book')
    price=(ask*(1+SLIP)) if buy else bid*(1-SLIP)
    val,mult,lot,minimum=map(D,spec)
    unit=val*mult
    size=contracts if contracts is not None else (NOTIONAL/(unit*price)//lot)*lot
    if not minimum<=size<=D(b['asks' if buy else 'bids'][0][1]):
        raise ValueError('insufficient depth or lot')
    return dict(ts=ts,price=str(price),contracts=str(size),qty=str(unit*size),bid=str(bid),ask=str(ask))


def retest(f, pending, slot):
    side,level=pending['side'],pending['level']
    if not pending['slot']<slot<=pending['slot']+3*HOUR:
        return False
    return f['low']<=level<f['close'] if side==1 else f['high']>=level>f['close']


def settle(t):
    entry,exit=t['entry'],t['exit']
    if exit['ts']<t['nextFunding']:
        return D(0)
    inst=t['instrument']
    schedule=ok('public/funding-rate',instId=inst)[0]
    if int(schedule['fundingTime'])<=exit['ts']:
        raise ValueError('settlement still pending')
    rows=ok('public/funding-rate-history',instId=inst,limit=100)
    stamps={int(r['fundingTime']) for r in rows}
    if min(stamps)>entry['ts'] or t['nextFunding'] not in stamps:
        raise ValueError('missing funding history')
    total=D(0)
    for r in rows:
        at=int(r['fundingTime'])
        if entry['ts']<at<=exit['ts']:
            marks=ok('market/history-mark-price-candles',instId=inst,bar='1m',after=at+1,limit=3)
            mark=next(D(c[1]) for c in marks if int(c[0])==at)
            total-=t['side']*D(entry['qty'])*mark*D(r['realizedRate'])
    return total


def observe(state,slot):
    day=datetime.fromtimestamp(time.time(),timezone.utc).date().isoformat()
    if day not in state['universes']:
        state['universes'][day]=universe()
    specs=state['universes'][day]['specs']
    active=dict(specs)
    for account in state['accounts'].values():
        active.update({i:p['spec'] for i,p in account['open'].items()})
    with ThreadPoolExecutor(max_workers=4) as pool:
        signals=dict(pool.map(bars_for,((i,slot) for i in active)))
    row=dict(slot=slot,signals=signals,skips=[])
    btc=signals['BTC-USDT-SWAP'].get('return24h')
    for inst,f in signals.items():
        if 'error' in f:
            continue
        f['relativeToBtc24h']=f['return24h']-btc if btc is not None else None
        if f['side'] or inst in state['pending']:
            for path,key,extra in [('public/open-interest','oi',{'instType':'SWAP'}),('public/funding-rate','fundingRate',{})]:
                try:
                    d=ok(path,instId=inst,**extra)[0]
                    f[key]=d[key]
                    if key=='fundingRate':
                        f['nextFunding']=int(d['fundingTime'])
                except (OSError,KeyError,ValueError):
                    f[key]=None
    # Exit first; re-entry after closing on the same bar is excluded.
    for name,account in state['accounts'].items():
        for inst,f in signals.items():
            try:
                pos=account['open'].get(inst)
                if pos:
                    if 'error' in f and slot-pos['slot']<6*HOUR:
                        continue
                    if slot-pos['slot']<6*HOUR and (f['close']-pos['level'])*pos['side']>0:
                        continue
                    exit=fill(inst,pos['spec'],pos['side']<0,time.time(),D(pos['entry']['contracts']))
                    gross=pos['side']*D(exit['qty'])*(D(exit['price'])-D(pos['entry']['price']))
                    fee=FEE*D(exit['qty'])*(D(exit['price'])+D(pos['entry']['price']))
                    account['closed'].append(dict(**pos,exit=exit,beforeFunding=str(gross-fee),net=None))
                    del account['open'][inst]
            except (OSError,ValueError,KeyError,ArithmeticError) as e:
                row['skips'].append([name,inst,'exit',str(e)[:100]])
        for inst in specs:
            f=signals[inst]
            if 'error' in f or inst in account['open'] or any(t['instrument']==inst and t['exit']['ts']>=slot*1000 for t in account['closed']):
                continue
            p=state['pending'].get(inst)
            if name=='retest':
                if not p or not retest(f,p,slot):
                    continue
                side,level=p['side'],p['level']
                del state['pending'][inst]
            else:
                side=f['side']
                if not side:
                    continue
                level=f['rangeHigh'] if side==1 else f['rangeLow']
            try:
                if len(account['open'])>=2 or time.time()-slot>240:
                    raise ValueError('capacity or timing limit')
                nxt=f.get('nextFunding',0)
                if nxt<=time.time()*1000:
                    raise ValueError('missing funding schedule')
                entry=fill(inst,specs[inst],side==1,time.time())
                if entry['ts']>=nxt:
                    raise ValueError('funding rollover')
                account['open'][inst]=dict(instrument=inst,spec=specs[inst],side=side,level=level,slot=slot,
                                           entry=entry,nextFunding=nxt)
            except (OSError,ValueError,KeyError,ArithmeticError) as e:
                row['skips'].append([name,inst,'entry',str(e)[:100]])
        for t in account['closed']:
            if t['net'] is None:
                try:
                    funding=settle(t)
                    t.update(funding=str(funding),net=str(D(t['beforeFunding'])+funding))
                except (OSError,ValueError,KeyError,ArithmeticError,StopIteration):
                    pass
    for inst in list(state['pending']):
        p=state['pending'][inst]
        f=signals.get(inst,{})
        if slot>=p['slot']+3*HOUR or 'close' not in f or (f['close']-p['level'])*p['side']<=0:
            del state['pending'][inst]
    for inst in specs:
        f=signals[inst]
        if f.get('side') and inst not in state['pending'] and inst not in state['accounts']['retest']['open']:
            state['pending'][inst]=dict(slot=slot,side=f['side'],level=f['rangeHigh'] if f['side']==1 else f['rangeLow'])
    state['observations'].append(row)
    print('Hourly observation',slot,'valid',sum('close' in f for f in signals.values()),'open',
          {n:len(a['open']) for n,a in state['accounts'].items()},flush=True)


def run(directory,segment):
    directory.mkdir(exist_ok=True)
    path=directory/'state.json'
    if segment==1:
        if path.exists():
            raise ValueError('existing state')
        u=json.loads(Path(__file__).with_name('top100_start.json').read_text())
        now=int(time.time())
        if not 0<=now-u['at']<3600 or now//86400!=u['at']//86400:
            u=universe()
            now=int(time.time())
        state=dict(start=now,lastSlot=now//HOUR*HOUR,universes={datetime.fromtimestamp(now,timezone.utc).date().isoformat():u},
                   accounts={n:dict(initialUsdt=1000,open={},closed=[]) for n in ('direct','retest')},
                   cashBenchmarkUsdt=1000,pending={},observations=[])
    else:
        state=json.loads(path.read_text())
    def save():
        tmp=path.with_suffix('.tmp')
        tmp.write_text(json.dumps(state,allow_nan=False))
        tmp.replace(path)
    save()
    print('Ready',len(next(iter(state['universes'].values()))['specs']),'mapped live swaps',flush=True)
    end=state['start']+segment*4*HOUR
    while time.time()<end:
        slot=state['lastSlot']+HOUR
        time.sleep(max(0,min(end,slot+4)-time.time()))
        if time.time()>=end:
            break
        try:
            if time.time()-slot>240:
                raise ValueError('missed collection window')
            observe(state,slot)
        except (ValueError,KeyError,OSError) as e:
            state['observations'].append(dict(slot=slot,error=str(e)[:150]))
            state['pending'].clear()
        state['lastSlot']=slot
        save()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('directory',type=Path)
    parser.add_argument('segment',type=int,choices=(1,2))
    args=parser.parse_args()
    run(args.directory,args.segment)
