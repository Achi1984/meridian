"""Chronological offline tests of a learned single-split filter on two strategy families."""
import argparse
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
import json
import sys
from zipfile import ZipFile

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.extend([str(SCRIPTS/'memecoin-paper/research'), str(SCRIPTS/'spot-paper-advisor')])
from new_pool_watch import USDC, WSOL
from runner_study import runner_signal
from meme_failed_breakout import bars, signal, replay


def fit(rows):
    known = [(x,y) for x,y in rows if y is not None]
    choices = []
    for feature in known[0][0] if known else []:
        cut = median(x[feature] for x,y in known)
        groups = [[y for x,y in known if (x[feature] >= cut) == upper] for upper in (False,True)]
        if min(map(len,groups)) < 4:
            continue
        rates = [sum(y > 0 for y in group)/len(group) for group in groups]
        choices.append((abs(rates[0]-rates[1]), feature, cut, rates[1]>rates[0]))
    if not choices:
        raise ValueError('Insufficient labeled training data')
    _, feature, cut, upper = max(choices)
    return feature, cut, upper


def summary(rows):
    known = [y for x,y in rows if y is not None]
    return dict(selected=len(rows), priced=len(known), positive=sum(y>0 for y in known),
                median=median(known) if known else None, total=sum(known) if known else None)


def compare(train, test, control):
    feature, cut, upper = fit(train)
    return dict(training=summary(train), learnedSplit=[feature,cut,upper], baseline=summary(test),
                simple=summary([r for r in test if control(r[0])]),
                opposite=summary([r for r in test if not control(r[0])]),
                learned=summary([r for r in test if (r[0][feature]>=cut)==upper]))


def launches(file):
    first, picks = {}, {}
    with ZipFile(file) as archive, archive.open('session/events.jsonl') as stream:
        for line in stream:
            r = json.loads(line)
            if r['event'] not in ('firstSeen','seenAgain'):
                continue
            pool, mint, at = r['pool'], r['mint'], r.get('observedAt',r['at'])
            if r['event']=='firstSeen':
                first[pool] = r
                continue
            if mint in picks:
                entry, features, result = picks[mint]
                if (result is None and (r['pool'],r['quote'])==(entry['pool'],entry['quote'])
                        and 300<=at-entry.get('observedAt',entry['at'])<=600 and r['price']>0 and r['liquidity']>0):
                    picks[mint][2] = 100*(r['price']/entry['price']-1)
            elif runner_signal(first[pool],r,at-first[pool]['at'],at,(USDC,WSOL)):
                picks[mint] = [r,dict(flow=r['buys']/r['sells'], liquidity=r['liquidity'],
                                     advance=r['price']/first[pool]['price'], age=at-first[pool]['at']),None]
    return {m:(x,y) for m,(r,x,y) in picks.items()}


def doge(directory):
    window = deque(maxlen=20)
    groups = [[],[]]
    busy_until = 0
    for bar in bars(directory.glob('DOGEUSDT-5m-????-??.zip')):
        if window and bar[0]!=window[-1][0]+300:
            window.clear()
        window.append(bar)
        if len(window)<20:
            continue
        history = list(window)[:13]
        entry = window[13][0]
        if entry<=busy_until or entry%3600>=1800 or not signal(history):
            continue
        price = window[13][1]
        busy_until = next((b[0] for b in list(window)[14:] if b[1]>=1.02*price),window[-1][0])
        year = datetime.fromtimestamp(entry,timezone.utc).year
        result = replay(window)[year]['net']
        last = history[-1]
        features = dict(wick=last[2]/last[4]-1, runup=history[-2][4]/history[0][1]-1,
                        range=last[2]/last[3]-1)
        groups[int(year>=2025)].append((features,result))
    return groups


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('doge',type=Path)
    parser.add_argument('pilots',nargs=8)
    args = parser.parse_args()
    samples = [launches(p) for p in args.pilots]
    seen = set()
    groups = [[],[]]
    for i,sample in enumerate(samples):
        groups[int(i>=4)].extend(v for m,v in sample.items() if m not in seen)
        seen.update(sample)
    solana = compare(*groups,lambda x:x['flow']>=3)
    feature, cut, upper = solana['learnedSplit']
    for name, selected in [('baseline',groups[1]), ('simple',[r for r in groups[1] if r[0]['flow']>=3]),
                           ('opposite',[r for r in groups[1] if r[0]['flow']<3]),
                           ('learned',[r for r in groups[1] if (r[0][feature]>=cut)==upper])]:
        solana[name]['observed3x'] = sum(y is not None and y>=200 for _,y in selected)
    print(json.dumps(dict(solana=solana,
                          doge=compare(*doge(args.doge),lambda x:x['wick']>=.01)),indent=2))
