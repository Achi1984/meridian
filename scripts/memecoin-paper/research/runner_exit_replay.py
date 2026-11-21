"""Compare sampled spot pool marks, with a 15-minute horizon and a 2-minute gap limit."""
import argparse
import json
from zipfile import ZipFile

from runner_study import runner_signal
from new_pool_watch import USDC, WSOL


def outcomes(path):
    entered, entry_price = path[0]
    fixed = trail = None
    peak = 1.
    last = entered
    for at, price in path[1:]:
        if at-last > 120:
            break
        last = at
        ratio = price / entry_price
        peak = max(peak, ratio)
        common_exit = ratio <= .70 or ratio >= 3 or at-entered >= 900
        if trail is None and (common_exit or (peak >= 1.50 and ratio <= peak * .80)):
            trail = ratio
        if common_exit:
            fixed = ratio
            break
    return fixed, trail


def paths(events):
    first, tracks = {}, {}
    for row in events:
        kind = row['event']
        if kind not in ('firstSeen', 'seenAgain'):
            continue
        pool, mint = row['pool'], row['mint']
        at = row.get('observedAt', row['at'])
        if kind == 'firstSeen':
            first[pool] = row
            continue
        original = first[pool]
        if mint in tracks:
            tracked_pool, quote, path = tracks[mint]
            if (pool, row['quote']) == (tracked_pool, quote) and at > path[-1][0] and row['price'] > 0:
                path.append((at, row['price']))
        elif runner_signal(original, row, at-original['at'], at, (USDC, WSOL)):
            tracks[mint] = pool, row['quote'], [(at, row['price'])]
    return [path for _, _, path in tracks.values()]


def compare(archives):
    results = []
    for name in archives:
        with ZipFile(name) as archive, archive.open('session/events.jsonl') as stream:
            results.extend(outcomes(p) for p in paths(json.loads(line) for line in stream))
    paired = [(f, t) for f, t in results if f is not None and t is not None]
    return dict(signals=len(results), paired=len(paired),
                fixedMissing=sum(f is None for f,t in results), trailMissing=sum(t is None for f,t in results),
                trailBetter=sum(t>f for f,t in paired), trailWorse=sum(t<f for f,t in paired),
                fixedGrossUsdc=sum(20*(f-1) for f,t in paired), trailGrossUsdc=sum(20*(t-1) for f,t in paired))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives', nargs='+')
    print(json.dumps(compare(parser.parse_args().archives)))
