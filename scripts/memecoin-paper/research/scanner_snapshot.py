"""Export one completed read-only scanner observation for the dashboard."""
import json
from pathlib import Path

from newcomer_scanner import scan


def snapshot(collect=scan):
    candidates = []
    summary = {}
    warnings = []
    def record(kind, **fields):
        if kind == 'scannerCandidate':
            row = fields.pop('row')
            candidates.append(dict(mint=row['mint'], symbol=row.get('symbol'),
                                   **{key: fields.get(key) for key in
                                      ('asOf','windows','ranks','reasons','netResaleUsdc','earliest30mAt')}))
        elif kind == 'scannerSourceUnavailable':
            warnings.append(fields['source'])
        elif kind == 'scannerSummary':
            summary.update(fields)
    collect(record)
    if (summary.get('sampled') != len(candidates) or not summary.get('asOf')
            or any(r['asOf'] != summary['asOf'] for r in candidates)):
        raise ValueError('Incomplete scanner observation')
    return dict(schema=1, **summary, warnings=warnings, candidates=candidates)


if __name__ == '__main__':
    Path('scanner-live.json').write_text(json.dumps(snapshot(), allow_nan=False)+'\n')
