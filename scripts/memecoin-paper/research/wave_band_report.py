"""Compare early and recovery trades by entry-time buyer pressure across finished paper runs."""
import argparse
from collections import Counter, defaultdict
from decimal import Decimal as D
import json
from pathlib import Path

from meme_paper_account import FEE, UNIT

ARMS = ('early', 'wave')


def report(streams):
    totals = defaultdict(Counter)
    seen_runs = set()
    for events in streams:
        bands, positions, closed = {}, {}, set()
        end = set()
        cohort = None
        for row in events:
            kind = row['event']
            mint, arm = row.get('mint'), row.get('arm')
            key = (mint,arm)
            if kind == 'cohortSelection':
                if row['band'] not in ('moderate','strong') or mint in bands:
                    raise ValueError('Invalid cohort selection')
                bands[mint] = row['band']
            elif kind == 'cohort':
                if cohort is not None:
                    raise ValueError('Duplicate session')
                cohort = set(row['mints'])
                identity = row['at'],tuple(sorted(cohort))
                if identity in seen_runs:
                    raise ValueError('Duplicate session log')
                seen_runs.add(identity)
                if bands.keys()-cohort:
                    raise ValueError('Selection missing from cohort')
                for m in cohort:
                    for a in ARMS:
                        totals[bands.get(m,'unclassified'),a]['observed'] += 1
            elif kind in ('entry','exit','costRejected'):
                if cohort is None or mint not in cohort or arm not in ARMS:
                    raise ValueError('Trade outside cohort')
                stats = totals[bands.get(mint,'unclassified'),arm]
                if kind=='entry':
                    if key in positions:
                        raise ValueError('Duplicate entry')
                    positions[key] = D(str(row['usdc'])) + D(FEE)/UNIT
                    stats['entries'] += 1
                elif kind=='exit':
                    if key not in positions or key in closed:
                        raise ValueError('Unmatched exit')
                    closed.add(key)
                    stats['closed'] += 1
                    net = D(str(row['netUsdc']))
                    stats['net'] += net
                    stats['wins'] += net>0
                    stats['triples'] += net >= 2*(positions[key]-D(FEE)/UNIT)
                else:
                    stats['costRejections'] += 1
            elif kind=='summary':
                if arm not in ARMS or arm in end:
                    raise ValueError('Invalid account summary')
                account = [k for k in positions if k[1]==arm]
                if (row['entries']!=len(account) or row['closed']!=sum(k in closed for k in account)
                        or row['unresolved']!=sum(k not in closed for k in account)):
                    raise ValueError('Account summary disagrees with position events')
                end.add(arm)
        if cohort is None or end!=set(ARMS):
            raise ValueError('Incomplete paper run')
        for mint,arm in positions.keys()-closed:
            stats = totals[bands.get(mint,'unclassified'),arm]
            stats['unresolved'] += 1
            stats['unpricedCost'] += positions[mint,arm]
    output = []
    for (band,arm),stats in sorted(totals.items()):
        output.append(dict(band=band,arm=arm,**{k:stats[k] for k in
                    ('observed','entries','closed','wins','triples','costRejections','unresolved')},
                    realizedUsdc=float(stats['net']),
                    netIfUnpricedWorthZeroUsdc=float(stats['net']-stats['unpricedCost'])))
    return output


if __name__=='__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', nargs='+', type=Path)
    files = cli.parse_args().logs
    if len(set(p.resolve() for p in files)) != len(files):
        cli.error('Duplicate input log')
    print(json.dumps(report([json.loads(line) for line in p.read_text().splitlines()] for p in files),indent=2))
