"""Compare F's recorded entries with a trailing exit on the same full-size quotes."""
import argparse
import json
from pathlib import Path

from meme_paper_account import FEE, SIZE, START, UNIT


def paired_exit_detail(fixed, trailing):
    pairs = []
    deltas = []
    for key, trailing_net in trailing.items():
        if key in fixed:
            delta = trailing_net - fixed[key]
            deltas.append(delta)
            pairs.append(dict(positionId=key, fixedNetUsdc=fixed[key] / UNIT,
                              trailingNetUsdc=trailing_net / UNIT, trailingMinusFixedUsdc=delta / UNIT))
    total = sum(deltas)
    return dict(trades=pairs, trailingBetter=sum(d > 0 for d in deltas),
                fixedBetter=sum(d < 0 for d in deltas), equal=deltas.count(0),
                minDeltaAfterOmittingOneUsdc=(total - max(deltas)) / UNIT if len(deltas) > 1 else None,
                maxDeltaAfterOmittingOneUsdc=(total - min(deltas)) / UNIT if len(deltas) > 1 else None)


def entry_cost_profile(events, entries, realized):
    """Group F trades by the pre-buy quote emitted directly after the entry."""
    bands = {name: dict(closed=0, losses=0, open=0, netRaw=0)
             for name in ('upTo3Pct', 'over3To5Pct', 'unknown')}
    measured = {}
    previous = {}
    for row in events:
        key = previous.get('positionId')
        if (previous.get('event') == 'entry' and key in entries
                and row.get('event') == 'resaleMark' and row.get('positionId') == key
                and row.get('mint') == previous['mint'] and row.get('qty') == previous['qty']
                and row.get('inputRaw') == previous['qty'] and previous.get('inputRaw') == SIZE
                and previous.get('outputMint') == row.get('inputMint') == previous['mint']
                and previous.get('inputMint') == row.get('outputMint') == 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
                and previous.get('provider') == row.get('provider') == 'Jupiter'):
            bid = row.get('usdcRaw')
            if type(bid) is int and 100 * bid >= 95 * SIZE:
                measured[key] = 'upTo3Pct' if 100 * bid >= 97 * SIZE else 'over3To5Pct'
        previous = row
    for key in entries:
        band = bands[measured.get(key, 'unknown')]
        if key in realized:
            band['closed'] += 1
            band['losses'] += int(realized[key] < 0)
            band['netRaw'] += realized[key]
        else:
            band['open'] += 1
    for band in bands.values():
        band['netUsdc'] = band.pop('netRaw') / UNIT
    return bands


def delayed_sale_profile(rows, sales):
    seen = set()
    original = delayed = reversals = busy = unavailable = quoted = 0
    for row in rows:
        key = row['sourceEventId']
        sale = sales.get(key)
        if (key in seen or sale is None or row['signalAt'] != sale['at']
                or any(row[field] != sale[field] for field in ('mint', 'qty', 'positionId'))
                or row['primaryRaw'] != sale['usdcRaw']):
            raise ValueError('Delayed quote does not match a unique F sale')
        seen.add(key)
        if row['state'] == 'busy':
            busy += 1
        elif row['state'] == 'unavailable':
            unavailable += 1
        elif row['state'] == 'quoted':
            bid = row['delayedRaw']
            if (type(bid) is not int or bid <= 0 or not
                    5 <= row['requestDelaySeconds'] <= row['responseDelaySeconds'] < float('inf')):
                raise ValueError('Invalid delayed quote or timing')
            basis = SIZE + 2 * FEE
            original += sale['usdcRaw'] - basis
            delayed += bid - basis
            reversals += int(sale['usdcRaw'] > basis > bid)
            quoted += 1
        else:
            raise ValueError('Unknown delayed quote state')
    return dict(sales=len(sales), quoted=quoted, busy=busy, unavailable=unavailable,
                missing=len(sales)-len(seen), originalNetUsdc=original / UNIT,
                delayedNetUsdc=delayed / UNIT, profitToLoss=reversals)


