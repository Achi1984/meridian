"""Replay the frozen +10% net target on immediate entries from completed paper sessions."""
import argparse
import json
from pathlib import Path

from meme_paper_account import SIZE, FEE, UNIT
from newcomer_cost_switch import evaluate
from wave_band_report import report


def target_exit(events, baseline):
    entry = None
    previous_tick = -1
    previous_at = None
    sold = False
    target = None
    peak = drawdown = 0
    for row in events:
        kind = row['event']
        if kind == 'entry':
            entry = row
            previous_at = entry['at']
        elif kind == 'exit':
            sold = True
        elif kind == 'resaleMark':
            if (not entry or sold or row['at'] < previous_at or row['tick'] <= previous_tick
                    or row['qty'] != entry['qty'] or row['usdcRaw'] <= 0):
                raise ValueError('Invalid immediate-entry resale path')
            previous_at, previous_tick = row['at'], row['tick']
            if target is None:
                net = row['usdcRaw'] - SIZE - 2 * FEE
                peak = max(peak, net)
                drawdown = max(drawdown, peak - net)
                if row['tick'] > 0 and 10 * net >= SIZE:
                    target = dict(state='closed', netUsdc=net / UNIT, exitReason='profitTarget',
                                  heldSeconds=row['at'] - entry['at'], sampledDrawdownUsdc=drawdown / UNIT,
                                  zeroRecoveryNetUsdc=net / UNIT)
    if target is None:
        return {key: baseline[key] for key in ('state', 'netUsdc', 'exitReason', 'heldSeconds',
                                                'sampledDrawdownUsdc', 'zeroRecoveryNetUsdc')}
    return target


def replay(streams):
    report(streams)
    observations = []
    deltas = []
    seen = set()
    for rows in sorted(streams, key=lambda stream: next(r['at'] for r in stream if r['event'] == 'cohort')):
        for item in evaluate(rows):
            mint = item['mint']
            events = [r for r in rows if r.get('mint') == mint]
            early = item['paths']['early']
            target = target_exit([r for r in events if r.get('arm') == 'early'], early)
            delta = None
            if early['state'] == target['state'] == 'closed':
                delta = round(target['netUsdc'] - early['netUsdc'], 6)
                if mint not in seen:
                    deltas.append(round(delta * UNIT))
            observations.append(dict(cohortAt=item['cohortAt'], mint=mint, repeatedMint=mint in seen,
                                     baseline=early, target=target, deltaUsdc=delta,
                                     missingEarlyExitQuotes=sum(r['event'] == 'missingExitQuote'
                                         and r.get('arm') == 'early' for r in events),
                                     observationGaps=sum(r['event'] == 'observationUnavailable' for r in events)))
            seen.add(mint)
    return dict(observations=observations, independentClosedPairs=len(deltas),
                deltaUsdc=sum(deltas)/UNIT if deltas else None,
                deltaWithoutBestUsdc=(sum(deltas)-max(deltas))/UNIT if len(deltas)>1 else None)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', type=Path, nargs='+', help='One evaluation period per invocation')
    print(json.dumps(replay([[json.loads(line) for line in path.read_text().splitlines()]
                             for path in cli.parse_args().logs]), indent=2))
