"""Measure independent, hypothetical 60-minute round trips for recorded V3 cost vetoes."""
import argparse
from contextlib import closing
from datetime import datetime
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
from statistics import median

from feeds import COST_VERSION
from worker import DAY, SLIP, STEP, execute, initial, iso

STAGES = {
    'Stundenbandbreite deckt die Handelskosten nicht.': 'beforeModel',
    'Aktuelles Orderbuch deckt die Gewinnschwelle im Stundenband nicht.': 'afterBuySignal',
}


def replay_fill(state, action, slot, record, *, mandatory=False):
    if not record:
        return 'MISSING_RECORD'
    at = datetime.fromisoformat(record['report']['last']['at']).timestamp()
    if not slot <= at < slot + (STEP if mandatory else 90):
        return 'OUTSIDE_WINDOW'
    return execute(state, action, record.get('executionBook'), slot)


# Freeze the two new hypotheses before the first prospective decision.
FORWARD_START = int(datetime.fromisoformat('2026-11-19T09:00:00+00:00').timestamp())
NEW_SIGNALS = ('breakoutRetest', 'failedBreakdown')


def entry_signals(record, slot):
    bars = (record.get('inputs') or {}).get('ten', [])[-8:]
    if len(bars) != 8 or any(len(bar) != 5 or bar[0] != slot - (8-i)*STEP
                             for i, bar in enumerate(bars)):
        return dict.fromkeys(('confirmedBreakout', *NEW_SIGNALS))
    resistance = max(bar[2] for bar in bars[:6])
    support = min(bar[3] for bar in bars[:6])
    first, second = bars[-2:]
    return dict(
        confirmedBreakout=first[4] > resistance and second[4] > resistance,
        breakoutRetest=first[4] > resistance and second[3] <= resistance < second[4],
        failedBreakdown=first[3] < support < first[4] and second[4] > first[2],
    )


def confirmed_breakout(record, slot):
    return entry_signals(record, slot)['confirmedBreakout']


def summarize_windows(samples):
    pnl = [Decimal(sample['netEur']) for sample in samples if sample['status'] == 'MEASURED']
    pending = sum(sample['status'] == 'PENDING_EXIT' for sample in samples)
    return dict(total=len(samples), measured=len(pnl), pending=pending,
                unavailable=len(samples)-len(pnl)-pending,
                meanNetEur=str(sum(pnl)/len(pnl)) if pnl else None)


def disjoint_windows(samples):
    """Select the earliest eligible interval without looking at its eventual outcome."""
    selected = []
    for sample in sorted(samples, key=lambda row: row['entryAt']):
        if not selected or sample['entryAt'] >= selected[-1]['exitAt']:
            selected.append(sample)
    return selected


def forward_comparison(samples):
    comparison = {}
    for signal in NEW_SIGNALS:
        groups = {}
        for value, name in ((True, 'signal'), (False, 'noSignal'), (None, 'unknown')):
            subset = [sample for sample in samples if sample['entryAt'] >= iso(FORWARD_START)
                      and sample[signal] is value]
            groups[name] = summarize_windows(subset)
            groups[name]['disjointWindows'] = summarize_windows(disjoint_windows(subset))
        comparison[signal] = groups
    return dict(fromUtc=iso(FORWARD_START), groups=comparison)


def veto_outcomes(samples):
    """Count complete scheduled one-hour windows from the prospective period."""
    forward = [row for row in samples if row['entryAt'] >= iso(FORWARD_START)]
    full_hour = [row for row in forward if (datetime.fromisoformat(row['exitAt']) -
                 datetime.fromisoformat(row['entryAt'])).total_seconds() == 3600]

    def outcomes(rows):
        summary = summarize_windows(rows)
        measured = [Decimal(row['netEur']) for row in rows if row['status'] == 'MEASURED']
        return dict(**summary, profitable=sum(net > 0 for net in measured),
                    loss=sum(net < 0 for net in measured), flat=sum(net == 0 for net in measured))

    return dict(fromUtc=iso(FORWARD_START), shortenedAtClose=len(forward)-len(full_hour),
                all=outcomes(full_hour), disjointWindows=outcomes(disjoint_windows(full_hour)),
                byStage={stage: outcomes([row for row in full_hour if row['stage'] == stage])
                         for stage in STAGES.values()})