def score(directory, *, confirmed_loss_exit=False):
    status = json.loads((directory / 'status.json').read_text())
    if status.get('ledgerVerified') is not True or status['lastEvent'] != 'finished':
        raise ValueError('Expected a completed, reconciled journal')
    reference = status['accounts']['F']
    if reference['policy'] != 'smallPoolFixed':
        raise ValueError('Unexpected reference strategy')
    open_positions = {}
    fixed_positions = {}
    seen = {}
    cash = START
    skipped = []
    sales = {}
    fixed_results = {}
    fixed_exit_at = {}
    trailing_results = {}
    trades = []
    bought = set()
    last = None
    for line in (directory / 'events.jsonl').read_text().splitlines():
        row = json.loads(line)
        event_id = row['eventId']
        if event_id in seen:
            if seen[event_id] != row:
                raise ValueError('Conflicting event ID')
            continue
        if not seen and (row['event'] != 'start' or row['at'] != status['startedAt']):
            raise ValueError('Missing start')
        seen[event_id] = last = row
        for fill in row['fills']:
            if fill['account'] != 'F':
                continue
            key = fill['positionId']
            qty = fill['qty']
            if (row.get('arm') != 'wave' or row.get('positionId') != key or qty != row['qty']
                    or key != f"{row['session']}:wave:{row['mint']}" or type(qty) is not int or qty <= 0):
                raise ValueError('Inconsistent F fill')
            if fill['side'] == 'buy':
                if row['event'] != 'entry' or fill['usdcRaw'] != SIZE or key in bought:
                    raise ValueError('Invalid F entry')
                bought.add(key)
                fixed_positions[key] = qty
                if cash >= SIZE + FEE:
                    cash -= SIZE + FEE
                    open_positions[key] = dict(qty=qty, peak=0, marks=0, loss_at=None)
                else:
                    skipped.append(key)
            elif fill['side'] == 'sell' and fixed_positions.pop(key) == qty:
                if row['event'] not in ('resaleMark', 'exit') or row['usdcRaw'] != fill['usdcRaw']:
                    raise ValueError('Invalid F exit')
                sales[event_id] = row
                fixed_exit_at[key] = row['at']
                fixed_results[key] = fill['usdcRaw'] - SIZE - 2 * FEE
            else:
                raise ValueError('Unknown F fill')

        key = row.get('positionId')
        position = open_positions.get(key)
        if not position or row.get('arm') != 'wave' or row['event'] not in ('resaleMark', 'exit'):
            continue
        bid = row['usdcRaw']
        if (type(bid) is not int or bid <= 0
                or type(row['qty']) is not int or row['qty'] != position['qty']
                or key != f"{row['session']}:wave:{row['mint']}"):
            raise ValueError('Invalid full-size exit quote')
        net = bid - SIZE - 2 * FEE
        # As in A, the initial resale check cannot arm the trail.
        trail = position['peak'] * 10 >= SIZE and 2 * net <= position['peak']
        stop = False
        if confirmed_loss_exit:
            # Two successive available full-size quotes, at distinct timestamps.
            previous = position['loss_at']
            if net * 10 <= -SIZE:
                stop = previous is not None and row['at'] > previous
                position['loss_at'] = row['at']
            else:
                position['loss_at'] = None
        if stop or trail or row['event'] == 'exit':
            cash += bid - FEE
            trailing_results[key] = net
            trades.append(dict(positionId=key, at=row['at'], netUsdc=net / UNIT,
                               reason='confirmedLoss' if stop else 'trailing' if trail else 'timed'))
            del open_positions[key]
        else:
            if position['marks']:
                position['peak'] = max(position['peak'], net)
            position['marks'] += 1

    fixed_net = sum(fixed_results.values())
    fixed_closed = len(fixed_results)
    if (not last or last['event'] != 'finished' or last['at'] != status['updatedAt']
            or fixed_closed != reference['closedTrades'] or fixed_net / UNIT != reference['realizedUsdc']
            or fixed_positions != {p['positionId']: p['qty'] for p in reference['openPositions']}):
        raise ValueError('Journal does not reconcile with final F account')
    realized = cash - START + len(open_positions) * (SIZE + FEE)
    paired = fixed_results.keys() & trailing_results.keys()
    fixed_paired = sum(fixed_results[key] for key in paired)
    trailing_paired = sum(trailing_results[key] for key in paired)
    skipped_closed = [key for key in skipped if key in fixed_results]
    comparison = dict(
        sharedEntries=len(bought) - len(skipped),
        bothClosed=len(paired),
        sharedStillOpenOnEitherSide=len(bought) - len(skipped) - len(paired),
        pairedFixedNetUsdc=fixed_paired / UNIT,
        pairedTrailingNetUsdc=trailing_paired / UNIT,
        pairedTrailingMinusFixedUsdc=(trailing_paired - fixed_paired) / UNIT,
        skippedFixedClosed=len(skipped_closed),
        skippedFixedStillOpen=len(skipped) - len(skipped_closed),
        skippedFixedRealizedUsdc=sum(fixed_results[key] for key in skipped_closed) / UNIT,
    )
    detail = paired_exit_detail(fixed_results, trailing_results)
    trailing_exit_at = {trade['positionId']: trade['at'] for trade in trades}
    for pair in detail['trades']:
        key = pair['positionId']
        fixed_at = fixed_exit_at[key]
        trailing_at = trailing_exit_at[key]
        if type(fixed_at) is not int or type(trailing_at) is not int:
            raise ValueError('Expected integer exit timestamps')
        pair.update(fixedExitAt=fixed_at, trailingExitAt=trailing_at,
                    trailingMinusFixedExitSeconds=trailing_at - fixed_at)
    measurement = {}
    probes = directory / 'exit-requotes.jsonl'
    if not confirmed_loss_exit and probes.is_file():
        with probes.open() as stream:
            measurement['delayedSales'] = delayed_sale_profile(map(json.loads, stream), sales)
    return dict(comparison=comparison, pairedExits=detail, **measurement,
                entryCostProfile=entry_cost_profile(seen.values(), bought, fixed_results),
                startedAt=status['startedAt'], endedAt=status['updatedAt'], initialUsdc=START / UNIT,
                fixed=dict(realizedUsdc=fixed_net / UNIT, closed=fixed_closed, open=len(fixed_positions)),
                trailing=dict(realizedUsdc=realized / UNIT, cashUsdc=cash / UNIT, closed=len(trades),
                              open=list(open_positions), skippedForCash=len(skipped), trades=trades))


def compare_policies(directory):
    baseline = score(directory)
    candidate = score(directory, confirmed_loss_exit=True)['trailing']
    reference = baseline['trailing']
    def outcomes(account):
        return {trade['positionId']: round(trade['netUsdc'] * UNIT) for trade in account['trades']}
    ordinary, guarded = outcomes(reference), outcomes(candidate)
    shared = ordinary.keys() & guarded.keys()
    baseline['confirmedLossExit'] = dict(
        account=candidate, matchedClosed=len(shared),
        ordinaryNetUsdc=sum(ordinary[key] for key in shared) / UNIT,
        guardedNetUsdc=sum(guarded[key] for key in shared) / UNIT,
        triggered=sum(trade['reason'] == 'confirmedLoss' for trade in candidate['trades']),
        unmatchedClosed=len(ordinary.keys() ^ guarded.keys()))
    return baseline


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    print(json.dumps(compare_policies(parser.parse_args().directory), indent=2))
