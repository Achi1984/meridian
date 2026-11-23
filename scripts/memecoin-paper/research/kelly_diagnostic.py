"""Offline sizing diagnostic on fixed-stake paper receipts, grouped by entry strategy."""
import argparse
import json
import math
from pathlib import Path

from meme_paper_account import SIZE, FEE, UNIT
from newcomer_cost_switch import evaluate
from wave_band_report import report


def quarter_kelly(returns):
    """Maximize average log growth over unlevered fractions, then quarter it."""
    if not returns:
        return None
    if math.fsum(returns) <= 0:
        return 0.0
    low, high = 0.0, 1.0
    for _ in range(60):
        f = (low + high) / 2
        if any(1 + f*r <= 0 for r in returns):
            high = f
        elif math.fsum(r / (1 + f*r) for r in returns) > 0:
            low = f
        else:
            high = f
    return low / 4


def score(nets, unresolved):
    returns = [net/SIZE for net in nets]
    without_best = sorted(returns)[:-1]
    # With no sale there is no exit fee. Use zero proceeds on each unresolved purchase.
    stress = -(SIZE + FEE)/SIZE
    return dict(closed=len(nets), unresolved=unresolved, netUsdc=sum(nets)/UNIT,
                netWithoutBestUsdc=(sum(nets)-max(nets))/UNIT if len(nets)>1 else None,
                fittedQuarterKelly=quarter_kelly(returns),
                quarterWithoutBest=quarter_kelly(without_best),
                quarterWithoutBestAndZeroRecovery=quarter_kelly(without_best+[stress]*unresolved))


def diagnostic(streams):
    report(streams)
    samples = {arm: [] for arm in ('early', 'wave')}
    unresolved = dict.fromkeys(samples, 0)
    seen = set()
    for rows in sorted(streams, key=lambda s: next(r['at'] for r in s if r['event']=='cohort')):
        for item in evaluate(rows):
            if item['mint'] in seen:
                continue
            seen.add(item['mint'])
            for arm in samples:
                path = item['paths'][arm]
                if path['state'] == 'closed':
                    samples[arm].append(round(path['netUsdc']*UNIT))
                elif path['state'] == 'unresolved':
                    unresolved[arm] += 1
    return {arm: score(nets, unresolved[arm]) for arm, nets in samples.items()}


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', type=Path, nargs='+')
    logs = [[json.loads(line) for line in f.read_text().splitlines()] for f in cli.parse_args().logs]
    print(json.dumps(diagnostic(logs), indent=2))