def pnl_components(quantity, entry_book, exit_book, net):
    """Reconcile the midpoint move to both simulated fills for the same BTC quantity."""
    entry_bid, entry_ask = (Decimal(str(entry_book[k])) for k in ('bid', 'ask'))
    exit_bid, exit_ask = (Decimal(str(exit_book[k])) for k in ('bid', 'ask'))
    quoted = quantity * (exit_bid - entry_ask)
    spread = quantity * ((entry_ask - entry_bid) + (exit_ask - exit_bid)) / 2
    slippage = quantity * (entry_ask + exit_bid) * SLIP
    return dict(midpointMoveEur=str(quoted + spread), spreadEur=str(spread),
                slippageEur=str(slippage), feesEur=str(quoted - slippage - net))


def replay_exit(records, latest, exit_slot, close, bought, initial_cash, entry_book):
    if exit_slot > latest:
        return dict(status='PENDING_EXIT')
    state = dict(bought)
    sale = replay_fill(state, 'SELL', exit_slot, records.get(exit_slot), mandatory=exit_slot == close)
    if sale != 'PAPER_SELL':
        return dict(status='EXIT_' + sale)
    pnl = Decimal(state['cash']) - initial_cash
    return dict(status='MEASURED', netEur=str(pnl),
                components=pnl_components(Decimal(bought['btc']), entry_book,
                                          records[exit_slot]['executionBook'], pnl))


def first_covered_exit(slot, exit_slot, latest, outcome, fixed):
    """Exit at the first observable, executable nonnegative net return, else at deadline."""
    skipped = []
    for check in range(slot + STEP, min(latest + 1, exit_slot), STEP):
        result = outcome(check)
        if result['status'] != 'MEASURED':
            skipped.append(dict(at=iso(check), reason=result['status']))
            continue
        net = Decimal(result['netEur'])
        if net >= 0:
            delta = net - Decimal(fixed['netEur']) if fixed['status'] == 'MEASURED' else None
            return dict(status='EARLY_EXIT', exitAt=iso(check), netEur=str(net),
                        deltaVsFixedEur=str(delta) if delta is not None else None,
                        skippedChecks=len(skipped), skippedObservations=skipped)
    measured = fixed['status'] == 'MEASURED'
    return dict(status='DEADLINE_EXIT' if measured else fixed['status'],
                exitAt=iso(exit_slot) if measured else None, netEur=fixed.get('netEur'),
                deltaVsFixedEur='0' if measured else None, skippedChecks=len(skipped), skippedObservations=skipped)


def observation_gaps(samples, records):
    """Group unavailable intermediate exits across hypothetical positions by timestamp."""
    gaps = {}
    for sample in samples:
        early = sample.get('exploratoryFirstCoveredExit', {})
        for skipped in early.get('skippedObservations', []):
            reasons = gaps.setdefault(skipped['at'], {})
            reason = skipped['reason']
            reasons[reason] = reasons.get(reason, 0) + 1
    result = []
    for at, reasons in sorted(gaps.items()):
        gap = dict(at=at, affectedWindows=sum(reasons.values()), reasons=reasons)
        if 'EXIT_NO_FRESH_BOOK' in reasons:
            record = records[int(datetime.fromisoformat(at).timestamp())]
            gap['executionBookStatus'] = record.get('executionBookStatus', 'NOT_RECORDED')
        result.append(gap)
    return result


# Freeze this independent hourly comparison before the first eligible entry.
EXPANSION_START = int(datetime.fromisoformat('2026-11-19T13:00:00+00:00').timestamp())
REBOUND_START = int(datetime.fromisoformat('2026-11-19T17:00:00+00:00').timestamp())
HOUR = 3600


def hourly_regime(record, slot):
    bars = (record.get('inputs') or {}).get('hour', [])[-7:]
    if len(bars) != 7 or any(len(bar) != 5 or bar[0] != slot-(7-i)*HOUR
                             for i, bar in enumerate(bars)):
        return 'unknown'
    if bars[-1][4] <= bars[-1][1]:
        return 'nonRising'
    ranges = [(bar[2]-bar[3])/bar[1] for bar in bars]
    return 'risingExpansion' if ranges[-1] > median(ranges[:-1]) else 'risingControl'


