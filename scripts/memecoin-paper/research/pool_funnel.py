"""Audit one complete paper session using its events and account statement."""
import argparse
from collections import Counter, defaultdict
import json
from statistics import median
from pathlib import Path

from meme_paper_account import FEE, UNIT
from new_pool_watch import PersistenceStudy, SIZE, failed_checks, launchpad_candidate


ENTRY_CHECKS = ('tokenPair', 'priceMomentum', 'liquidity', 'volume', 'orderFlow')


def audit(events, summary):
    first = {}
    stages = defaultdict(set)
    failures = defaultdict(set)
    quote_errors = Counter()
    confirmation_quotes = []
    exit_windows = defaultdict(dict)
    unavailable_sides = Counter()
    counts = Counter()
    single_failure = defaultdict(set)
    passed_individually = defaultdict(set)
    positive_liquidity = set()
    # First qualifying observation per pool, with a fixed five-minute follow-up.
    signals = {floor: {} for floor in (10000, 5000)}
    persistence = PersistenceStudy()
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
            persistence.observe(original,row,age,observed)
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
            for check in ENTRY_CHECKS:
                if check not in failed:
                    passed_individually[check].add(pool)
            if row['liquidity'] > 0:
                positive_liquidity.add(pool)
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
        elif kind in ('confirmationExitQuote', 'confirmationExitMissing'):
            key = (pool, row['mint'], row['confirmedAt'], row['tokenQty'])
            horizon = row['horizonSeconds']
            if horizon not in (240, 300) or horizon in exit_windows[key]:
                raise ValueError('Invalid or duplicate exit window')
            value = None
            if kind == 'confirmationExitQuote':
                value = row['usdcRaw']
                if type(value) is not int or value <= 0 or not horizon <= row['ageSeconds'] < horizon+60:
                    raise ValueError('Invalid exit quote')
            exit_windows[key][horizon] = value
        elif kind == 'confirmationRoundTrip':
            confirmation_quotes.append(row['usdcRaw'])
        elif kind == 'confirmationQuoteUnavailable':
            unavailable_sides[row['side']] += 1
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
    confirmed = len(persistence.confirmed)
    rejected_count = len(persistence.rejected)
    followup = dict(signals=len(persistence.signals),confirmed=confirmed,rejected=rejected_count,
                    missingConfirmation=len(persistence.signals)-confirmed-rejected_count,
                    priced=len(persistence.returns),missingOutcome=confirmed-len(persistence.returns),
                    medianPct=median(persistence.returns.values()) if persistence.returns else None)
    execution = dict(quoted=len(confirmation_quotes), passed=sum(v*100 >= SIZE*95 for v in confirmation_quotes),
                     unavailableBySide=dict(unavailable_sides), skipped=counts['confirmationQuoteSkipped'],
                     medianReturnUsdc=median(confirmation_quotes)/1_000_000 if confirmation_quotes else None)
    # Count individual quoted round trips before network fees, including the exact cutoff.
    execution['withinCostPct'] = {
        str(limit): sum(value * 100 >= SIZE * (100 - limit) for value in confirmation_quotes)
        for limit in (1, 2, 5)
    }
    paired = [(row[240], row[300]) for row in exit_windows.values()
              if row.get(240) is not None and row.get(300) is not None]
    deltas = [later-earlier for earlier, later in paired]
    comparison_exits = dict(observed=len(exit_windows), paired=len(paired),
                            incomplete=len(exit_windows)-len(paired),
                            fiveBetter=sum(d > 0 for d in deltas), equal=deltas.count(0),
                            fourBetter=sum(d < 0 for d in deltas),
                            medianDifferenceUsdc=median(deltas)/1_000_000 if deltas else None)
    threshold = SIZE + 2 * FEE
    comparison_exits['breakEven'] = dict(
        requiredUsdc=threshold / UNIT,
        fourCovered=sum(early >= threshold for early, _ in paired),
        fiveCovered=sum(late >= threshold for _, late in paired))
    diagnostics = dict(
        neverPassed={check: len(stages['launchpad'] - passed_individually[check])
                     for check in ENTRY_CHECKS},
        onlyZeroLiquidity=len(stages['launchpad'] - positive_liquidity),
        invalidObservations=counts['invalidObservation'])
    return dict(entryDiagnostics=diagnostics, exitWindowComparison=comparison_exits, confirmationExecution=execution if summary.get('probeConfirmations') else None,
                persistenceAt5000=followup, onlyFailedCheckAmongNeverConfirmed={
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
    diagnostics = report['entryDiagnostics']
    lines.extend(['', 'Distinct eligible launchpad pools that never passed each check (overlap possible):',
                  json.dumps(diagnostics['neverPassed'], sort_keys=True),
                  f"Pools with only zero reported liquidity in the entry window: {diagnostics['onlyZeroLiquidity']}",
                  f"Invalid input observations across all feeds (rows, not pools): {diagnostics['invalidObservations']}"])
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
    study = report['persistenceAt5000']
    lines.extend(['', '5k persistence study (60–120 seconds to confirm, five minutes from confirmation):',
                  json.dumps(study, sort_keys=True)])
    if report['confirmationExecution'] is not None:
        lines.extend(['', 'Immediate buy and resale quotes for 20 USDC (before network fees):',
                      json.dumps(report['confirmationExecution'], sort_keys=True)])
    windows = report['exitWindowComparison']
    if windows['observed']:
        lines.extend(['', 'Paired four- and five-minute resale quotes (five minus four, USDC):',
                      json.dumps(windows, sort_keys=True)])
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
