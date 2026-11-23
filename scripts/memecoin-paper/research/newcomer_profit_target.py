"""Replay the frozen +10% net target on immediate or recovery entries from completed paper sessions."""
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
                raise ValueError('Invalid entry resale path')
            post_entry_mark = previous_tick >= 0
            previous_at, previous_tick = row['at'], row['tick']
            if target is None:
                net = row['usdcRaw'] - SIZE - 2 * FEE
                peak = max(peak, net)
                drawdown = max(drawdown, peak - net)
                if post_entry_mark and 10 * net >= SIZE:
                    target = dict(state='closed', netUsdc=net / UNIT, exitReason='profitTarget',
                                  heldSeconds=row['at'] - entry['at'], sampledDrawdownUsdc=drawdown / UNIT,
                                  zeroRecoveryNetUsdc=net / UNIT)
    if target is None:
        return {key: baseline[key] for key in ('state', 'netUsdc', 'exitReason', 'heldSeconds',
                                                'sampledDrawdownUsdc', 'zeroRecoveryNetUsdc')}
    return target


def replay(streams, arm='early'):
    if arm not in ('early', 'wave'):
        raise ValueError('Unknown entry arm')
    gap_field = 'missingEarlyExitQuotes' if arm == 'early' else 'missingWaveExitQuotes'
    report(streams)
    observations = []
    deltas = []
    earlier_exits = 0
    seen = set()
    for rows in sorted(streams, key=lambda stream: next(r['at'] for r in stream if r['event'] == 'cohort')):
        for item in evaluate(rows):
            mint = item['mint']
            events = [r for r in rows if r.get('mint') == mint]
            baseline = item['paths'][arm]
            target = target_exit([r for r in events if r.get('arm') == arm], baseline)
            delta = None
            if baseline['state'] == target['state'] == 'closed':
                delta = round(target['netUsdc'] - baseline['netUsdc'], 6)
                if mint not in seen:
                    deltas.append(round(delta * UNIT))
                    if target['exitReason'] == 'profitTarget' and target['heldSeconds'] is not None:
                        sale = next(r for r in events if r.get('arm') == arm and r['event'] == 'exit')
                        entry = next(r for r in events if r.get('arm') == arm and r['event'] == 'entry')
                        earlier_exits += entry['at'] + target['heldSeconds'] < sale['at']
            observations.append(dict(cohortAt=item['cohortAt'], mint=mint, repeatedMint=mint in seen,
                                     baseline=baseline, target=target, deltaUsdc=delta,
                                     **{gap_field: sum(r['event'] == 'missingExitQuote' and r.get('arm') == arm
                                                       for r in events)},
                                     observationGaps=sum(r['event'] == 'observationUnavailable' for r in events)))
            seen.add(mint)
    return dict(observations=observations, independentClosedPairs=len(deltas),
                earlierTargetExits=earlier_exits,
                higherNet=sum(value > 0 for value in deltas),
                lowerNet=sum(value < 0 for value in deltas),
                equalNet=deltas.count(0),
                deltaWithoutLargestLossUsdc=(sum(deltas)-min(deltas))/UNIT if len(deltas)>1 else None,
                deltaUsdc=sum(deltas)/UNIT if deltas else None,
                deltaWithoutBestUsdc=(sum(deltas)-max(deltas))/UNIT if len(deltas)>1 else None)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', type=Path, nargs='+', help='One evaluation period per invocation')
    cli.add_argument('--arm', choices=('early', 'wave'), default='early')
    args = cli.parse_args()
    print(json.dumps(replay([[json.loads(line) for line in path.read_text().splitlines()]
                             for path in args.logs], args.arm), indent=2))