def hourly_trade(records, latest, slot, end, close):
    state = initial()
    cash = Decimal(state['cash'])
    record = records.get(slot)
    entry = replay_fill(state, 'BUY', slot, record)
    if entry != 'PAPER_BUY':
        return dict(status='ENTRY_' + entry)
    return replay_exit(records, latest, end, close, state, cash, record['executionBook'])


def confirmed_hourly_entry(records, latest, slot, unconditional):
    check = slot+STEP
    if check > latest:
        return dict(status='PENDING_CONFIRMATION')
    follow = records.get(check) or {}
    bars = (follow.get('inputs') or {}).get('ten', [])
    if follow.get('promptVersion') != COST_VERSION or not bars or len(bars[-1]) != 5 or bars[-1][0] != slot:
        return dict(status='CONFIRMATION_UNAVAILABLE')
    at = datetime.fromisoformat(follow['report']['last']['at']).timestamp()
    if not check <= at < check+90:
        return dict(status='CONFIRMATION_OUTSIDE_WINDOW')
    if bars[-1][4] <= records[slot]['inputs']['hour'][-1][4]:
        return dict(status='SKIPPED', netEur='0')
    return dict(unconditional)


def ai_veto(record, immediate, settled_usd, eur_per_usd):
    last = record['report']['last']
    if last['reason'].startswith('MODEL_UNAVAILABLE'):
        return dict(status='MODEL_FAILURE')
    if not record.get('usage'):
        return dict(status='NO_MODEL_DECISION')
    # A post-model cost veto is emitted only after a BUY. Existing-position
    # decisions are outside this flat-account entry comparison.
    buy = last['action'] == 'BUY' or STAGES.get(last['reason']) == 'afterBuySignal'
    if last['execution'] != 'PAPER_BUY' and Decimal(record['states']['model']['btc']):
        return dict(status='POSITION_INELIGIBLE')
    if last['action'] == 'SELL':
        return dict(status='POSITION_INELIGIBLE')
    if immediate['status'] != 'MEASURED':
        return dict(status=immediate['status'])
    delta = Decimal(0) if buy else -Decimal(immediate['netEur'])
    cost = record.get('slotApiCostEur')
    if cost is not None:
        cost = Decimal(str(cost))
    elif settled_usd is not None and eur_per_usd is not None:
        cost = settled_usd * eur_per_usd
    return dict(status='ALLOW' if buy else 'VETO', tradingDeltaEur=str(delta),
                settledApiUsd=str(settled_usd) if settled_usd is not None else None,
                apiCostEur=str(cost) if cost is not None else None,
                deltaAfterApiEur=str(delta-cost) if cost is not None else None)


def confirmation_results(samples, regime='risingExpansion'):
    paired = skipped = unmatched = 0
    immediate = confirmed = avoided = missed = timing = Decimal(0)
    for sample in samples:
        if sample['regime'] != regime:
            continue
        delayed = sample['confirmed10m']
        if 'deltaVsImmediateEur' not in delayed:
            unmatched += 1
            continue
        paired += 1
        baseline = Decimal(sample['netEur'])
        immediate += baseline
        confirmed += Decimal(delayed['netEur'])
        if delayed['status'] == 'SKIPPED':
            skipped += 1
            avoided += max(-baseline, 0)
            missed += max(baseline, 0)
        else:
            timing += Decimal(delayed['deltaVsImmediateEur'])
    totals = dict(immediateNetEur=immediate, confirmedNetEur=confirmed,
                  avoidedLossEur=avoided, missedGainEur=missed, entryTimingDeltaEur=timing,
                  netDeltaEur=confirmed-immediate)
    return dict(paired=paired, unmatched=unmatched, skipped=skipped, entered=paired-skipped,
                meanDeltaEur=str((confirmed-immediate)/paired) if paired else None,
                **{key: str(value) if paired else None for key, value in totals.items()})


def skipped_delayed_trades(samples, regime):
    """Compare each explicit skip with buying at the same ten-minute checkpoint."""
    avoided = missed = flat = unavailable = 0
    losses = gains = Decimal(0)
    for sample in samples:
        if sample['regime'] != regime or sample['confirmed10m']['status'] != 'SKIPPED':
            continue
        delayed = sample['unconditional10m']
        if delayed['status'] != 'MEASURED':
            unavailable += 1
            continue
        net = Decimal(delayed['netEur'])
        if net < 0:
            avoided += 1
            losses -= net
        elif net > 0:
            missed += 1
            gains += net
        else:
            flat += 1
    measured = avoided + missed + flat
    return dict(measured=measured, unavailable=unavailable, avoidedLosses=avoided,
                missedGains=missed, flat=flat, avoidedLossEur=str(losses) if measured else None,
                missedGainEur=str(gains) if measured else None,
                netBenefitEur=str(losses-gains) if measured else None)


