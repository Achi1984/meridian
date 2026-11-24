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


def collect(streams, seen):
    report(streams)
    samples = {arm: [] for arm in ('early', 'wave')}
    unresolved = dict.fromkeys(samples, 0)
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
    return samples, unresolved


def diagnostic(streams):
    samples, unresolved = collect(streams, set())
    return {arm: score(nets, unresolved[arm]) for arm, nets in samples.items()}


def chronological_check(streams, cutoff):
    """Freeze the conservative fraction at cutoff and stress later receipts at fixed quote size."""
    training, later = [], []
    for rows in streams:
        if not rows:
            raise ValueError('Empty session')
        if max(row['at'] for row in rows) < cutoff:
            training.append(rows)
        elif min(row['at'] for row in rows) >= cutoff:
            later.append(rows)
        else:
            raise ValueError('Session overlaps cutoff')
    if not training or not later:
        raise ValueError('Sessions required on both sides of cutoff')
    seen = set()
    fitted, unknown = collect(training, seen)
    holdout, open_positions = collect(later, seen)
    arms = {}
    for arm, nets in holdout.items():
        fit = score(fitted[arm], unknown[arm])
        fraction = fit['quarterWithoutBestAndZeroRecovery']
        stressed = nets + [-(SIZE + FEE)] * open_positions[arm]
        growth = None
        if stressed and fraction is not None:
            growth = math.fsum(math.log1p(fraction * net / SIZE) for net in stressed) / len(stressed)
        arms[arm] = dict(training=fit, frozenFraction=fraction, laterClosed=len(nets),
                         laterUnresolved=open_positions[arm], laterRealizedUsdc=sum(nets)/UNIT,
                         laterZeroRecoveryNetUsdc=sum(stressed)/UNIT, meanStressLogGrowthPerEntry=growth)
    return dict(cutoff=cutoff, trainingSessions=len(training), laterSessions=len(later), arms=arms)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', type=Path, nargs='+')
    cli.add_argument('--holdout-at', type=int, help='UTC Unix timestamp separating complete sessions')
    args = cli.parse_args()
    logs = [[json.loads(line) for line in f.read_text().splitlines()] for f in args.logs]
    result = diagnostic(logs) if args.holdout_at is None else chronological_check(logs, args.holdout_at)
    print(json.dumps(result, indent=2))
