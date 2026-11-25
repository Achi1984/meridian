"""Quote-only prospective comparison on a fixed list of Solana pools."""
import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from new_pool_watch import ADDRESS, FEE, GT, SIZE, USDC, get, qualifies, snapshot, spot_quote_amounts
from roundtrip_quote_audit import observe


def buyer_windows(rows, mint, end):
    """Measure provider-reported buyers in two complete, disjoint five-minute windows."""
    start = end - 600
    buyers = [set(), set()]
    oldest = None
    for row in rows:
        a = row['attributes']
        ts = datetime.fromisoformat(a['block_timestamp']).timestamp()
        oldest = ts if oldest is None else min(oldest, ts)
        if not start <= ts < end or a['to_token_address'] != mint or a['is_anomalous']:
            continue
        wallet = a['tx_from_address']
        if not wallet or not ADDRESS.fullmatch(wallet):
            raise ValueError('buyer address unavailable')
        buyers[int(ts >= end - 300)].add(wallet)
    if oldest is None or oldest >= start:
        return dict(complete=False)
    fresh = len(buyers[1] - buyers[0])
    return dict(complete=True, earlier=len(buyers[0]), later=len(buyers[1]),
                newInLater=fresh, passes=len(buyers[0]) >= 3 and fresh >= 3)


def pool_state(pool):
    state = snapshot(get(f'{GT}/pools/{pool}', 60)['data'])
    if state['pool'] != pool:
        raise ValueError('pool mismatch')
    return state


def wait_until(ts):
    time.sleep(max(0, ts - time.time()))


def measure(pool):
    row = dict(pool=pool)
    try:
        first = pool_state(pool)
        start = time.time()
        wait_until(start + 75)
        current = pool_state(pool)
        end = int(time.time())
        row.update(mint=current['mint'], decision=end, baseline=qualifies(first,current,end-start))
        trades = get(f'{GT}/pools/{pool}/trades', 30)['data']
        row['buyers'] = buyer_windows(trades, current['mint'], end)
        probe = observe(current['mint'])
        row['roundtrip'] = probe
        row['costPass'] = probe['conservativeLossPct'] <= 3
        # Entry is quoted again after both filters are known.
        qty, minimum = spot_quote_amounts(USDC, current['mint'], SIZE)
        row.update(entryAt=time.time(), entryQty=qty, minimumEntryQty=minimum)
        wait_until(row['entryAt'] + 180)
        sale, floor = spot_quote_amounts(current['mint'], USDC, minimum)
        row.update(exitAt=time.time(), exitExpectedRaw=sale, exitMinimumRaw=floor,
                   conservativeNetPct=100*(floor-2*FEE-SIZE)/SIZE)
    except (OSError, ValueError, TypeError, KeyError, IndexError) as exc:
        row['error'] = str(exc)
    return row


def report(rows):
    arms = {}
    for name, require_buyers, require_cost in [('baseline',False,False),('buyers',True,False),
                                                ('cost',False,True),('both',True,True)]:
        count = unknown = 0
        outcomes = []
        for r in rows:
            if r.get('baseline') is False:
                continue
            buyers = r.get('buyers',{}).get('passes')
            checks = [r.get('baseline')]
            if require_buyers:
                checks.append(buyers)
            if require_cost:
                checks.append(r.get('costPass'))
            if False in checks:
                continue
            if None in checks:
                unknown += 1
                continue
            count += 1
            if 'conservativeNetPct' in r:
                outcomes.append(r['conservativeNetPct'])
        arms[name] = dict(eligible=count, unknown=unknown, exits=len(outcomes),
                          meanConservativeNetPct=sum(outcomes)/len(outcomes) if outcomes else None)
    return dict(arms=arms, observations=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('pools', nargs='+')
    args = parser.parse_args()
    if not all(ADDRESS.fullmatch(p) for p in args.pools):
        parser.error('invalid pool')
    with ThreadPoolExecutor(max_workers=3) as threads:
        rows = list(threads.map(measure, dict.fromkeys(args.pools)))
    args.output.write_text(json.dumps(report(rows), indent=2)+'\n')
