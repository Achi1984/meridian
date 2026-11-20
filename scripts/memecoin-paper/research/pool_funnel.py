"""Audit one complete paper session using its events and account statement."""
import argparse
from collections import Counter, defaultdict
import json
from statistics import median
from pathlib import Path

from new_pool_watch import SIZE, failed_checks, launchpad_candidate


def audit(events, summary):
    first = {}
    stages = defaultdict(set)
    failures = defaultdict(set)
    quote_errors = Counter()
    counts = Counter()
    single_failure = defaultdict(set)
    # First qualifying observation per pool, with a fixed five-minute follow-up.
    signals = {floor: {} for floor in (10000, 5000)}
    returns = {floor: {} for floor in signals}
    for row in events:
        kind = row['event']
        counts[kind] += 1
        pool = row.get('pool')
        if kind == 'firstSeen':
            first[pool] = row
        elif kind == 'seenAgain':
            original = first[pool]
            stages['revisited'].add(pool)
            age = row.get('observedAge', row['at']-original['at'])
            observed = row.get('observedAt', row['at'])
            for floor, cohort in signals.items():
                if pool in cohort and pool not in returns[floor]:
                    at, price, mint, quote = cohort[pool]
                    if (300 <= observed-at <= 360 and row['price'] > 0
                            and (row['mint'],row['quote']) == (mint,quote)):
                        returns[floor][pool] = 100 * (row['price']/price - 1)
            if not 60 <= age <= 900:
                continue
            stages['inWindow'].add(pool)
            if not launchpad_candidate(original, row, row.get('observedAt', row['at'])):
                continue
            stages['launchpad'].add(pool)
            failed = failed_checks(original, row, age)
            if len(failed) == 1:
                single_failure[failed[0]].add(pool)
            for floor, cohort in signals.items():
                if pool not in cohort and not failed_checks(original,row,age,liquidity_floor=floor):
                    cohort[pool] = (observed,row['price'],row['mint'],row['quote'])
            if failed:
                failures[pool].update(failed)
            else:
                stages['signal'].add(pool)
        elif kind in ('signalWithdrawn', 'signalExpired'):
            stages[kind].add(pool)
        elif kind == 'momentumCandidate':
            stages['selected'].add(pool)
        elif kind == 'roundTripQuote':
            stages['quoted'].add(pool)
            if row['usdcRaw'] * 100 >= SIZE * 95:
                stages['passedQuote'].add(pool)
        elif kind == 'botBuy':
            stages['bought'].add(pool)
        elif kind == 'quoteUnavailable':
            quote_errors[row.get('side', 'unknown')] += 1
    if dict(counts) != summary['events'] or len(first) != summary['pools']:
        raise ValueError('Events and session summary disagree')
    rejected = Counter(reason for pool in failures.keys()-stages['signal'] for reason in failures[pool])
    comparison = {}
    for floor, cohort in signals.items():
        outcomes = list(returns[floor].values())
        comparison[str(floor)] = dict(signalPools=len(cohort), pricedAtFiveMinutes=len(outcomes),
            missingAtFiveMinutes=len(cohort)-len(outcomes),
            medianPriceChangePct=median(outcomes) if outcomes else None)
    return dict(onlyFailedCheckAmongNeverConfirmed={
                    name: len(pools-stages['signal']) for name,pools in single_failure.items()},
                liquidityFloorComparison=comparison, ticks=summary['ticks'], distinctPools=dict(discovered=len(first), **{
        name: len(stages[name]) for name in ('revisited','inWindow','launchpad','signal',
                                              'selected','quoted','passedQuote','bought')}),
                failedAtLeastOnceAmongNeverConfirmed=dict(rejected), quoteErrorsBySide=dict(quote_errors),
                decisionExceptions={name: len(stages[name]) for name in ('signalWithdrawn','signalExpired')}
                if summary.get('decisionAuditVersion') == 1 else None,
                account=summary['account'])


def render(report):
    lines = ['### Paper entry funnel', '', '| Stage | Distinct pools |', '|---|---:|']
    lines.extend(f'| {stage} | {count} |' for stage, count in report['distinctPools'].items())
    lines.extend(['', 'Failed checks among launchpad pools that never confirmed (overlap possible): ' +
                  json.dumps(report['failedAtLeastOnceAmongNeverConfirmed'], sort_keys=True),
                  '','Quote errors by side: ' + json.dumps(report['quoteErrorsBySide'], sort_keys=True)])
    if report['decisionExceptions'] is not None:
        lines.extend(['', 'Distinct pools with a withdrawn or expired signal: ' +
                      json.dumps(report['decisionExceptions'], sort_keys=True)])
    lines.extend(['', 'Five-minute observed price movement by liquidity floor (USD), before costs:',
                  '', '| Floor | Signal pools | Priced | Missing | Median price change |',
                  '|---:|---:|---:|---:|---:|'])
    for floor, row in report['liquidityFloorComparison'].items():
        change = row['medianPriceChangePct']
        label = '—' if change is None else f'{change:.2f}%'
        lines.append(f"| {floor} | {row['signalPools']} | {row['pricedAtFiveMinutes']} | "
                     f"{row['missingAtFiveMinutes']} | {label} |")
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('session', type=Path)
    args = parser.parse_args()
    summary = json.loads((args.session/'summary.json').read_text())
    with (args.session/'events.jsonl').open() as stream:
        report = audit((json.loads(line) for line in stream), summary)
    (args.session/'funnel.json').write_text(json.dumps(report, indent=2)+'\n')
    print(render(report))