def delay_attribution(samples, regime):
    complete = incomplete = 0
    waiting = selection = Decimal(0)
    for sample in samples:
        if sample['regime'] != regime:
            continue
        unconditional = sample['unconditional10m']
        confirmed = sample['confirmed10m']
        if sample['status'] != 'MEASURED' or unconditional['status'] != 'MEASURED' or confirmed['status'] not in ('MEASURED', 'SKIPPED'):
            incomplete += 1
            continue
        complete += 1
        delayed_net = Decimal(unconditional['netEur'])
        waiting += delayed_net - Decimal(sample['netEur'])
        selection += Decimal(confirmed['netEur']) - delayed_net
    return dict(complete=complete, incomplete=incomplete,
                skippedDelayedTrades=skipped_delayed_trades(samples, regime),
                waitOnlyDeltaEur=str(waiting) if complete else None,
                signalDeltaAfterWaitEur=str(selection) if complete else None)


def rebound_results(samples):
    candidates = [row for row in samples if row.get('reboundEligible')]
    closed = []
    skipped = paired = 0
    paired_delta = Decimal(0)
    for row in candidates:
        entry = row['confirmed10m']
        if entry['status'] not in ('SKIPPED', 'MEASURED'):
            continue
        net = Decimal(entry['netEur'])
        if entry['status'] == 'SKIPPED':
            skipped += 1
        else:
            closed.append(net)
        always = row['unconditional10m']
        if always['status'] == 'MEASURED':
            paired += 1
            paired_delta += net - Decimal(always['netEur'])
    resolved = len(closed) + skipped
    return dict(fromUtc=iso(REBOUND_START), eligible=len(candidates), closedTrades=len(closed),
                skipped=skipped, unresolved=len(candidates)-resolved,
                profitableTrades=sum(net > 0 for net in closed),
                netVsCashEur=str(sum(closed, Decimal(0))) if resolved else None,
                meanNetPerTradeEur=str(sum(closed)/len(closed)) if closed else None,
                alwaysBuyPairs=paired, netVsAlwaysBuy10mEur=str(paired_delta) if paired else None)


def hourly_expansion_study(records, charges, eur_per_usd):
    latest = max(records, default=-1)
    samples = []
    for slot in range(EXPANSION_START, latest+1, HOUR):
        close = slot-slot%DAY+DAY-STEP
        end = slot+HOUR
        if end > close:
            continue
        record = records.get(slot)
        if record and record['promptVersion'] != COST_VERSION:
            continue
        regime = hourly_regime(record or {}, slot)
        sample = dict(entryAt=iso(slot), exitAt=iso(end), regime=regime)
        sample.update(hourly_trade(records, latest, slot, end, close))
        if regime == 'risingExpansion':
            sample['aiVeto'] = ai_veto(record, sample, charges.get(slot), eur_per_usd)
        if regime == 'nonRising' and slot >= REBOUND_START:
            last_hour = record['inputs']['hour'][-1]
            sample['reboundEligible'] = last_hour[4] < last_hour[1]
        if regime in ('risingExpansion', 'risingControl') or sample.get('reboundEligible'):
            check = slot + STEP
            follow = records.get(check)
            if check > latest:
                unconditional = dict(status='PENDING_ENTRY')
            elif follow and follow.get('promptVersion') != COST_VERSION:
                unconditional = dict(status='ENTRY_VERSION_MISMATCH')
            else:
                unconditional = hourly_trade(records, latest, check, end, close)
            sample['unconditional10m'] = unconditional
            delayed = confirmed_hourly_entry(records, latest, slot, unconditional)
            sample['confirmed10m'] = delayed
            if sample['status'] == 'MEASURED' and delayed['status'] in ('SKIPPED', 'MEASURED'):
                delayed['deltaVsImmediateEur'] = str(Decimal(delayed['netEur']) - Decimal(sample['netEur']))
        samples.append(sample)
    groups = {name: summarize_windows([row for row in samples if row['regime'] == name])
              for name in ('risingExpansion', 'risingControl', 'nonRising', 'unknown')}
    confirmation = confirmation_results(samples)
    control = confirmation_results(samples, 'risingControl')
    difference = None
    if confirmation['paired'] and control['paired']:
        difference = str(Decimal(confirmation['meanDeltaEur']) - Decimal(control['meanDeltaEur']))
    ai_deltas = [Decimal(row['aiVeto']['deltaAfterApiEur']) for row in samples
                 if row.get('aiVeto', {}).get('deltaAfterApiEur') is not None]
    return dict(aiPricedPairs=len(ai_deltas), sumPairedAiDeltaEur=str(sum(ai_deltas)) if ai_deltas else None,
                eurPerUsd=str(eur_per_usd) if eur_per_usd is not None else None, fromUtc=iso(EXPANSION_START), samples=samples, groups=groups,
                delayAttribution={name: delay_attribution(samples, name)
                                  for name in ('risingExpansion', 'risingControl')},
                fallingHourRebound=rebound_results(samples),
                risingControlConfirmationResults=control,
                expansionMinusControlMeanDeltaEur=difference,
                confirmationResults=confirmation, confirmationPairs=confirmation['paired'],
                meanConfirmationDeltaEur=confirmation['meanDeltaEur'])


