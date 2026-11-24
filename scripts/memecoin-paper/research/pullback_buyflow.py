"""Paper-only pullback/buy-flow study. Run tick repeatedly against the same ledger."""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import time

from meme_paper_account import FEE, SIZE, UNIT
from new_pool_watch import GT, USDC, snapshot, spot_quote
from newcomer_research import ERRORS
from newcomer_scanner import market_reader, sample, timestamp


def accepts(hour_change, buys, sells):
    return (all(math.isfinite(n) for n in (hour_change, buys, sells))
            and min(buys, sells) >= 0 and buys + sells >= 10
            and hour_change < 0 and 5 * buys >= 3 * (buys + sells))


def age_ok(age):
    return 110 * 60 <= age <= 120 * 60


def tick(ledger, fetch, quote, now, save):
    # Resolve existing observations even when discovery is unavailable.
    for mint, position in ledger.items():
        if position['state'] != 'open' or now() < position['due']:
            continue
        if now() <= position['due'] + 1800:
            try:
                bid = quote(mint, USDC, position['quantity'])
            except ERRORS:
                continue
            at = now()
            if at <= position['due'] + 1800:
                position.update(state='closed', exitAt=int(at), netUsdc=(bid-SIZE-2*FEE)/UNIT)
                save()
                continue
        position.update(state='unpriced')
        save()

    candidates = sample(now(), fetch)
    opened = 0
    for row in candidates:
        mint = row['mint']
        created = timestamp(row['created'])
        if mint in ledger or not age_ok(now()-created):
            continue
        try:
            item = fetch(f"{GT}/pools/{row['pool']}", 60)['data']
            fresh = snapshot(item)
            change = float(item['attributes']['price_change_percentage']['h1'])
            if (fresh['mint'] != mint or fresh['pool'] != row['pool']
                    or fresh['quote'] != row['quote'] or timestamp(fresh['created']) != created
                    or fresh['liquidity'] < 5000 or not math.isfinite(change)
                    or fresh['buys']+fresh['sells'] < 10):
                continue
            qty = quote(USDC, mint, SIZE)
            bid = quote(mint, USDC, qty)
            at = now()
            if not age_ok(at-created) or bid-2*FEE < .95*SIZE:
                continue
        except ERRORS:
            continue
        # Observe all comparable entries. The flag selects the strategy subset.
        ledger[mint] = dict(state='open', selected=accepts(change, fresh['buys'], fresh['sells']),
                            pool=row['pool'], symbol=row.get('symbol'), quantity=qty,
                            entryAt=int(at), due=int(created)+86400, hourChangePct=change,
                            buys5m=fresh['buys'], sells5m=fresh['sells'], liquidityUsd=fresh['liquidity'],
                            netResaleAtEntryUsdc=(bid-2*FEE)/UNIT)
        save()
        opened += 1
    return dict(sampled=len(candidates), newObservations=opened)


def summary(ledger):
    result = {}
    for label, positions in [('allComparable', list(ledger.values())),
                              ('pullbackBuyflow', [p for p in ledger.values() if p['selected']])]:
        closed = [p['netUsdc'] for p in positions if p['state']=='closed']
        result[label] = dict(closed=len(closed), open=sum(p['state']=='open' for p in positions),
                             unpriced=sum(p['state']=='unpriced' for p in positions),
                             realizedUsdc=round(sum(closed),6),
                             withoutBestUsdc=round(sum(closed)-max(closed),6) if closed else None)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ledger', type=Path)
    path = parser.parse_args().ledger
    with Path(str(path)+'.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        ledger = json.loads(path.read_text()) if path.exists() else {}
        def save():
            temporary = Path(str(path)+'.tmp')
            temporary.write_text(json.dumps(ledger, allow_nan=False))
            os.replace(temporary, path)
        stats = tick(ledger, market_reader(13), spot_quote, time.time, save)
        print(json.dumps(dict(**stats, accounts=summary(ledger))))
