import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from top100_paper import features, HOUR, ok
from breakout_signal_audit import audit
from pathlib import Path
parser=argparse.ArgumentParser(description='Replay the three-hour continuation diagnostic at a dated universe snapshot.')
parser.add_argument('universe',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
u=json.loads(args.universe.read_text())
end=u['at']//HOUR*HOUR
def collect(inst):
    try:
        data=ok('market/candles',instId=inst,bar='1H',after=end*1000,limit=110)
        return inst,{t:features(data,t) for t in range(end-74*HOUR,end+1,HOUR)}
    except (KeyError,IndexError,ValueError,OSError) as e:
        return inst,{'error':str(e)}
with ThreadPoolExecutor(max_workers=5) as pool:
    panels=dict(pool.map(collect,u['specs']))
errors={i:p['error'] for i,p in panels.items() if 'error' in p}
obs=[]
for t in range(end-74*HOUR,end+1,HOUR):
    signals={i:p[t].copy() for i,p in panels.items() if 'error' not in p}
    btc=signals['BTC-USDT-SWAP']['return24h']
    for f in signals.values():
        f['relativeToBtc24h']=f['return24h']-btc
    obs.append(dict(slot=t,signals=signals))
result=dict(universeAt=u['at'],firstSlot=obs[0]['slot'],lastSlot=end,covered=len(panels)-len(errors),
            errors=errors,method='Exploratory current-universe replay. 72 hourly signal windows with complete subsequent three-hour paths. Final three hours are follow-up only. Price change before execution and costs.',result=audit(obs))
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
