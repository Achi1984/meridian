"""Attribute waiting for buyer recovery versus immediate entry on the same selected mints."""
import argparse
import json
from collections import Counter
from pathlib import Path

from meme_paper_account import UNIT
from newcomer_cost_switch import evaluate
from wave_band_report import report


def attribute(streams):
    report(streams)
    seen = set()
    groups = Counter()
    observed = Counter()
    closed = Counter()
    deltas = []
    avoided = missed = repeats = gaps = unresolved = 0
    items = sorted((item for rows in streams for item in evaluate(rows)),
                   key=lambda item: item['cohortAt'])
    for item in items:
        if item['mint'] in seen:
            repeats += 1
            continue
        seen.add(item['mint'])
        paths = item['paths']
        gaps += any(path['state'] == 'noEntryWithGap' for path in paths.values())
        for arm, path in paths.items():
            if path['state'] == 'closed':
                observed[arm] += round(path['netUsdc'] * UNIT)
                closed[arm] += 1
        if any(path['state'] == 'unresolved' for path in paths.values()):
            unresolved += 1
            continue
        early, wave = (paths[arm] for arm in ('early', 'wave'))
        entered = tuple(arm for arm in ('early', 'wave') if paths[arm]['state'] == 'closed')
        label = '+'.join(entered) or 'cash'
        groups[label] += 1
        # No recorded entry leaves actual paper cash untouched, even on a data gap.
        diff = round((wave['netUsdc'] or 0) * UNIT) - round((early['netUsdc'] or 0) * UNIT)
        deltas.append(diff)
        if entered == ('early',):
            avoided += max(0, diff)
            missed += max(0, -diff)
    return dict(uniqueMints=len(seen), repeats=repeats, noEntryGapMints=gaps,
                unresolvedMints=unresolved, decisionCounts=dict(groups),
                closedTrades={arm: closed[arm] for arm in ('early', 'wave')},
                realizedUsdc={arm: observed[arm]/UNIT for arm in ('early', 'wave')},
                avoidedLossUsdc=avoided/UNIT, missedProfitUsdc=missed/UNIT,
                pricedDeltaUsdc=sum(deltas)/UNIT if deltas else None,
                pricedDeltaWithoutBestMintUsdc=(sum(deltas)-max(deltas))/UNIT
                if len(deltas)>1 else None)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('logs', type=Path, nargs='+')
    streams = [[json.loads(line) for line in p.read_text().splitlines()] for p in parser.parse_args().logs]
    print(json.dumps(attribute(streams), indent=2))
