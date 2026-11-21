"""Point-in-time Solana newcomer research; provider quotes only."""
import json
import os
import time
from collections import Counter
from datetime import datetime
from http.client import HTTPException

from new_pool_watch import GT, SIZE, USDC, WSOL, get, number, snapshot, spot_quote
from pool_shadow import MODEL, ask

PROMPT = ('Assess whether to prioritize this Solana newcomer for paper observation. '
          'TAKE means watch; SKIP means deprioritize. Consider second-wave new buyers, '
          'net flows in each sampled minute, buyer concentration and two-way recovery. '
          'Wallets may be linked; coverage is a recent trade sample. Never infer future returns.')
ERRORS = (ValueError, KeyError, IndexError, TypeError, OSError, HTTPException)


def flow(rows, mint, quote, end):
    wallets = [Counter(), Counter()]
    net = [0., 0.]
    seen = set()
    for row in rows:
        a = row['attributes']
        age = end - datetime.fromisoformat(a['block_timestamp']).timestamp()
        if not 0 <= age < 120 or a.get('is_anomalous') or row['id'] in seen:
            continue
        seen.add(row['id'])
        index = int(age < 60)
        pair = (a['from_token_address'], a['to_token_address'])
        amount = number(a['volume_in_usd'])
        if pair == (quote, mint) and a.get('tx_from_address'):
            wallets[index][a['tx_from_address']] += amount
            net[index] += amount
        elif pair == (mint, quote):
            net[index] -= amount
    latest = wallets[1]
    total = sum(latest.values())
    return dict(priorBuyers=len(wallets[0]), recentBuyers=len(latest),
                newRecentBuyers=len(latest.keys()-wallets[0].keys()),
                netUsd=net, largestRecentBuyerShare=max(latest.values())/total if total else None)


def discover():
    pools = {}
    for page in (1, 2, 3):
        for item in get(f'{GT}/new_pools?page={page}',120)['data']:
            try:
                row = snapshot(item)
                age = time.time()-datetime.fromisoformat(row['created']).timestamp()
                if (120 <= age <= 3600 and row['dex'] in ('pump-fun','pumpswap') and
                        row['quote'] in (USDC,WSOL) and row['mint'] not in (USDC,WSOL)
                        and row['liquidity'] >= 5000 and row['sells'] >= 3):
                    pools[row['pool']] = row
            except ERRORS:
                continue
    return sorted(pools.values(),key=lambda r:r['volume'],reverse=True)


def run():
    pools = discover()
    key = os.getenv('ANTHROPIC_API_KEY')
    print(json.dumps(dict(eligiblePools=len(pools), modelConfigured=bool(key))),flush=True)
    for row in pools[:4]:
        mint = row['mint']
        report = dict(mint=mint, pool=row['pool'], dex=row['dex'], created=row['created'])
        try:
            trades = get(f"{GT}/pools/{row['pool']}/trades",120)['data']
            at = int(time.time())
            stats = flow(trades,mint,row['quote'],at)
            report.update(observedAt=at, sampleRows=len(trades), features=stats)
            if (stats['priorBuyers'] and stats['newRecentBuyers'] >= 3 and min(stats['netUsd']) > 0
                    and stats['largestRecentBuyerShare'] <= .50):
                qty = spot_quote(USDC,mint,SIZE)
                bid = spot_quote(mint,USDC,qty)
                stats['recoveryPct'] = 100*bid/SIZE
                report['quoteAt'] = int(time.time())
                report['gate'] = 'watch' if bid >= .95*SIZE else 'cost'
                if key and report['gate']=='watch':
                    report.update(model=MODEL, assessment=ask(stats,key,prompt=PROMPT))
            else:
                report['gate'] = 'flow'
        except ERRORS as exc:
            report['missingEvidence'] = type(exc).__name__
        print(json.dumps(report,allow_nan=False),flush=True)


if __name__ == '__main__':
    run()
