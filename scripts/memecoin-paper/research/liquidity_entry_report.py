"""Replay H8 using pool liquidity at selection and the actual early/wave receipts."""
from collections import Counter
import argparse
import json
import math
from pathlib import Path

from meme_paper_account import UNIT
from newcomer_cost_switch import evaluate
from wave_band_report import report


def select_arm(liquidity):
    if isinstance(liquidity, bool) or not isinstance(liquidity, (int, float)) or not math.isfinite(liquidity) or liquidity < 0:
        raise ValueError('Expected observed pool liquidity in USD')
    return 'early' if liquidity >= 20000 else 'wave'


def realized(path):
    if path['state'] in ('noEntry', 'noEntryWithGap'):
        return 0
    if path['state'] == 'unresolved':
        return None
    return round(path['netUsdc'] * UNIT)


def summarize(paths):
    states = Counter(path['state'] for path in paths)
    closed = [realized(path) for path in paths if path['state'] == 'closed']
    stress = [path['zeroRecoveryNetUsdc'] for path in paths if path['state'] == 'unresolved']
    drawdowns = [path['sampledDrawdownUsdc'] for path in paths if path['marks']]
    return dict(states=dict(states), realizedUsdc=sum(closed)/UNIT,
                zeroRecoveryUsdc=(sum(closed)+sum(round(x*UNIT) for x in stress))/UNIT,
                worstSampledPositionDrawdownUsdc=max(drawdowns, default=None))


def replay(periods):
    """Keep evaluation periods separate and exclude repeat mints across all periods."""
    report([rows for period in periods for rows in period])
    seen = set()
    results = []
    previous = -1
    for period in periods:
        observations = []
        deltas = {'early': [], 'wave': []}
        for rows in period:
            cohort = next(r for r in rows if r['event'] == 'cohort')
            if cohort['at'] <= previous:
                raise ValueError('Expected chronological non-overlapping cohorts')
            previous = cohort['at']
            for item in evaluate(rows):
                mint = item['mint']
                paths = item['paths']
                chosen = select_arm(item['liquidityUsd'])
                candidate = realized(paths[chosen])
                repeated = mint in seen
                seen.add(mint)
                for arm in deltas:
                    reference = realized(paths[arm])
                    if not repeated and candidate is not None and reference is not None:
                        deltas[arm].append(candidate-reference)
                observations.append(dict(cohortAt=previous, mint=mint, repeat=repeated,
                                         liquidityUsd=item['liquidityUsd'], chosen=chosen, paths=paths))
        comparisons = {}
        for arm, values in deltas.items():
            comparisons[arm] = dict(resolvedMintCount=len(values),
                                    deltaUsdc=sum(values)/UNIT if values else None,
                                    withoutBestUsdc=(sum(values)-max(values))/UNIT if len(values)>1 else None)
        strategies = {}
        for name in ('early', 'wave', 'candidate'):
            paths = [r['paths'][r['chosen'] if name == 'candidate' else name]
                     for r in observations if not r['repeat']]
            strategies[name] = summarize(paths)
        results.append(dict(observations=observations, comparisons=comparisons, strategies=strategies))
    return results


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--period', type=Path, nargs='+', action='append', required=True,
                     help='Chronologically ordered session logs for one period; repeat for holdout')
    args = cli.parse_args()
    periods = [[[json.loads(line) for line in path.read_text().splitlines()] for path in group]
               for group in args.period]
    print(json.dumps(replay(periods), indent=2))
