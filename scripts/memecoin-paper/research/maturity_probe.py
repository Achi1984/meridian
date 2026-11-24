"""Recheck formerly young pools by address using saved scanner journals."""
import argparse
from collections import Counter
import json
from math import ceil
import time

from meme_paper_account import FEE, UNIT
from new_pool_watch import ADDRESS, GT, SIZE, USDC, snapshot, spot_quote
from newcomer_research import ERRORS
from newcomer_scanner import market_reader, sample, timestamp
from volume_momentum import entry_signal


def due_pools(journals, now):
    pools = {}
    for journal in journals:
        for line in journal:
            event = json.loads(line)
            if event['event'] != 'scannerCandidate' or 'shortHistory' not in event['reasons']:
                continue
            due = event['earliest30mAt']
            if not event['asOf'] < due <= now:
                continue
            row = event['row']
            if not ADDRESS.fullmatch(row['pool']):
                raise ValueError('invalid pool address')
            key = row['pool']
            if key in pools and pools[key] != (row['mint'], row['quote'], due):
                raise ValueError('conflicting pool identity or maturity time')
            pools[key] = row['mint'], row['quote'], due
    return pools


def probe(pools, fetch, quote=spot_quote, clock=time.time):
    addresses = sorted(pools)
    for start in range(0, len(addresses), 30):
        batch = addresses[start:start+30]
        try:
            items = fetch(GT+'/pools/multi/'+','.join(batch), 120)['data']
            current = {r['pool']: r for r in map(snapshot, items)}
        except ERRORS:
            current = None
        for pool in batch:
            mint, counter, due = pools[pool]
            at = int(clock())
            result = dict(pool=pool, mint=mint, earliest30mAt=due, checkedAt=at,
                          secondsAfterMaturity=at-due)
            row = (current or {}).get(pool)
            if current is None:
                result['outcome'] = 'poolFeedUnavailable'
            elif not row:
                result['outcome'] = 'poolMissing'
            elif (row['mint'], row['quote']) != (mint, counter):
                result['outcome'] = 'identityMismatch'
            elif row['liquidity'] < 5000:
                result.update(outcome='lowLiquidity', liquidityUsd=row['liquidity'])
            else:
                end = at//60*60
                try:
                    passed, evidence = entry_signal(row, end, fetch)
                    result.update(evidence=evidence, liquidityUsd=row['liquidity'])
                    if not passed:
                        result['outcome'] = evidence.get('reason', 'momentumRejected')
                    else:
                        quantity = quote(USDC, mint, SIZE)
                        net = quote(mint, USDC, quantity)-2*FEE
                        result['netResaleUsdc'] = net/UNIT
                        result['outcome'] = 'quotePassed' if net >= 19_600_000 else 'roundTripCost'
                    if clock()-end >= 120:
                        result['outcome'] = 'staleSignal'
                except ERRORS as exc:
                    result.update(outcome='observationUnavailable', error=type(exc).__name__)
            yield result


def forward(fetch, clock=time.time, sleep=time.sleep):
    as_of = int(clock()//60)*60
    groups = {}
    for row in sample(as_of, fetch):
        due = ceil(timestamp(row['created'])/60)*60 + 1800
        if due > as_of:
            groups.setdefault(due, {})[row['pool']] = row['mint'], row['quote'], due
    yield dict(event='maturityCohort', asOf=as_of,
               pools=[dict(pool=pool, mint=mint, earliest30mAt=due)
                      for due, group in sorted(groups.items())
                      for pool, (mint, _, _) in sorted(group.items())])
    for due, group in sorted(groups.items()):
        sleep(max(0, due-clock()))
        yield from probe(group, fetch, clock=clock)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('journals', nargs='*', type=argparse.FileType('r'))
    args = parser.parse_args()
    fetch = market_reader(interval=13)
    results = probe(due_pools(args.journals, time.time()), fetch) if args.journals else forward(fetch)
    outcomes = Counter()
    for result in results:
        if 'outcome' in result:
            outcomes[result['outcome']] += 1
        print(json.dumps(result, allow_nan=False), flush=True)
    print(json.dumps(dict(event='maturitySummary', checked=sum(outcomes.values()), outcomes=outcomes)))
