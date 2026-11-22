"""Counterfactual thresholds on observed pool marks and archived two-way quotes."""
import argparse
import json
from collections import Counter
from statistics import median
from zipfile import ZipFile
from new_pool_watch import USDC, WSOL
from runner_study import runner_signal


def paths(rows, minimum_flow):
    first, tracked = {}, {}
    for row in rows:
        if row['event'] not in ('firstSeen','seenAgain'):
            continue
        pool, mint = row['pool'], row['mint']
        at = row.get('observedAt',row['at'])
        if row['event']=='firstSeen':
            first[pool] = row
        elif mint in tracked:
            entry, path = tracked[mint]
            if (pool,row['quote'])==(entry['pool'],entry['quote']) and at>path[-1][0]:
                path.append((at,row['price'],row['liquidity']))
        elif runner_signal(first[pool],row,at-first[pool]['at'],at,(USDC,WSOL)) and row['buys']>=minimum_flow*row['sells']:
            tracked[mint] = row, [(at,row['price'],row['liquidity'])]
    return [p for _,p in tracked.values()]


def exit_mark(path, stop):
    start, price, _ = path[0]
    last = start
    for at, mark, liquidity in path[1:]:
        if at-last>120 or min(mark,liquidity)<=0:
            break
        ratio = mark/price
        if ratio<=1-stop or ratio>=3 or at-start>=900:
            return ratio
        last = at
    return None


def audit(archives):
    paths_by_flow = {r:[] for r in (1.5,2,3)}
    recoveries = []
    counts = Counter()
    account_stops = {s:[] for s in (.03,.04,.05,.06)}
    for file in archives:
        with ZipFile(file) as z, z.open('session/events.jsonl') as stream:
            rows = [json.loads(line) for line in stream]
        counts.update(r['event'] for r in rows)
        for buy in (r for r in rows if r['event']=='botBuy'):
            debit = buy['usdcRaw']+50_000
            later = [r for r in rows if r['event'] in ('botMark','botSell')
                     and r['mint']==buy['mint'] and r['at']>=buy['at']]
            for stop, exits in account_stops.items():
                for r in later:
                    credit = r['usdcRaw']-50_000
                    if credit<=debit*(1-stop) or r['event']=='botSell':
                        exits.append((credit-debit)/1_000_000)
                        break
        recoveries.extend(r['usdcRaw']/20_000_000 for r in rows
                          if r['event'] in ('roundTripQuote','confirmationRoundTrip'))
        for flow, cohort in paths_by_flow.items():
            cohort.extend(paths(rows,flow))
    results = {}
    for flow,cohort in paths_by_flow.items():
        outcomes = {}
        for stop in (.15,.30,.50):
            outcomes[stop] = [exit_mark(p,stop) for p in cohort]
        common = list(zip(*(outcomes.values())))
        common = [row for row in common if all(x is not None for x in row)]
        for index,(stop,values) in enumerate(outcomes.items()):
            closed = [v for v in values if v is not None]
            results[f'{flow}/{stop}'] = dict(signals=len(values),priced=len(closed),
                common=len(common),commonGrossUsdc=sum(20*(r[index]-1) for r in common) if common else None,
                medianClosedPct=100*(median(closed)-1) if closed else None)
    return dict(markComparison=results,quotePass={str(k):sum(r>=k for r in recoveries) for k in (.90,.95,.98)},
                accountExitNetUsdc=account_stops,twoWayQuotes=len(recoveries),paperBuys=counts['botBuy'],paperSells=counts['botSell'],
                missingExitQuotes=counts['botExitQuoteUnavailable'])


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives',nargs='+')
    print(json.dumps(audit(parser.parse_args().archives),indent=2))
