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
    comparisons = defaultdict(Counter)
    seen_runs = set()
    for events in streams:
        bands, positions, closed = {}, {}, {}
        observation_gaps = set()
        persistence_gaps = set()
        end = set()
        arms = ARMS
        cohort = None
        for row in events:
            kind = row['event']
            if end and kind != 'summary':
                raise ValueError('Event after terminal account summary')
            mint, arm = row.get('mint'), row.get('arm')
            key = (mint,arm)
            if kind == 'cohortSelection':
                if row['band'] not in ('moderate','strong') or mint in bands:
                    raise ValueError('Invalid cohort selection')
                bands[mint] = row['band']
            elif kind == 'cohort':
                if cohort is not None:
                    raise ValueError('Duplicate session')
                arms = tuple(row.get('arms', ARMS))
                if arms not in (ARMS, ARMS + ('persistent',)):
                    raise ValueError('Unknown experiment arms')
                policy = row.get('holdingPolicy','commonSessionEnd')
                cohort = set(row['mints'])
                identity = row['at'],tuple(sorted(cohort))
                if identity in seen_runs:
                    raise ValueError('Duplicate session log')
                seen_runs.add(identity)
                if bands.keys()-cohort:
                    raise ValueError('Selection missing from cohort')
                for m in cohort:
                    for a in arms:
                        totals[policy,bands.get(m,'unclassified'),a]['observed'] += 1
            elif kind == 'persistenceUnavailable':
                persistence_gaps.add(mint)
            elif kind == 'observationUnavailable':
                if cohort is None or mint not in cohort:
                    raise ValueError('Observation outside cohort')
                observation_gaps.add(mint)
            elif kind in ('entry','exit','costRejected'):
                if cohort is None or mint not in cohort or arm not in arms:
                    raise ValueError('Trade outside cohort')
                stats = totals[policy,bands.get(mint,'unclassified'),arm]
                if kind=='entry':
                    if key in positions:
                        raise ValueError('Duplicate entry')
                    positions[key] = D(str(row['usdc'])) + D(FEE)/UNIT
                    stats['entries'] += 1
                elif kind=='exit':
                    if key not in positions or key in closed:
                        raise ValueError('Unmatched exit')
                    stats['closed'] += 1
                    net = D(str(row['netUsdc']))
                    closed[key] = net
                    stats['net'] += net
                    stats['best'] = max(stats.get('best',net),net)
                    stats['wins'] += net>0
                    stats['triples'] += net >= 2*(positions[key]-D(FEE)/UNIT)
                else:
                    stats['costRejections'] += 1
            elif kind=='summary':
                if arm not in arms or arm in end:
                    raise ValueError('Invalid account summary')
                account = [k for k in positions if k[1]==arm]
                if (row['entries']!=len(account) or row['closed']!=sum(k in closed for k in account)
                        or row['unresolved']!=sum(k not in closed for k in account)):
                    raise ValueError('Account summary disagrees with position events')
                realized = sum((closed[k] for k in account if k in closed), D(0))
                if 'realizedUsdc' in row and realized != D(str(row['realizedUsdc'])):
                    raise ValueError('Account realized net disagrees with exit events')
                end.add(arm)
        if cohort is None or end!=set(arms):
            raise ValueError('Incomplete paper run')
        for mint in cohort:
            for challenger in arms[1:]:
                pair = comparisons[policy,bands.get(mint,'unclassified'),challenger]
                early, other = (mint,'early'), (mint,challenger)
                if any(k in positions and k not in closed for k in (early,other)):
                    pair['unresolved'] += 1
                    continue
                if early not in positions and other not in positions:
                    if mint in observation_gaps or (challenger == 'persistent' and mint in persistence_gaps):
                        pair['noEntryWithObservationGap'] += 1
                    else:
                        pair['neitherEntered'] += 1
                    continue
                group = 'both' if early in positions and other in positions else 'earlyOnly' if early in positions else challenger+'Only'
                delta = closed.get(other,0)-closed.get(early,0)
                pair[group] += 1
                pair[group+'Delta'] += delta
                if group == 'both':
                    pair['bestPairedDelta'] = max(pair.get('bestPairedDelta', delta), delta)
                if mint in observation_gaps or (challenger == 'persistent' and mint in persistence_gaps):
                    pair[group+'WithGap'] += 1
        for mint,arm in positions.keys()-closed.keys():
            stats = totals[policy,bands.get(mint,'unclassified'),arm]
            stats['unresolved'] += 1
            stats['unpricedCost'] += positions[mint,arm]
    output = []
    for (policy,band,arm),stats in sorted(totals.items()):
        output.append(dict(holdingPolicy=policy,band=band,arm=arm,**{k:stats[k] for k in
                    ('observed','entries','closed','wins','triples','costRejections','unresolved')},
                    realizedUsdc=float(stats['net']),
                    bestClosedUsdc=float(stats['best']) if stats['closed'] else None,
                    realizedWithoutBestUsdc=float(stats['net']-stats['best']) if stats['closed']>1 else None,
                    netIfUnpricedWorthZeroUsdc=float(stats['net']-stats['unpricedCost'])))
        if arm!='early':
            pair = comparisons[policy,band,arm]
            output[-1][arm+'MinusEarly'] = {
                'noEntryWithObservationGap':pair['noEntryWithObservationGap'],
                'neitherEntered':pair['neitherEntered'], 'unresolved':pair['unresolved'],
                'bestPairedDeltaUsdc':float(pair['bestPairedDelta']) if pair['both'] else None,
                'deltaWithoutBestPairUsdc':float(pair['bothDelta']-pair['bestPairedDelta'])
                                          if pair['both']>1 else None,
                'withObservationGap':{g:pair[g+'WithGap'] for g in ('both','earlyOnly',arm+'Only')},
                'groups':{g:dict(count=pair[g],deltaUsdc=float(pair[g+'Delta']) if pair[g] else None)
                          for g in ('both','earlyOnly',arm+'Only')}}
    return output


if __name__=='__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', nargs='+', type=Path)
    files = cli.parse_args().logs
    if len(set(p.resolve() for p in files)) != len(files):
        cli.error('Duplicate input log')
    print(json.dumps(report([json.loads(line) for line in p.read_text().splitlines()] for p in files),indent=2))