def audit(db, eur_per_usd=None):
    if eur_per_usd is not None and (not eur_per_usd.is_finite() or eur_per_usd <= 0):
        raise ValueError('eur_per_usd must be finite and positive')
    charges = {}
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='calls'").fetchone():
        from pilot import UNIT
        charges = {slot: Decimal(charge)/UNIT for slot, charge in
                   db.execute('SELECT slot, charge FROM calls WHERE settled=1')}

    records = {slot: json.loads(raw) if raw else None
               for slot, raw in db.execute('SELECT slot, record FROM slots ORDER BY slot')}
    latest = max(records, default=-1)
    samples = []
    for slot, record in records.items():
        if not record or record['promptVersion'] != COST_VERSION:
            continue
        last = record['report']['last']
        stage = STAGES.get(last['reason'])
        model = record['states']['model']
        if not stage or last['action'] != 'HOLD' or last['execution'] != 'HOLD' or Decimal(model['btc']):
            continue
        close = slot - slot % DAY + DAY - STEP
        exit_slot = min(slot + 6 * STEP, close)
        sample = dict(entryAt=iso(slot), exitAt=iso(exit_slot), stage=stage,
                      **entry_signals(record, slot))
        samples.append(sample)
        state = dict(model)
        entry = replay_fill(state, 'BUY', slot, record)
        def outcome(end):
            if entry != 'PAPER_BUY':
                return dict(status='ENTRY_' + entry)
            return replay_exit(records, latest, end, close, state, Decimal(model['cash']),
                               record['executionBook'])

        sample.update(outcome(exit_slot))
        if slot >= FORWARD_START and entry == 'PAPER_BUY':
            sample['exploratoryFirstCoveredExit'] = first_covered_exit(slot, exit_slot, latest, outcome, sample)
        if slot >= FORWARD_START and any(sample[key] for key in NEW_SIGNALS):
            early_exit = min(slot + 3 * STEP, close)
            early = outcome(early_exit) if early_exit != exit_slot else sample
            pair = dict(exitAt=iso(early_exit), status=early['status'], netEur=early.get('netEur'),
                        extraNetFromHoldingEur=None)
            if early_exit != exit_slot and early['status'] == sample['status'] == 'MEASURED':
                pair['extraNetFromHoldingEur'] = str(Decimal(sample['netEur']) - Decimal(early['netEur']))
            sample['exploratory30m'] = pair
    return dict(horizonMinutes=60, samples=samples, forwardComparison=forward_comparison(samples),
                forwardVetoOutcomes60m=veto_outcomes(samples),
                intermediateExitGaps=observation_gaps(samples, records),
                hourlyExpansion=hourly_expansion_study(records, charges, eur_per_usd))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('journal', type=Path)
    parser.add_argument('--eur-per-usd', type=Decimal, help='EUR value of one USD for settled API charges')
    args = parser.parse_args()
    with closing(sqlite3.connect(args.journal.resolve().as_uri() + '?mode=ro', uri=True)) as journal:
        print(json.dumps(audit(journal, args.eur_per_usd), indent=2))
