"""Attribute recorded forward quotes to later-available Binance archive labels."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from taker_flow_replay import HOUR, archive, classify


def attribute(state, load_archive=archive):
    cache = {}
    rows = []
    for event in state['observations']:
        if 'baselineNetUsdt' not in event or 'flow' in event:
            continue
        asset = event['instrument'].split('-')[0]
        hour = event['slot']-HOUR
        shares = {}
        sources = {}
        row = dict(instrument=event['instrument'],slot=event['slot'],
                   entryQuoteTs=event['entry']['ts'],baselineNetUsdt=event['baselineNetUsdt'])
        try:
            for offset in range(8):
                day = datetime.fromtimestamp(hour-offset*24*HOUR,timezone.utc).date()
                key = (asset,day)
                if key not in cache:
                    cache[key] = load_archive(key)
                _, values, name, digest = cache[key]
                shares.update(values)
                sources[name] = digest
            passed = classify(shares,dict(at=hour,side=event['side']))
            row.update(archivePassed=passed,archiveFilteredNetUsdt=event['baselineNetUsdt'] if passed else '0',
                       archiveSHA256=sources)
        except (OSError,ValueError,KeyError) as exc:
            row['archiveError']=str(exc)
        rows.append(row)
    return dict(method='retrospective labels on forward quotes',rows=rows)


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('state',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    args.output.write_text(json.dumps(attribute(json.loads(args.state.read_text())),indent=2)+'\n')
