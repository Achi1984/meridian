"""Replay first early-inflow and momentum signals from chronological paper archives."""
import argparse
import json
from statistics import median
from zipfile import ZipFile

from new_pool_watch import early_inflow, launchpad_candidate, qualifies


def compare(events):
    first = {}
    signals = {'earlyInflow': {}, 'momentum': {}}
    for row in events:
        kind = row['event']
        if kind not in ('firstSeen', 'seenAgain'):
            continue
        pool = row['pool']
        at = row.get('observedAt', row['at'])
        if kind == 'firstSeen':
            first[pool] = (at, row)
            continue
        born, original = first[pool]
        if (original['mint'], original['quote']) != (row['mint'], row['quote']):
            continue
        age = row.get('observedAge', at-born)
        for name, cohort in signals.items():
            if pool in cohort:
                signal = cohort[pool]
                if signal['return'] is None and 300 <= at-signal['at'] <= 360 and row['price'] > 0:
                    signal['return'] = 100 * (row['price']/signal['price'] - 1)
                continue
            matches = (early_inflow(original,row,age,at) if name == 'earlyInflow' else
                       launchpad_candidate(original,row,at) and qualifies(original,row,age))
            if matches:
                cohort[pool] = {'at': at, 'price': row['price'], 'return': None}
    return signals


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives', nargs='+')
    args = parser.parse_args()
    totals = {'earlyInflow': [], 'momentum': []}
    for path in args.archives:
        with ZipFile(path) as archive, archive.open('session/events.jsonl') as stream:
            cohorts = compare(json.loads(line) for line in stream)
        for name, cohort in cohorts.items():
            totals[name].extend(row['return'] for row in cohort.values())
    for name, values in totals.items():
        priced = [value for value in values if value is not None]
        print(json.dumps(dict(rule=name, signals=len(values), priced=len(priced),
                              missing=len(values)-len(priced), positive=sum(v>0 for v in priced),
                              medianPoolChangePct=median(priced) if priced else None)))
