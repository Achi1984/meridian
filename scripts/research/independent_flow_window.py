"""Run the frozen BTC/ETH flow rule in an additional 24-day historical window."""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

from spot_confirmation_audit import perp_candles, side
from taker_flow_replay import HOUR, replay
from taker_flow_sensitivity import summarize


def signals(asset,begin,end):
    bars = perp_candles(asset,begin-25*HOUR,end)
    if any(t not in bars for t in range(begin-25*HOUR,end,HOUR)):
        raise ValueError(f'incomplete OKX candles for {asset}')
    events = []
    half = (begin+end)//2
    for label,start,stop in [('earlier',begin,half),('later',half,end)]:
        for t in range(start,stop-4*HOUR,HOUR):
            direction = side(bars,t)
            if direction:
                gross = 100*direction*(bars[t+4*HOUR][0]/bars[t+HOUR][0]-1)
                events.append(dict(asset=asset,at=t,side=direction,period=label,grossPct=gross))
    return events


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('start',type=date.fromisoformat)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    begin=int(datetime.combine(args.start,datetime.min.time(),timezone.utc).timestamp())
    end=begin+24*24*HOUR
    with ThreadPoolExecutor(max_workers=2) as pool:
        batches=list(pool.map(lambda a: signals(a,begin,end),('BTC','ETH')))
    result=replay(dict(begin=begin,end=end,signals=batches[0]+batches[1]))
    result.update(begin=begin,end=end)
    result['sensitivity']={}
    for direction,name in [(1,'long'),(-1,'short')]:
        subset=[r for r in result['signals'] if r['direction']==direction]
        for label,group in [('all',subset),('pass',[r for r in subset if r['passed']])]:
            result['sensitivity'][name+' '+label]=summarize(group)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result['sensitivity']))
