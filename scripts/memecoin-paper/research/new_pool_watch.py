"""Prospective Solana pool observation and USDC quote probes; public GET endpoints only."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
from math import isfinite
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from meme_paper_account import MemeAccount
from pool_shadow import Shadow, features

GT = 'https://api.geckoterminal.com/api/v2/networks/solana'
ROUTE = 'https://transaction-v1.raydium.io/compute/swap-base-in'
USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
WSOL = 'So11111111111111111111111111111111111111112'
ADDRESS = re.compile(r'[1-9A-HJ-NP-Za-km-z]{32,44}')
SIZE = 20_000_000


def get(url, max_age):
    with urlopen(Request(url, headers={'User-Agent':'Meridian-spot-observer'}), timeout=12) as r:
        stamp = parsedate_to_datetime(r.headers['Date']).timestamp()
        if not -10 <= time.time()-stamp <= max_age or int(r.headers.get('Age',0)) > max_age:
            raise ValueError('stale provider response')
        buf = r.read(1_500_001)
        if len(buf) > 1_500_000:
            raise ValueError('response too large')
        return json.loads(buf)


def number(value):
    n = float(value)
    if not isfinite(n) or n < 0:
        raise ValueError('invalid numeric observation')
    return n


def snapshot(p):
    a = p['attributes']
    ids = [p['relationships'][key]['data']['id'] for key in ('base_token','quote_token')]
    if not all(i.startswith('solana_') for i in ids):
        raise ValueError('unexpected chain')
    mint, quote = [i[7:] for i in ids]
    pool = a['address']
    if p['id'] != 'solana_'+pool or not all(ADDRESS.fullmatch(k) for k in (mint, quote, pool)):
        raise ValueError('invalid pool identity')
    counts = a['transactions']['m5']
    return dict(pool=pool, mint=mint, quote=quote, created=a['pool_created_at'],
                dex=p['relationships'].get('dex',{}).get('data',{}).get('id'),
                price=number(a['base_token_price_usd']), liquidity=number(a['reserve_in_usd']),
                volume=number(a['volume_usd']['m5']), buys=number(counts['buys']), sells=number(counts['sells']))


def failed_checks(first, now, age):
    checks = {
        'observationWindow': 60 <= age <= 900,
        'tokenPair': (now['mint'] == first['mint'] and now['quote'] == first['quote']
                      and now['quote'] in (USDC, WSOL) and now['mint'] not in (USDC, WSOL)),
        'priceMomentum': first['price'] > 0 and now['price']/first['price'] >= 1.10,
        'liquidity': now['liquidity'] >= max(10000, first['liquidity']),
        'volume': now['volume'] >= 3000,
        'orderFlow': now['buys'] >= now['sells'] >= 3,
    }
    return [name for name, passed in checks.items() if not passed]


def qualifies(first, now, age):
    return not failed_checks(first, now, age)


def quote(src, dst, amount):
    q = get(ROUTE+'?'+urlencode(dict(inputMint=src, outputMint=dst, amount=amount,
                                      slippageBps=100, txVersion='V0')), 30)
    d = q.get('data') or {}
    if not (q.get('success') and d.get('inputMint')==src and d.get('outputMint')==dst
            and d.get('inputAmount')==str(amount) and d.get('routePlan')):
        raise ValueError('no matching route')
    out, minimum = int(d['outputAmount']), int(d['otherAmountThreshold'])
    if not 0 < minimum <= out:
        raise ValueError('invalid quote amounts')
    return minimum


def launchpad_candidate(first, current, now):
    if 'pump-fun' not in (first.get('dex'), current.get('dex')):
        return False
    try:
        created = datetime.fromisoformat(first['created']).timestamp()
    except (TypeError, ValueError, OverflowError):
        return False
    return 0 <= now-created <= 3600


def spot_quote(src, dst, amount):
    params = dict(inputMint=src,outputMint=dst,amount=amount,slippageBps=100,swapMode='ExactIn')
    data = get('https://api.jup.ag/swap/v1/quote?'+urlencode(params),30)
    if (data.get('inputMint')!=src or data.get('outputMint')!=dst or data.get('inAmount')!=str(amount)
            or data.get('swapMode')!='ExactIn' or data.get('slippageBps')!=100 or not data.get('routePlan')):
        raise ValueError('no matching spot route')
    minimum, expected = int(data['otherAmountThreshold']), int(data['outAmount'])
    if not 0 < minimum <= expected:
        raise ValueError('invalid spot quote amounts')
    return minimum


def run(out, ticks, *, claude=False, account=None):
    entry_quote = quote if account is None else spot_quote
    shadow = Shadow(claude)
    out.mkdir(parents=True,exist_ok=True)
    counts = Counter()
    first, last, attempted, pending = {}, {}, set(), {}
    errors = (HTTPError, URLError, TimeoutError, ValueError, KeyError, TypeError, OSError)
    with (out/'events.jsonl').open('x', buffering=1) as ledger:
        def event(kind, **fields):
            counts[kind] += 1
            ledger.write(json.dumps(dict(at=int(time.time()), event=kind, **fields), allow_nan=False)+'\n')

        def observe(items, candidates):
            for item in items:
                try:
                    x = snapshot(item)
                except errors:
                    event('invalidObservation')
                    continue
                t = int(time.time())
                pool = x['pool']
                if pool not in first:
                    first[pool] = (t, x)
                    event('firstSeen', **x)
                else:
                    born, original = first[pool]
                    event('seenAgain', observedAge=t-born, observedAt=t, **x)
                    if (qualifies(original,x,t-born) and x['mint'] not in attempted
                            and (account is None or launchpad_candidate(original,x,t))):
                        candidates[pool] = (x['price']/original['price'],pool,x['mint'],t-born,original,x)
                    elif pool in candidates:
                        del candidates[pool]
                        event('signalWithdrawn',pool=pool,mint=x['mint'])
                last[pool] = t

        def mark_positions(final, retry=0):
            for position in account.active():
                mint = position['mint']
                try:
                    sell = spot_quote(mint,USDC,int(position['qty']))
                except errors as exc:
                    account.observe(mint,None,int(time.time()))
                    event('botExitQuoteUnavailable',mint=mint,retry=retry,reason=type(exc).__name__)
                    continue
                reason = account.observe(mint,sell,int(time.time()),final=final)
                event('botSell' if reason else 'botMark',mint=mint,usdcRaw=sell,retry=retry,reason=reason)

        for tick in range(ticks):
            clock = time.monotonic()
            now = int(time.time())
            due = sorted((p for p,(t,_) in first.items() if 60<=now-t<=900 and now-last[p]>=60),
                         key=lambda p:(last[p],p))[:25]
            candidates = {}
            if due:
                try:
                    items = get(GT+'/pools/multi/'+','.join(due),120)['data']
                    returned = {p['attributes']['address'] for p in items}
                    for p in set(due)-returned:
                        event('missingOnRefresh',pool=p)
                        last[p]=now
                    observe(items, candidates)
                except errors as exc:
                    event('refreshError', reason=type(exc).__name__)
            try:
                observe(get(GT+'/new_pools?page=1',120)['data'], candidates)
                event('feedRead')
            except errors as exc:
                event('feedError', reason=type(exc).__name__)
            for mint,(opened,qty) in list(pending.items()):
                if int(time.time())-opened >= 300:
                    try:
                        usd = quote(mint, USDC, qty)
                        event('fiveMinuteExitQuote', mint=mint, age=int(time.time())-opened,
                              usdcRaw=usd, netAfterAssumedNetworkUsd=(usd-SIZE)/1e6-.10)
                        del pending[mint]
                    except errors as exc:
                        event('exitUnavailable',mint=mint,reason=type(exc).__name__)
                        if int(time.time())-opened >= 600:
                            event('unresolved',mint=mint)
                            del pending[mint]
            if account is not None:
                mark_positions(final=tick+1==ticks)
            capacity = len(pending)<3 if account is None else len(account.active())<3
            if candidates and tick < ticks-6 and capacity:
                _,pool,mint,age,original,current = max(candidates.values(),key=lambda row:row[:3])
                attempted.add(mint)
                event('momentumCandidate',pool=pool,mint=mint)
                try:
                    side = 'buy'
                    qty = entry_quote(USDC,mint,SIZE)
                    side = 'sell'
                    sell = entry_quote(mint,USDC,qty)
                    event('roundTripQuote',pool=pool,mint=mint,tokensRaw=qty, usdcRaw=sell)
                    if sell >= .95*SIZE:
                        if account is None:
                            pending[mint] = int(time.time()),qty
                            event('paperProbe',mint=mint)
                            shadow.record(mint,features(original,current,age,sell),event)
                        else:
                            decision_at = int(time.time())
                            if (not qualifies(original,current,decision_at-first[pool][0])
                                    or not launchpad_candidate(original,current,decision_at)):
                                event('signalExpired',pool=pool,mint=mint)
                            elif account.buy(mint,pool,qty,sell,decision_at):
                                event('botBuy',mint=mint,pool=pool,tokensRaw=qty,usdcRaw=SIZE)
                except errors as exc:
                    event('quoteUnavailable', mint=mint,side=side,reason=type(exc).__name__)
            summary = dict(ticks=tick+1,pools=len(first),openProbes=len(pending),events=dict(counts))
            if account is not None:
                summary['account'] = account.status(int(time.time()))
                summary['decisionAuditVersion'] = 1
            (out/'summary.json').write_text(json.dumps(summary))
            print(json.dumps(summary),flush=True)
            if tick+1 < ticks:
                time.sleep(max(0,60-(time.monotonic()-clock)))
        if account is not None:
            retry = 0
            while account.active() and retry < 3:
                time.sleep(30)
                retry += 1
                mark_positions(final=True, retry=retry)
            for position in account.active():
                event('botExitUnresolved', mint=position['mint'], pool=position['pool'])
            summary['exitRetryRounds'] = retry
            summary['account'] = account.status(int(time.time()))
        for mint in pending:
            event('unresolvedAtEnd',mint=mint)
        summary.update(events=dict(counts))
        (out/'summary.json').write_text(json.dumps(summary))
    if not first:
        raise RuntimeError('No valid observations in pilot')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    parser.add_argument('--ticks',type=int,choices=range(1,61),default=60,metavar='1..60')
    parser.add_argument('--claude',action='store_true',help='Enable up to ten advisory Claude calls')
    parser.add_argument('--paper-account',type=Path,help='Trade the Pump.fun paper strategy in this SQLite account')
    args=parser.parse_args()
    if args.paper_account and args.claude:
        parser.error('Claude comparison belongs to the quote-probe cohort')
    account = MemeAccount(args.paper_account) if args.paper_account else None
    try:
        run(args.output,args.ticks,claude=args.claude,account=account)
    finally:
        if account is not None:
            account.close()
