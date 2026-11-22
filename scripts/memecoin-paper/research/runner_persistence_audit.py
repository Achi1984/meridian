"""Audit first 3x pool marks, subsequent persistence and entry-time controls per session."""
import argparse
from datetime import datetime
import json
from math import log
from zipfile import ZipFile

from new_pool_watch import USDC, WSOL
from runner_study import runner_signal


def timestamp(row):
    return row.get('observedAt',row['at'])


def collect(rows):
    first, tracks = {}, {}
    for row in rows:
        kind = row['event']
        if kind not in ('firstSeen','seenAgain'):
            continue
        pool, mint = row['pool'], row['mint']
        if kind=='firstSeen':
            first[pool] = row
            continue
        original = first[pool]
        if mint in tracks:
            path = tracks[mint]
            if ((pool,row['quote'])==(path[0]['pool'],path[0]['quote'])
                    and timestamp(row)>timestamp(path[-1])):
                path.append(row)
        elif runner_signal(original,row,timestamp(row)-timestamp(original),timestamp(row),(USDC,WSOL)):
            tracks[mint] = [row]
    return tracks


def assess(path):
    entry = path[0]
    price = entry['price']
    hit = next((r for r in path[1:] if r['price']>=3*price and r['liquidity']>0),None)
    if not hit:
        return None
    follow = next((r for r in path if 60<=timestamp(r)-timestamp(hit)<=180 and r['price']>0),None)
    return dict(hitAfter=timestamp(hit)-timestamp(entry),firstMultiple=hit['price']/price,
                hitLiquidity=hit['liquidity'], followMultiple=follow['price']/price if follow else None,
                followLiquidity=follow['liquidity'] if follow else None)


def age(row):
    return timestamp(row)-datetime.fromisoformat(row['created']).timestamp()


def features(r):
    return dict(ageSeconds=age(r),liquidity=r['liquidity'],volumeToLiquidity=r['volume']/r['liquidity'],
                buysPerSell=r['buys']/r['sells'])


def audit(rows):
    tracks = collect(rows)
    hits = {m:v for m,path in tracks.items() if (v:=assess(path))}
    result = []
    for mint,hit in hits.items():
        r = tracks[mint][0]
        # Require observed control coverage through the case's hit time.
        controls = [p[0] for m,p in tracks.items() if m not in hits and p[0]['dex']==r['dex']
                    and any(timestamp(s)-timestamp(p[0])>=hit['hitAfter'] and s['price']>0
                            and s['liquidity']>0 for s in p[1:])]
        def distance(c):
            return abs(log((age(c)+1)/(age(r)+1)))+abs(log(c['liquidity']/r['liquidity']))
        control = min(controls,key=distance) if controls else None
        result.append(dict(mint=mint,entry=features(r),control=features(control) if control else None,**hit))
    return result


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives',nargs='+')
    for path in parser.parse_args().archives:
        with ZipFile(path) as z,z.open('session/events.jsonl') as stream:
            for row in audit(json.loads(l) for l in stream):
                print(json.dumps(row))
