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

from meme_paper_account import FEE, UNIT, MemeAccount
from runner_study import RunnerStudy, runner_signal
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


def failed_checks(first, now, age, *, liquidity_floor=10000):
    checks = {
        'observationWindow': 60 <= age <= 900,
        'tokenPair': (now['mint'] == first['mint'] and now['quote'] == first['quote']
                      and now['quote'] in (USDC, WSOL) and now['mint'] not in (USDC, WSOL)),
        'priceMomentum': first['price'] > 0 and now['price']/first['price'] >= 1.10,
        'liquidity': now['liquidity'] >= max(liquidity_floor, first['liquidity']),
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


def additional_discovery_candidate(row, now):
    if row['liquidity'] < 10000:
        return False
    if launchpad_candidate(row, row, now):
        return True
    if row.get('dex') != 'pumpswap' or row['quote'] not in (USDC, WSOL):
        return False
    try:
        age = now - datetime.fromisoformat(row['created']).timestamp()
    except (TypeError, ValueError, OverflowError):
        return False
    return 0 <= age <= 3600 and row['mint'] not in (USDC, WSOL)


class PersistenceStudy:
    """Observe one fixed confirmation and one later outcome for each 5k signal."""
    def __init__(self):
        self.signals = {}
        self.rejected = set()
        self.confirmed = {}
        self.returns = {}

    def observe(self, first, row, age, now):
        pool = row['pool']
        if pool not in self.signals:
            if (launchpad_candidate(first,row,now)
                    and not failed_checks(first,row,age,liquidity_floor=5000)):
                self.signals[pool] = (now,row['price'])
            return
        if pool in self.rejected or pool in self.returns:
            return
        if (row['mint'],row['quote']) != (first['mint'],first['quote']) or row['price'] <= 0:
            return
        if pool in self.confirmed:
            at, price = self.confirmed[pool]
            if 300 <= now-at <= 360:
                self.returns[pool] = 100*(row['price']/price-1)
            return
        at, price = self.signals[pool]
        if 60 <= now-at <= 120:
            if (row['price'] >= price and launchpad_candidate(first,row,now)
                    and not failed_checks(first,row,age,liquidity_floor=5000)):
                self.confirmed[pool] = (now,row['price'])
            else:
                self.rejected.add(pool)

    def due(self, now):
        pending = [(at+60,p) for p,(at,_) in self.signals.items()
                   if p not in self.confirmed and p not in self.rejected and 60 <= now-at <= 120]
        pending.extend((at+300,p) for p,(at,_) in self.confirmed.items()
                       if p not in self.returns and 300 <= now-at <= 360)
        return [pool for _,pool in sorted(pending)]


def confirmed_quote_probe(pool, mint, observed_at, event):
    """Measure the immediate conservative round trip independently of the paper ledger."""
    if not 0 <= int(time.time()) - observed_at <= 30:
        event('confirmationQuoteSkipped',pool=pool,reason='stale')
        return
    qty = None
    side = 'buy'
    try:
        qty = spot_quote(USDC,mint,SIZE)
        side = 'sell'
        returned = spot_quote(mint,USDC,qty)
    except (HTTPError, URLError, TimeoutError, ValueError, KeyError, TypeError, OSError) as exc:
        event('confirmationQuoteUnavailable',pool=pool,mint=mint,side=side,reason=type(exc).__name__)
        return qty
    event('confirmationRoundTrip',pool=pool,mint=mint,usdcRaw=returned,
          passesGate=returned*100 >= SIZE*95, confirmedAt=observed_at)
    return qty


def early_inflow(first, row, age, now):
    return (60 <= age <= 900 and launchpad_candidate(first, row, now)
            and (first['mint'], first['quote']) == (row['mint'], row['quote'])
            and row['quote'] in (USDC, WSOL) and row['mint'] not in (USDC, WSOL)
            and first['liquidity'] > 0 and row['liquidity'] >= max(3000, 1.10 * first['liquidity'])
            and first['price'] > 0 and 1 <= row['price']/first['price'] < 1.10
            and row['sells'] >= 3 and row['buys'] >= 1.5 * row['sells'])


class InflowQuotes:
    def __init__(self):
        self.seen = set()
        self.pending = {}
        self.quoted_net = []

    def enter(self, row, event):
        pool, mint = row['pool'], row['mint']
        if pool in self.seen:
            return
        self.seen.add(pool)
        if len(self.seen) > 12:
            event('inflowSkipped', pool=pool, reason='sessionLimit')
            return
        try:
            qty = spot_quote(USDC, mint, SIZE)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            event('inflowBuyUnavailable', pool=pool, mint=mint, reason=type(exc).__name__)
            return
        self.pending[pool] = (mint, qty, int(time.time()))
        event('inflowBuyQuote', pool=pool, mint=mint, tokensRaw=qty, usdcRaw=SIZE)

    def exits(self, event, final=False):
        for pool, (mint, qty, opened) in list(self.pending.items()):
            age = int(time.time()) - opened
            if 180 <= age <= 300:
                try:
                    returned = spot_quote(mint, USDC, qty)
                except (OSError, ValueError, KeyError, TypeError) as exc:
                    event('inflowSellUnavailable', pool=pool, age=age, reason=type(exc).__name__)
                else:
                    age = int(time.time()) - opened
                    if age <= 300:
                        net = returned - SIZE - 2*FEE
                        self.quoted_net.append(net)
                        event('inflowExitQuote', pool=pool, mint=mint, age=age, usdcRaw=returned,
                              netAfterAssumedFeesUsdc=net/UNIT)
                        del self.pending[pool]
                        continue
            if final or age > 300:
                event('inflowUnpriced', pool=pool, age=age)
                del self.pending[pool]


def run(out, ticks, *, claude=False, account=None, probe_confirmations=False):
    entry_quote = quote if account is None else spot_quote
    shadow = Shadow(claude)
    out.mkdir(parents=True,exist_ok=True)
    counts = Counter()
    first, last, attempted, pending = {}, {}, set(), {}
    inflow_at = {}
    inflow_priced = set()
    comparison_signals = {}
    comparison_priced = set()
    persistence = PersistenceStudy()
    retried_mints = set()
    probed = set()
    exit_probes = {}
    inflow = InflowQuotes()
    runners = RunnerStudy(spot_quote, USDC, SIZE)
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
                    if account is not None:
                        if (probe_confirmations and tick < ticks-6
                                and runner_signal(original, x, t-born, t, (USDC, WSOL))):
                            runners.enter(x, event)
                        persistence.observe(original,x,t-born,t)
                        if probe_confirmations and early_inflow(original, x, t-born, t):
                            inflow_at.setdefault(pool, t)
                            inflow.enter(x, event)
                        if (pool in inflow_at and 300 <= t-inflow_at[pool] <= 360 and x['price'] > 0
                                and (x['mint'], x['quote']) == (original['mint'], original['quote'])):
                            inflow_priced.add(pool)
                    if account is not None and launchpad_candidate(original,x,t):
                        if (pool not in comparison_signals
                                and not failed_checks(original,x,t-born,liquidity_floor=5000)):
                            comparison_signals[pool] = (t,x['mint'],x['quote'])
                    if pool in comparison_signals:
                        at,mint,quote_token = comparison_signals[pool]
                        if 300 <= t-at <= 360 and x['price'] > 0 and (x['mint'],x['quote']) == (mint,quote_token):
                            comparison_priced.add(pool)
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
                event('botSell' if reason else 'botMark',mint=mint,usdcRaw=sell,retry=retry,reason=reason,
                      positionId=f"{position['opened']}:{mint}",tokensRaw=int(position['qty']))

        for tick in range(ticks):
            clock = time.monotonic()
            now = int(time.time())
            due = sorted((p for p,(t,_) in first.items() if 60<=now-t<=900 and now-last[p]>=60),
                         key=lambda p:(last[p],p))[:25]
            followups = sorted((p for p,(at,_,_) in comparison_signals.items()
                                if p not in comparison_priced and 300 <= now-at <= 360),
                               key=lambda p:(comparison_signals[p][0],p))
            # Reuse the existing provider batch; oldest due observations are read first.
            inflow_due = sorted((p for p, at in inflow_at.items() if p not in inflow_priced
                                and 300 <= now-at <= 360), key=inflow_at.get)
            due = list(dict.fromkeys(followups + persistence.due(now) + inflow_due + due))[:25]
            candidates = {}
            runners.mark(event, final=tick+1 == ticks)
            inflow.exits(event)
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
                page = get(GT+'/new_pools?page=1',120)['data']
                observe(page, candidates)
                event('feedRead')
            except errors as exc:
                event('feedError', reason=type(exc).__name__)
            if probe_confirmations and account is not None:
                try:
                    extra = get(GT+'/new_pools?page=2',120)['data']
                    added = 0
                    for item in extra:
                        try:
                            row = snapshot(item)
                        except errors:
                            continue
                        if (row['pool'] not in first and additional_discovery_candidate(row, int(time.time()))):
                            observe([item], candidates)
                            added += 1
                    event('liquidDiscoveryPage', addedPools=added)
                except errors as exc:
                    event('liquidDiscoveryUnavailable', reason=type(exc).__name__)
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
                                event('botBuy',mint=mint,pool=pool,tokensRaw=qty,usdcRaw=SIZE,
                                      positionId=f'{decision_at}:{mint}')
                except errors as exc:
                    status = exc.code if isinstance(exc, HTTPError) else None
                    event('quoteUnavailable', mint=mint, side=side, reason=type(exc).__name__,
                          httpStatus=status)
                    transient = (status in (408, 500, 502, 503, 504) if status is not None
                                 else isinstance(exc, (TimeoutError, URLError, ConnectionError)))
                    if account is not None and transient and mint not in retried_mints:
                        # A subsequent tick must select a freshly observed candidate again.
                        retried_mints.add(mint)
                        attempted.discard(mint)
                        event('quoteRetryEligible', pool=pool, mint=mint, side=side)
            if probe_confirmations:
                for pool in sorted(persistence.confirmed.keys()-probed):
                    probed.add(pool)
                    at,_ = persistence.confirmed[pool]
                    if len(probed) <= 12:
                        mint = first[pool][1]['mint']
                        qty = confirmed_quote_probe(pool, mint, at, event)
                        if qty:
                            for horizon in (240, 300):
                                exit_probes[pool, horizon] = (mint, qty, at)
                    else:
                        event('confirmationQuoteSkipped',pool=pool,reason='sessionLimit')
                for (pool, horizon), (mint, qty, at) in list(exit_probes.items()):
                    age = int(time.time()) - at
                    if age < horizon and tick+1 < ticks:
                        continue
                    del exit_probes[pool, horizon]
                    fields = dict(pool=pool, mint=mint, horizonSeconds=horizon,
                                  ageSeconds=age, tokenQty=qty, confirmedAt=at)
                    if not horizon <= age < horizon+60:
                        event('confirmationExitMissing', **fields,
                              reason='sessionEnd' if age < horizon else 'missedWindow')
                        continue
                    try:
                        returned = spot_quote(mint, USDC, qty)
                    except errors as exc:
                        event('confirmationExitMissing', **fields, reason=type(exc).__name__)
                    else:
                        event('confirmationExitQuote', **fields, usdcRaw=returned)
            summary = dict(ticks=tick+1,pools=len(first),openProbes=len(pending),events=dict(counts))
            if account is not None:
                summary['account'] = account.status(int(time.time()))
                summary['decisionAuditVersion'] = 1
                summary['probeConfirmations'] = probe_confirmations
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
        inflow.exits(event, final=True)
        if probe_confirmations and account is not None:
            summary['earlyInflow'] = dict(signals=len(inflow.seen), entryQuotes=counts['inflowBuyQuote'],
                buyUnavailable=counts['inflowBuyUnavailable'], skipped=counts['inflowSkipped'],
                pricedExits=len(inflow.quoted_net), unresolved=counts['inflowUnpriced'],
                pricedNetUsdc=sum(inflow.quoted_net)/UNIT if inflow.quoted_net else None)
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
    parser.add_argument('--probe-confirmations',action='store_true',help='Probe up to 12 confirmations and 12 early liquidity inflows separately')
    args=parser.parse_args()
    if args.paper_account and args.claude:
        parser.error('Claude comparison belongs to the quote-probe cohort')
    account = MemeAccount(args.paper_account) if args.paper_account else None
    try:
        run(args.output,args.ticks,claude=args.claude,account=account,probe_confirmations=args.probe_confirmations)
    finally:
        if account is not None:
            account.close()
