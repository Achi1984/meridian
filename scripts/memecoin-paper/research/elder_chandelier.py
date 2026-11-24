"""Frozen one-minute Elder and Chandelier challengers on original G paper fills."""
import json
import math
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError
from score_guarded_wave import score

def ema(values, length):
    line = [sum(values[:length]) / length]
    for v in values[length:]:
        line.append(line[-1] + 2 / (length + 1) * (v - line[-1]))
    return line

def signals(rows, at):
    end = at // 60 * 60
    bars = []
    for t in range(end - 60, end - 121 * 60, -60):
        if t not in rows:
            break
        bars.append(rows[t])
    bars.reverse()
    close = [b[4] for b in bars]
    elder, chandelier = 'unknown', None
    if len(close) >= 35:
        fast, slow = ema(close, 12), ema(close, 26)
        macd = [x-y for x,y in zip(fast[14:], slow)]
        signal = ema(macd, 9)
        trend = ema(close, 13)
        delta = (macd[-1]-signal[-1]) - (macd[-2]-signal[-2])
        if trend[-1] < trend[-2] and delta < 0:
            elder = 'red'
        elif trend[-1] > trend[-2] and delta > 0:
            elder = 'green'
        else:
            elder = 'neutral'
    if len(close) >= 23:
        ranges = [max(b[2]-b[3], abs(b[2]-prev[4]), abs(b[3]-prev[4])) for prev,b in zip(bars,bars[1:])]
        atr = sum(ranges[:22])/22
        for tr in ranges[22:]:
            atr += (tr-atr)/22
        chandelier = close[-1] <= max(b[2] for b in bars[-22:]) - 3*atr
    return elder, chandelier

def candles(pool, mint, end):
    if not re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}',pool):
        raise ValueError('pool')
    url = (f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/minute'
           f'?aggregate=1&currency=usd&token=base&limit=1000&before_timestamp={end}&include_empty_intervals=true')
    for attempt in range(3):
        try:
            with urlopen(Request(url,headers={'User-Agent':'Meridian-paper'}),timeout=20) as response:
                packet = json.load(response)
            break
        except (URLError,TimeoutError):
            if attempt == 2:
                raise
            time.sleep(12*(attempt+1))
    if packet['meta']['base']['address'] != mint:
        raise ValueError('mint mismatch')
    data = {}
    for b in packet['data']['attributes']['ohlcv_list']:
        if len(b)!=6 or b[0]%60 or not all(math.isfinite(x) and x>0 for x in b[1:5]) or b[3]>min(b[1],b[4]) or b[2]<max(b[1],b[4]):
            raise ValueError('invalid candle')
        if b[0] in data and data[b[0]] != b:
            raise ValueError('conflicting candle')
        data[b[0]]=b
    return data

def run(path, run_id):
    rows = [json.loads(s) for s in (path/'events.jsonl').read_text().splitlines()]
    status = json.loads((path/'status.json').read_text())
    assert rows[-1]['event']==status['lastEvent']=='finished'
    assert rows[-1]['at']==status['updatedAt']>=status['endsAt'] and status['endsAt']-status['startedAt']==28800
    pools = {(r['session'], r['mint']):r['pool'] for r in rows if r['event']=='cohortSelection'}
    entries = {(r['session'],r['mint']) for r in rows if r.get('arm')=='wave' and r['event']=='entry'}
    market, errors = {}, {}
    for key in sorted(entries):
        pool = pools[key]
        if pool in market:
            continue
        try:
            market[pool] = candles(pool,key[1],status['updatedAt'])
        except (KeyError,ValueError,URLError,TimeoutError) as exc:
            market[pool] = {}
            errors[pool] = str(exc)
        time.sleep(3)
    entry_log, marks = [], {}
    def state(key,row):
        return signals(market[pools[key]],row['at'])
    def allow(key,row):
        color,_ = state(key,row)
        entry_log.append(dict(session=key[0],mint=key[1],at=row['at'],elder=color))
        return color != 'red'
    def trail(key,row,fallback):
        _,hit = state(key,row)
        marks[key] = marks.get(key,False) or hit is not None
        return fallback if hit is None else hit
    g,h,i = score(rows),score(rows,allow_entry=allow),score(rows,trail_exit=trail)
    report = dict(runId=run_id,updatedAt=status['updatedAt'],G=g,H=h,I=i,elderEntries=entry_log,
                  chandelierCoverage=[dict(session=k[0],mint=k[1],available=v) for k,v in marks.items()],
                  providerErrors=errors)
    Path('technical-candles.json').write_text(json.dumps(market))
    Path('technical-paper.json').write_text(json.dumps(report))

if __name__=='__main__':
    run(Path(sys.argv[1]),int(sys.argv[2]))
