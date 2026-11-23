"""Attribute realized exits in one V2 campaign artifact to paired entries."""
import argparse
import json
from pathlib import Path

from newcomer_eight_hour import Account, UNIT


def audit(events, status):
    accounts = {key: Account(policy) for key, policy in
                [('A', 'trailing'), ('B', 'standard'), ('C', 'fixed')]}
    entries = {}
    start = next(events, None)
    if not start or start['event'] != 'start' or start['at'] != status['startedAt']:
        raise ValueError('Journal start differs from the report')
    last = start
    for row in events:
        last = row
        session = row['session']
        if row['event'] in ('sessionInterrupted', 'sessionEnd'):
            for account in accounts.values():
                for (origin, _), pos in account.open.items():
                    if origin == session:
                        pos.update(bid=None, markAt=None)
        if row.get('arm') != 'wave':
            continue
        mint = row.get('mint')
        key = (session, mint)
        if row['event'] == 'entry':
            if key in entries:
                raise ValueError('Repeated recovery entry in one session')
            entries[key] = {}
        for name, account in accounts.items():
            closed, net = account.closed, account.by_mint[mint]
            account.update(row, session)
            if account.closed > closed:
                entries[key][name] = account.by_mint[mint] - net
    if (last['at'], last['event'], last['session']) != (status['updatedAt'], status['lastEvent'], status['session']):
        raise ValueError('Report and journal end at different events')
    for name, account in accounts.items():
        if account.snapshot() != status['accounts'][name]:
            raise ValueError(f'Account {name} disagrees with the journal')
    result = {}
    for name in ('A', 'C'):
        matched = [out[name] - out['B'] for out in entries.values() if name in out and 'B' in out]
        result[name] = dict(matched=len(matched), excluded=len(entries)-len(matched),
                            better=sum(d > 0 for d in matched), same=matched.count(0),
                            worse=sum(d < 0 for d in matched),
                            deltaUsdc=sum(matched)/UNIT if matched else None)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    directory = parser.parse_args().directory
    with (directory/'events.jsonl').open() as source:
        print(json.dumps(audit(map(json.loads, source), json.loads((directory/'status.json').read_text())), indent=2))
