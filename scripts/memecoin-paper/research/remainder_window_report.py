"""Replay the preregistered 15-minute remainder on validated 10/20 paper receipts."""
import argparse
import json
from pathlib import Path

from half_runner_report import compare
from meme_paper_account import FEE, SIZE, UNIT
from newcomer_wave_pair import EXIT_GRACE


REMAINDER_SECONDS = 900


def shorter_window(rows, runner):
    sale = None
    initial = peak = drawdown = 0
    for row in rows:
        kind = row['event']
        if row.get('arm') == 'early' and kind == 'entry':
            initial = row['qty']
        if row.get('arm') == 'early' and kind == 'resaleMark':
            net = row['usdcRaw'] - SIZE - 2*FEE
        elif kind == 'runnerPartialSale':
            sale = row
            continue
        elif sale and kind == 'runnerMark':
            held = row['heldSeconds']
            if held > REMAINDER_SECONDS + EXIT_GRACE:
                break
            net = sale['usdcRaw'] + row['usdcRaw'] - SIZE - 3*FEE
            allocated = SIZE * row['qty'] / initial
            proceeds = row['usdcRaw'] - FEE
            exit_due = held >= REMAINDER_SECONDS or proceeds <= .7*allocated or proceeds >= 3*allocated
            if exit_due:
                return dict(state='splitClosed', heldSeconds=held, netUsdc=net/UNIT,
                            sampledDrawdownUsdc=max(drawdown, peak-net)/UNIT)
        else:
            continue
        peak = max(peak, net)
        drawdown = max(drawdown, peak-net)
    if sale:
        return dict(state='unresolved', remainingQty=initial-sale['qty'],
                    zeroRecoveryUsdc=(sale['usdcRaw']-SIZE-2*FEE)/UNIT,
                    sampledDrawdownUsdc=drawdown/UNIT)
    return dict(runner)


def replay(streams, legacy_times=()):
    audited = compare(streams, legacy_times)
    sessions = {}
    for rows in streams:
        cohort = next(r for r in rows if r['event'] == 'cohort')
        for mint in cohort['mints']:
            key = cohort['at'], mint
            if key in sessions:
                raise ValueError('Ambiguous mint and cohort timestamp')
            sessions[key] = [r for r in rows if r.get('mint') == mint]
    deltas = {'baseline': [], 'runner': []}
    for item in audited['observations']:
        rows = sessions[item['at'], item['mint']]
        shorter = shorter_window(rows, item['runner'])
        item['fifteenMinute'] = shorter
        for name, values in deltas.items():
            ref = item[name]
            if (not item['repeated'] and shorter['state'] in ('sharedExit','splitClosed')
                    and ref['state'] in ('closed','sharedExit','splitClosed')):
                values.append(round((shorter['netUsdc']-ref['netUsdc'])*UNIT))
    return dict(observations=audited['observations'], paired={
        name: dict(count=len(values), deltaUsdc=sum(values)/UNIT if values else None,
                   withoutBestUsdc=(sum(values)-max(values))/UNIT if len(values)>1 else None)
        for name, values in deltas.items()})


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', nargs='+', type=Path)
    cli.add_argument('--legacy-cohort-at', type=int, action='append', default=[])
    args = cli.parse_args()
    streams = [[json.loads(line) for line in path.read_text().splitlines()] for path in args.logs]
    print(json.dumps(replay(streams, args.legacy_cohort_at), indent=2))
