"""Audit the frozen 10/20-minute shadow against the recorded immediate exit."""
import argparse
import json
from pathlib import Path

from meme_paper_account import FEE, SIZE, UNIT
from newcomer_cost_switch import evaluate
from newcomer_wave_pair import EXIT_GRACE, HOLD_SECONDS
from wave_band_report import report


def require(condition, message):
    if not condition:
        raise ValueError(message)


def inventory_path(events, baseline):
    """Reconcile raw token units and micro-USDC in receipt order."""
    remaining = initial = 0
    cash = -SIZE - FEE
    values = [0]
    sale = mark = partial_hold = outcome = None
    missing = 0
    for row in events:
        kind = row['event']
        if row.get('arm') == 'early':
            if kind == 'entry':
                initial = remaining = row['qty']
            elif kind == 'resaleMark':
                values.append(cash + row['usdcRaw'] - FEE)
            elif kind == 'exit':
                sale = row
        if not kind.startswith('runner'):
            continue
        require(remaining > 0 and outcome is None, 'Runner receipt outside open position')
        if kind == 'runnerUnresolved':
            require(row['remainingQty'] == remaining and row['cashRaw'] == cash,
                    'Unresolved inventory or cash mismatch')
            outcome = dict(state='unresolved', remainingQty=remaining, zeroRecoveryUsdc=cash/UNIT)
            continue
        require(sale is not None, 'Missing baseline sale')
        baseline_net = sale['usdcRaw'] - SIZE - 2*FEE
        if kind == 'runnerSharedExit':
            require(partial_hold is None and row['netRaw'] == baseline_net and
                    (sale['reason'] in ('stop', 'target') or initial < 2), 'Invalid shared exit')
            outcome = dict(state='sharedExit', netUsdc=baseline_net/UNIT,
                           heldSeconds=sale['heldSeconds'], deltaRaw=0)
            continue
        require(sale['reason'] == 'time', 'Split requires a baseline time exit')
        amount = remaining if partial_hold is not None else initial//2
        require(row['qty'] == amount and amount > 0, 'Runner sale quantity mismatch')
        if kind == 'runnerMissingQuote':
            missing += 1
            mark = None
        elif kind == 'runnerMark':
            held = row['heldSeconds']
            limit = HOLD_SECONDS if partial_hold is None else 2*HOLD_SECONDS
            require(sale['heldSeconds'] <= held <= limit + EXIT_GRACE and row['usdcRaw'] > 0,
                    'Invalid runner quote or holding window')
            require(mark is None or held >= mark['heldSeconds'], 'Out-of-order runner quote')
            mark = row
            if partial_hold is not None:
                require(held >= partial_hold, 'Quote precedes partial sale')
                values.append(cash + mark['usdcRaw'] - FEE)
        else:
            require(mark and (mark['qty'], mark['usdcRaw']) == (amount, row['usdcRaw']),
                    'Missing matching liquidation mark')
            cash += row['usdcRaw'] - FEE
            remaining -= amount
            if kind == 'runnerPartialSale':
                require(partial_hold is None and row['feeRaw'] == FEE, 'Invalid partial sale')
                partial_hold = mark['heldSeconds']
            else:
                allocated = SIZE * amount / initial
                reached_exit = (mark['heldSeconds'] >= 2*HOLD_SECONDS or
                                mark['usdcRaw']-FEE <= .70*allocated or
                                mark['usdcRaw']-FEE >= 3*allocated)
                require(reached_exit and kind == 'runnerExit' and remaining == 0 and row['netRaw'] == cash and
                        row['baselineNetRaw'] == baseline_net and row['heldSeconds'] == mark['heldSeconds'],
                        'Final liquidation receipt mismatch')
                outcome = dict(state='splitClosed', netUsdc=cash/UNIT, heldSeconds=row['heldSeconds'],
                               deltaRaw=cash-baseline_net)
            mark = None
    if not initial:
        return dict(state=baseline['state'])
    require(outcome is not None, 'Missing runner terminal receipt')
    peak = drawdown = 0
    for value in values:
        peak = max(peak, value)
        drawdown = max(drawdown, peak-value)
    return dict(**outcome, partialHeldSeconds=partial_hold, sampledDrawdownUsdc=drawdown/UNIT,
                missingRunnerQuotes=missing)


def compare(streams, legacy_times=()):
    report(streams)
    seen, deltas, observations = set(), [], []
    for rows in sorted(streams, key=lambda s: next(r['at'] for r in s if r['event']=='cohort')):
        cohort = next(r for r in rows if r['event']=='cohort')
        require(cohort.get('halfRunner', cohort['at'] in legacy_times) is True,
                'Expected H7 session; legacy sessions need explicit identification')
        for item in evaluate(rows):
            mint = item['mint']
            early = item['paths']['early']
            result = inventory_path([r for r in rows if r.get('mint') == mint], early)
            delta = result.pop('deltaRaw', None)
            if mint not in seen and delta is not None:
                deltas.append(delta)
            observations.append(dict(at=cohort['at'], mint=mint, repeated=mint in seen,
                                     baseline=early, runner=result,
                                     deltaUsdc=None if delta is None else delta/UNIT))
            seen.add(mint)
    return dict(observations=observations, independentClosedPairs=len(deltas),
                deltaUsdc=sum(deltas)/UNIT if deltas else None,
                withoutBestUsdc=(sum(deltas)-max(deltas))/UNIT if len(deltas)>1 else None)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('logs', nargs='+', type=Path)
    parser.add_argument('--legacy-cohort-at', action='append', type=int, default=[],
                        help='Confirmed H7 cohort timestamp from before #1566')
    args = parser.parse_args()
    streams = [[json.loads(line) for line in path.read_text().splitlines()] for path in args.logs]
    print(json.dumps(compare(streams, args.legacy_cohort_at), indent=2))
