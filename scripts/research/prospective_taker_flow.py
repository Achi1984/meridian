"""Paired BTC/ETH hourly paper observations with subsequent OKX book quotes."""
import argparse
import json
import time
from pathlib import Path

from taker_flow_replay import classify
from top100_paper import D, FEE, HOUR, bars_for, fill, get, ok, settle

ERRORS = (OSError, ValueError, KeyError, ArithmeticError, IndexError, TypeError, StopIteration)
ASSETS = ('BTC', 'ETH')


def volume_shares(rows, slot):
    shares = {}
    for r in rows:
        start = int(r[0])
        if start % (HOUR*1000) or int(r[6]) != start+HOUR*1000-1 or int(r[6]) >= slot*1000:
            raise ValueError('unexpected or unclosed Binance hour')
        total, bought = D(r[7]), D(r[10])
        if not 0 <= bought <= total or total <= 0:
            raise ValueError('invalid trade volumes')
        if start//1000 in shares:
            raise ValueError('duplicate Binance hour')
        shares[start//1000] = float(bought/total)
    return shares


def flow(asset, slot, side):
    rows = get('https://fapi.binance.com/fapi/v1/klines',symbol=asset+'USDT',
               interval='1h',endTime=slot*1000-1,limit=169)
    shares = volume_shares(rows,slot)
    hour = slot-HOUR
    return dict(observedAt=time.time(),passed=classify(shares,dict(at=hour,side=side)),
                buyShare=shares[hour],previousSameHour=[shares[hour-i*24*HOUR] for i in range(1,8)])


def enter(asset, slot):
    inst = asset+'-USDT-SWAP'
    row = dict(instrument=inst,slot=slot)
    try:
        _, bar = bars_for((inst,slot-HOUR))
        if 'error' in bar:
            raise ValueError(bar['error'])
        row['side'] = bar['side']
        if not row['side']:
            return row
        try:
            row['flow'] = flow(asset,slot,row['side'])
        except ERRORS as exc:
            row['flowError'] = str(exc)
        instrument = ok('public/instruments',instType='SWAP',instId=inst)[0]
        if instrument['instId']!=inst or instrument['state']!='live' or instrument['ctValCcy']!=asset:
            raise ValueError('unexpected instrument')
        spec = [instrument[k] or '1' for k in ('ctVal','ctMult','lotSz','minSz')]
        funding = int(ok('public/funding-rate',instId=inst)[0]['fundingTime'])
        if not slot <= time.time() < slot+240 or funding <= time.time()*1000:
            raise ValueError('entry time or funding schedule unavailable')
        quote = fill(inst,spec,row['side']==1,time.time())
        if quote['ts']>=min((slot+240)*1000,funding):
            raise ValueError('entry quote outside window')
        row.update(spec=spec,nextFunding=funding,entry=quote)
    except ERRORS as exc:
        row['entryError'] = str(exc)
    return row


def close(row):
    inst = row['instrument']
    if 'exit' not in row:
        quote = fill(inst,row['spec'],row['side']==-1,time.time(),contracts=row['entry']['contracts'])
        if not 0 <= quote['ts']/1000-(row['slot']+3*HOUR) < 240:
            raise ValueError('exit quote outside window')
        row['exit'] = quote
    funding = settle(row)
    quantity = D(row['entry']['qty'])
    buy, sell = D(row['entry']['price']), D(row['exit']['price'])
    net = quantity*(row['side']*(sell-buy)-FEE*(buy+sell))+funding
    row.update(funding=str(funding),baselineNetUsdt=str(net))
    if 'flow' in row:
        row['filteredNetUsdt'] = str(net if row['flow']['passed'] else D(0))


def run(path, slots):
    if path.exists():
        state = json.loads(path.read_text())
        if state['entrySlots']!=slots:
            raise ValueError('existing study length differs')
    else:
        state = dict(firstSlot=(int(time.time())//HOUR+1)*HOUR,entrySlots=slots,observations=[])
    def save():
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(state,indent=2)+'\n')
        tmp.replace(path)
    save()
    for i in range(slots+3):
        slot = state['firstSlot']+i*HOUR
        time.sleep(max(0,slot+3-time.time()))
        for row in state['observations']:
            if ('entry' not in row or 'baselineNetUsdt' in row or
                    row['slot']+3*HOUR>slot or ('exit' not in row and 'exitError' in row)):
                continue
            try:
                if 'exit' not in row and time.time() >= row['slot']+3*HOUR+240:
                    raise ValueError('missed exit window')
                close(row)
                row.pop('exitError',None)
            except ERRORS as exc:
                row['exitError']=str(exc)
            save()
        if i < slots:
            for asset in ASSETS:
                inst = asset+'-USDT-SWAP'
                if any(r['instrument']==inst and r['slot']==slot for r in state['observations']):
                    continue
                row = (enter(asset,slot) if time.time()<slot+240 else
                       dict(instrument=inst,slot=slot,entryError='missed window'))
                state['observations'].append(row)
                save()
                print(row,flush=True)


if __name__=='__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output',type=Path)
    p.add_argument('--slots',type=int,default=2,choices=(1,2))
    args=p.parse_args()
    run(args.output,args.slots)
