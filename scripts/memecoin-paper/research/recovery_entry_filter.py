"""Replay a late-entry filter using only reference bids recorded before each entry."""
import argparse
import json
from pathlib import Path

from collections import Counter

from recovery_exit_audit import SHADOW_START, audit

# 23 November 2026, 18:15 Vienna. Earlier observations are development data.
FORWARD_START = 1795454100


def decisions(events, cutoff=FORWARD_START):
    reference = {}
    outcomes = {}
    for row in events:
        key = row['session'], row.get('mint')
        kind = row['event']
        if row.get('arm') == 'early':
            if kind == 'resaleMark':
                if row['tick'] == 0:
                    reference[key] = dict(initial=row['usdcRaw'], qty=row['qty'])
                ref = reference.get(key)
                if ref:
                    ref['last'] = row if row['qty'] == ref['qty'] else None
            elif kind in ('missingExitQuote', 'lateExitQuote') and key in reference:
                reference[key]['last'] = None
        if row.get('arm') != 'wave' or kind != 'entry' or row['at'] < cutoff:
            continue
        ref = reference.get(key, {})
        mark = ref.get('last')
        decision = 'followBaselineNoFreshReference'
        if mark and mark['tick'] > 0 and 0 <= row['at'] - mark['at'] <= 90:
            decision = 'skipExtended' if 10*mark['usdcRaw'] > 11*ref['initial'] else 'followBaseline'
        outcomes[key] = decision
    return outcomes


def compare(events, status, cutoff=FORWARD_START):
    positions = audit(iter(events), status, shadow_start=min(cutoff, SHADOW_START))['positions']
    rules = decisions(events, cutoff)
    skipped = []
    included = []
    unresolved = []
    included_by_mint = Counter()
    skip_delta_by_mint = Counter()
    paired_standard = []
    paired_stop = []
    paired_filtered = []
    paired_combined = []
    for p in positions:
        key = p['session'], p['mint']
        if key not in rules:
            continue
        skip = rules[key] == 'skipExtended'
        receipt = p['exits'].get('B')
        stop = p['exits'].get('D')
        if receipt is not None and stop is not None:
            baseline_net = receipt['netPnlUsdc']
            stop_net = stop['netPnlUsdc']
            paired_standard.append(baseline_net)
            paired_stop.append(stop_net)
            paired_filtered.append(0 if skip else baseline_net)
            paired_combined.append(0 if skip else stop_net)
        if receipt is None:
            unresolved.append(dict(session=key[0], mint=key[1], decision=rules[key]))
        elif rules[key] == 'skipExtended':
            skipped.append(receipt['netPnlUsdc'])
            skip_delta_by_mint[p['mint']] -= receipt['netPnlUsdc']
        else:
            included.append(receipt['netPnlUsdc'])
            included_by_mint[p['mint']] += receipt['netPnlUsdc']
    paired = len(paired_standard)
    combined = dict(matched=paired, unmatched=len(rules)-paired)
    for label, values in [('standard', paired_standard), ('stopOnly', paired_stop),
                          ('filterOnly', paired_filtered), ('filterAndStop', paired_combined)]:
        combined[label+'Usdc'] = round(sum(values),6) if paired else None
    combined['stopDeltaOnKeptUsdc'] = round(sum(paired_combined)-sum(paired_filtered),6) if paired else None
    delta = sum(skip_delta_by_mint.values())
    best = max(skip_delta_by_mint.values(), default=0)
    sensitivity = dict(closedSkippedMints=len(skip_delta_by_mint),
                       netAdvantageUsdc=round(delta,6) if included or skipped else None,
                       largestPositiveMintDeltaUsdc=round(best,6) if best > 0 else None,
                       advantageWithoutTopPositiveMintUsdc=round(delta-best,6)
                       if best > 0 and len(set(included_by_mint) | set(skip_delta_by_mint)) > 1 else None)
    return dict(filterSensitivity=sensitivity, eligible=len(rules), skipped=sum(v=='skipExtended' for v in rules.values()),
                fallback=sum(v=='followBaselineNoFreshReference' for v in rules.values()),
                unresolvedBaseline=unresolved, closedBaseline=len(included)+len(skipped),
                baselineRealizedUsdc=round(sum(included)+sum(skipped),6),
                filteredRealizedUsdc=round(sum(included),6),
                avoidedLossUsdc=round(-sum(x for x in skipped if x < 0),6),
                missedProfitUsdc=round(sum(x for x in skipped if x > 0),6),
                withoutBestIncludedUsdc=round(sum(included)-max(included_by_mint.values()),6)
                if len(included_by_mint)>1 else None, matchedExitComparison=combined)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    directory = parser.parse_args().directory
    with (directory/'events.jsonl').open() as source:
        print(json.dumps(compare(list(map(json.loads, source)),
                                 json.loads((directory/'status.json').read_text())), indent=2))
