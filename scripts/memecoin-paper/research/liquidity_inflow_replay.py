"""Replay early liquidity growth on archived pool marks. No orders or route requests."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
from zipfile import ZipFile

from new_pool_watch import USDC, WSOL, launchpad_candidate

STAKE = 20
SIDE_COST = 0.01
FIXED_FEE = 0.05


def replay(rows):
    histories = defaultdict(list)
    events = Counter()
    outcomes = []
    for row in rows:
        if row['event'] in ('firstSeen', 'seenAgain'):
            histories[row['pool']].append(row)
    for history in histories.values():
        first = history[0]
        if first['event'] != 'firstSeen' or first['liquidity'] <= 0 or first['price'] <= 0:
            continue
        signal_at = entry_at = None
        for row in history[1:]:
            at = row.get('observedAt', row['at'])
            if (row['mint'], row['quote']) != (first['mint'], first['quote']) or row['price'] <= 0:
                continue
            if entry_at is not None:
                age = at - entry_at
                if age > 300:
                    break
                if age >= 180:
                    proceeds = (STAKE - FIXED_FEE) / (1 + SIDE_COST) * row['price'] / entry
                    outcomes.append(proceeds * (1 - SIDE_COST) - FIXED_FEE - STAKE)
                    break
            elif signal_at is not None:
                if at - signal_at > 120:
                    break
                if at > signal_at:
                    entry_at, entry = at, row['price']
                    events['entries'] += 1
            elif (60 <= at-first['at'] <= 900 and launchpad_candidate(first, row, at)
                  and row['quote'] in (WSOL, USDC) and row['mint'] not in (WSOL, USDC)
                  and row['liquidity'] >= max(3000, 1.10 * first['liquidity'])
                  and 1 <= row['price']/first['price'] < 1.10
                  and row['buys'] >= 1.5 * max(1, row['sells']) and row['sells'] >= 3):
                signal_at = at
                events['signals'] += 1
    return dict(pools=len(histories), signals=events['signals'], entries=events['entries'],
                exits=len(outcomes), missingExit=events['entries']-len(outcomes),
                wins=sum(v > 0 for v in outcomes), pricedNetUsdc=round(sum(outcomes), 4))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives', type=Path, nargs='+')
    for archive in parser.parse_args().archives:
        with ZipFile(archive) as packet, packet.open('session/events.jsonl') as stream:
            print(archive.name, json.dumps(replay(map(json.loads, stream))))
