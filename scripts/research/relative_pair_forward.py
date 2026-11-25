"""Forward observation of the strongest and weakest simultaneous upside breakouts."""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from top100_paper import D, FEE, HOUR, bars_for, fill, ok, settle

ERRORS=(OSError,ValueError,IndexError,ArithmeticError,KeyError,StopIteration)


def select(signals):
    if any('return24h' not in s for s in signals.values()):
        raise ValueError('incomplete universe at ranking time')
    btc=signals['BTC-USDT-SWAP']['return24h']
    ranked=sorted((s['return24h']-btc,i) for i,s in signals.items() if s['side']==1)
    if len(ranked)<2 or ranked[0][0]==ranked[-1][0]:
        return ranked,[]
    return ranked,[(ranked[-1][1],1),(ranked[0][1],-1)]


def paired_book(legs,specs,entering):
    after=time.time()
    def quote(leg):
        inst=leg['instrument']
        return fill(inst,specs[inst],(leg['side']==1)==entering,after,
                    contracts=None if entering else leg['entry']['contracts'])
    with ThreadPoolExecutor(2) as workers:
        quotes=list(workers.map(quote,legs))
    if abs(quotes[0]['ts']-quotes[1]['ts'])>2000:
        raise ValueError('book timestamps differ by more than 2 seconds')
    return quotes


def observe(slot,specs):
    row=dict(slot=slot)
    try:
        with ThreadPoolExecutor(5) as workers:
            signals=dict(workers.map(bars_for,[(i,slot) for i in specs]))
        row['missing']=[i for i,s in signals.items() if 'return24h' not in s]
        ranked,pair=select(signals)
        row['upsideBreakouts']=ranked
        if not pair:
            return row
        legs=[]
        for inst,side in pair:
            rate=ok('public/funding-rate',instId=inst)[0]
            legs.append(dict(instrument=inst,side=side,nextFunding=int(rate['fundingTime'])))
        quotes=paired_book(legs,specs,True)
        if any(q['ts']>=min(l['nextFunding'],(slot+240)*1000) for q,l in zip(quotes,legs)):
            raise ValueError('entry too late or funding rollover')
        row['legs']=[dict(l,entry=q) for l,q in zip(legs,quotes)]
    except ERRORS as exc:
        row['entryError']=str(exc)
    return row


def close(row,specs):
    legs=row['legs']
    quotes=paired_book(legs,specs,False)
    if any(not 0<=q['ts']/1000-row['slot']-3*HOUR<240 for q in quotes):
        raise ValueError('exit outside four-minute window')
    for leg,q in zip(legs,quotes):
        leg['exit']=q


def account(row):
    pnl=notional=D(0)
    for leg in row['legs']:
        funding=settle(leg)
        entry,exit_price,qty=map(D,[leg['entry']['price'],leg['exit']['price'],leg['entry']['qty']])
        net=qty*((exit_price-entry)*leg['side']-FEE*(exit_price+entry))+funding
        pnl+=net
        notional+=qty*entry
        leg.update(netUsdt=str(net),fundingUsdt=str(funding))
    row.update(netUsdt=str(pnl),netPctGrossNotional=str(100*pnl/notional))


def run(path):
    snapshot=json.loads(Path(__file__).with_name('top100_start.json').read_text())
    slots=2
    state=dict(firstSlot=(int(time.time())//HOUR+1)*HOUR,universeAt=snapshot['at'],
               instruments=list(snapshot['specs']),observations=[])
    def save():
        tmp=path.with_suffix('.tmp')
        tmp.write_text(json.dumps(state,indent=2,allow_nan=False)+'\n')
        tmp.replace(path)
    if path.exists():
        raise ValueError('existing study output')
    save()
    for i in range(slots+3):
        slot=state['firstSlot']+i*HOUR
        time.sleep(max(0,slot+3-time.time()))
        for row in state['observations']:
            if row['slot']+3*HOUR==slot and row.get('legs'):
                try:
                    close(row,snapshot['specs'])
                except ERRORS as exc:
                    row['exitError']=str(exc)
            if row.get('legs') and 'exit' in row['legs'][0] and 'netUsdt' not in row:
                try:
                    account(row)
                    row.pop('settlementError',None)
                except ERRORS as exc:
                    row['settlementError']=str(exc)
            save()
        if i<slots:
            state['observations'].append(observe(slot,snapshot['specs']))
            save()
            print(state['observations'][-1],flush=True)


if __name__=='__main__':
    run(Path(sys.argv[1]))
