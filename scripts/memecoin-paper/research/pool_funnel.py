"""Audit one complete paper session using its events and account statement."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from new_pool_watch import SIZE, failed_checks, launchpad_candidate


def audit(events, summary):
    first = {}
    stages = defaultdict(set)
    failures = defaultdict(set)
    quote_errors = Counter()
    counts = Counter()
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
            if not 60 <= age <= 900:
                continue
            stages['inWindow'].add(pool)
            if not launchpad_candidate(original, row, row.get('observedAt', row['at'])):
                continue
            stages['launchpad'].add(pool)
            failed = failed_checks(original, row, age)
            if failed:
                failures[pool].update(failed)
            else:
                stages['signal'].add(pool)
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
    return dict(ticks=summary['ticks'], distinctPools=dict(discovered=len(first), **{
        name: len(stages[name]) for name in ('revisited','inWindow','launchpad','signal',
                                              'selected','quoted','passedQuote','bought')}),
                failedAtLeastOnceAmongNeverConfirmed=dict(rejected), quoteErrorsBySide=dict(quote_errors),
                account=summary['account'])


def render(report):
    lines = ['### Paper entry funnel', '', '| Stage | Distinct pools |', '|---|---:|']
    lines.extend(f'| {stage} | {count} |' for stage, count in report['distinctPools'].items())
    lines.extend(['', 'Failed checks among launchpad pools that never confirmed (overlap possible): ' +
                  json.dumps(report['failedAtLeastOnceAmongNeverConfirmed'], sort_keys=True),
                  '','Quote errors by side: ' + json.dumps(report['quoteErrorsBySide'], sort_keys=True)])
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
