"""Prospective, advisory-only comparison for quoted Solana paper probes."""
import argparse
from collections import Counter
from hashlib import sha256
from http.client import HTTPSConnection, HTTPException
import json
import os
from pathlib import Path

MODEL = 'claude-haiku-4-5-20251001'
LIMIT = 10
PROMPT = ('Evaluate a single $20 Solana spot quote probe for a five-minute resale. '
          'TAKE if the supplied changes in price and liquidity, buy/sell counts, volume '
          'and two-way recovery support a positive net resale after $0.10 network costs. '
          'Otherwise SKIP. These are provider observations; wallet concentration, token '
          'safety and future prices are unknown. Use only the numeric snapshot.')
SCHEMA = {'type':'object','properties':{'vote':{'type':'string','enum':['TAKE','SKIP']}},
          'required':['vote'],'additionalProperties':False}


def features(first, current, age, recovery):
    return dict(secondsSinceFirst=age, priceMultiple=current['price']/first['price'],
                firstLiquidityUsd=first['liquidity'], currentLiquidityUsd=current['liquidity'],
                volume5mUsd=current['volume'], buys5m=current['buys'], sells5m=current['sells'],
                immediateMinReturnUsdc=recovery/1e6)


def canonical(obj):
    return json.dumps(obj,sort_keys=True,separators=(',',':'),allow_nan=False)


def ask(data, key):
    body = dict(model=MODEL, max_tokens=128, system=PROMPT,
                messages=[dict(role='user',content=canonical(data))],
                output_config=dict(format=dict(type='json_schema',schema=SCHEMA)))
    conn = HTTPSConnection('api.anthropic.com',timeout=8)
    try:
        conn.request('POST','/v1/messages',body=canonical(body).encode(),headers={
            'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'})
        res = conn.getresponse()
        if res.status != 200:
            raise ValueError(f'HTTP_{res.status}')
        raw = res.read(32769)
        if len(raw)>32768:
            raise ValueError('response_size')
        packet = json.loads(raw)
        if packet['stop_reason']!='end_turn' or packet['model']!=MODEL:
            raise ValueError('unexpected_response')
        parts = [b['text'] for b in packet['content'] if b['type']=='text']
        vote = json.loads(''.join(parts))['vote']
        if vote not in ('TAKE','SKIP'):
            raise ValueError('invalid_vote')
        return dict(vote=vote, usage=packet.get('usage',{}))
    finally:
        conn.close()


class Shadow:
    def __init__(self, enabled):
        self.key = os.environ.get('ANTHROPIC_API_KEY') if enabled else None
        if enabled and not self.key:
            raise ValueError('Claude comparison requires ANTHROPIC_API_KEY')
        self.calls = 0

    def record(self, mint, data, event):
        digest = sha256(canonical(data).encode()).hexdigest()
        event('decisionSnapshot',mint=mint,digest=digest,features=data)
        if not self.key or self.calls >= LIMIT:
            event('shadowUnavailable',mint=mint,reason='budget' if self.key else 'disabled')
            return
        self.calls += 1
        try:
            result = ask(data,self.key)
        except (HTTPException,OSError,ValueError,KeyError,IndexError,TypeError):
            event('shadowUnavailable',mint=mint,reason='api_error')
            return
        event('shadowVote',mint=mint,digest=digest,model=MODEL,**result)


def compare(events):
    probes, votes, snapshots, terminal = {}, {}, {}, set()
    unavailable, token_usage = Counter(), Counter()
    started = {}
    for e in events:
        kind, mint = e['event'],e.get('mint')
        if kind=='paperProbe':
            if mint in probes:
                raise ValueError('duplicate probe')
            probes[mint]=None
            started[mint]=e.get('at')
        elif kind=='decisionSnapshot' and mint in probes and mint not in terminal:
            if mint in snapshots or sha256(canonical(e['features']).encode()).hexdigest()!=e['digest']:
                raise ValueError('invalid decision snapshot')
            snapshots[mint]=e['digest']
        elif kind=='shadowVote':
            if (mint not in snapshots or mint in terminal or mint in votes or
                    snapshots[mint]!=e['digest'] or e['vote'] not in ('TAKE','SKIP') or
                    started[mint] is None or not 0 <= e['at']-started[mint] < 300):
                raise ValueError('late, unbound or duplicate vote')
            votes[mint]=e['vote']
            for key in ('input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'):
                token_usage[key] += e.get('usage',{}).get(key,0)
        elif kind=='shadowUnavailable':
            unavailable[e['reason']]+=1
        elif kind in ('fiveMinuteExitQuote','unresolved','unresolvedAtEnd') and mint in probes:
            if mint in terminal:
                raise ValueError('duplicate terminal outcome')
            terminal.add(mint)
            if kind=='fiveMinuteExitQuote':
                probes[mint]=e['netAfterAssumedNetworkUsd']
    paired = [m for m in votes if probes[m] is not None]
    scanner = sum(probes[m] for m in paired)
    claude = sum(probes[m] for m in paired if votes[m]=='TAKE')
    priced = [v for v in probes.values() if v is not None]
    return dict(scannerAllPricedUsd=sum(priced) if priced else None,
                modelTokensOnSuccessfulVotes=dict(token_usage), probes=len(probes), priced=sum(v is not None for v in probes.values()),
                unpriced=sum(v is None for v in probes.values()), votes=len(votes),
                unavailable=dict(unavailable), pairedPriced=len(paired),
                pairedTaken=sum(votes[m]=='TAKE' for m in paired),
                unpricedTaken=sum(probes[m] is None and v=='TAKE' for m,v in votes.items()),
                unpricedSkipped=sum(probes[m] is None and v=='SKIP' for m,v in votes.items()),
                scannerPairedUsd=scanner if paired else None, claudePairedUsd=claude if paired else None,
                differenceBeforeApiCostsUsd=claude-scanner if paired else None)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('events',type=Path)
    with parser.parse_args().events.open() as stream:
        print(json.dumps(compare(json.loads(line) for line in stream)))
