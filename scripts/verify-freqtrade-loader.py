#!/usr/bin/env python3
"""Offline diagnostic of an external, unmodified Freqtrade JSON loader; no strategy."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
from pathlib import Path
import subprocess
import sys

COMMIT = '1f394eaebc2f46a83d26971388628707802f8602'
MANIFEST_SHA256 = '5aa35d41d585c5b866b6d46ec1f5868e840dd3dfaa5e227ddbdb6537b172bc66'
PAIRS = ['AVAX/USD', 'BTC/USD', 'ETH/USD', 'HBAR/USD', 'LINK/USD', 'SOL/USD', 'SUI/USD', 'XRP/USD']
COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume']
DAY = 86400000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_inputs(datadir):
    manifest_path = datadir / 'manifest.json'
    require(digest(manifest_path) == MANIFEST_SHA256, 'MANIFEST_HASH_MISMATCH')
    manifest = json.loads(manifest_path.read_bytes())
    require([f['pair'] for f in manifest['files']] == PAIRS, 'UNIVERSE_MISMATCH')
    inputs = {}
    for entry in manifest['files']:
        path = datadir / entry['filename']
        require(digest(path) == entry['sha256'], 'FILE_HASH_MISMATCH')
        rows = json.loads(path.read_bytes())
        require(len(rows) == entry['rows'] == 400, 'ROW_COUNT_MISMATCH')
        for i, row in enumerate(rows):
            require(len(row) == 6 and all(type(v) in (int, float) and math.isfinite(v) for v in row), 'INVALID_VALUES')
            require(row[0] == manifest['firstOpenTime'] + i * DAY, 'CALENDAR_MISMATCH')
        require(rows[200][0] == manifest['firstExecutionTime'], 'WARMUP_MISMATCH')
        require(rows[-1][0] + DAY - 1 == manifest['lastCloseTime'], 'ENDPOINT_MISMATCH')
        inputs[entry['pair']] = rows
    return manifest, inputs


def compare_frame(frame, rows):
    """Exact binary float equality is the predeclared gate; never widen on failure."""
    require(list(frame.columns) == COLUMNS, 'COLUMNS_CHANGED')
    require(len(frame) == len(rows), 'LOADER_ROW_COUNT_CHANGED')
    require(str(frame['date'].dt.tz) == 'UTC', 'LOADER_TIMEZONE_CHANGED')
    dates = frame['date'].dt.as_unit('ns').astype('int64').tolist()
    require(dates == [r[0] * 1000000 for r in rows], 'LOADER_TIMESTAMPS_CHANGED')
    differences = []
    count = 0
    maximum = 0.0
    for i, actual in enumerate(frame[COLUMNS[1:]].itertuples(index=False, name=None)):
        for j, value in enumerate(actual, 1):
            expected = rows[i][j]
            require(math.isfinite(value), 'LOADER_NONFINITE_VALUE')
            if value != expected:
                count += 1
                maximum = max(maximum, abs(value - expected))
                if len(differences) < 4:
                    differences.append({'row': i, 'column': COLUMNS[j], 'expected': expected, 'actual': value})
    return {'rows': len(rows), 'numericMismatchCount': count, 'maxAbsoluteDifference': maximum, 'examples': differences}


def deny_network(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'socket.sendto', 'subprocess.Popen'):
        raise RuntimeError('OFFLINE_OPERATION_REQUIRED:' + event)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True, type=Path)
    parser.add_argument('--data', required=True, type=Path)
    args = parser.parse_args()
    checkout = args.checkout.resolve()
    require(sys.flags.isolated and sys.dont_write_bytecode, 'USE_PYTHON_I_B')
    require(platform.python_version() == '3.12.14', 'PYTHON_VERSION_MISMATCH')
    require(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'LOCK_PLATFORM_MISMATCH')
    require(subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip() == COMMIT, 'UPSTREAM_COMMIT_MISMATCH')
    require(not subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain', '--untracked-files=all'], text=True).strip(), 'UPSTREAM_WORKTREE_NOT_CLEAN')
    lock = Path(__file__).with_name('freqtrade-loader-cp312-linux.lock')
    for line in lock.read_text().splitlines():
        if line and not line.startswith('#'):
            name, version = line.split(' --hash=')[0].split('==')
            require(importlib.metadata.version(name) == version, 'DEPENDENCY_VERSION_MISMATCH:' + name)
    manifest, inputs = read_inputs(args.data.resolve())
    # Operational guard against accidental networking, not a sandbox for hostile code.
    sys.addaudithook(deny_network)
    sys.path.insert(0, str(checkout))
    from freqtrade.data.history.datahandlers.jsondatahandler import JsonDataHandler
    from freqtrade.enums import CandleType
    from pandas import read_json
    handler = JsonDataHandler(args.data.resolve())
    results = {}
    for pair, rows in inputs.items():
        raw = handler._ohlcv_load(pair, '1d', timerange=None, candle_type=CandleType.SPOT)
        public = handler.ohlcv_load(pair, '1d', CandleType.SPOT, timerange=None, fill_missing=False, drop_incomplete=False, startup_candles=0)
        require(public.equals(raw), 'PUBLIC_LOADER_REPAIRED_OR_CHANGED_DATA')
        result = {'raw': compare_frame(raw, rows), 'public': compare_frame(public, rows), 'publicEqualsRaw': True}
        path = args.data.resolve() / (pair.replace('/', '_') + '-1d.json')
        tokens = json.loads(path.read_text(), parse_float=str, parse_int=str)
        for stage in ('raw', 'public'):
            for example in result[stage]['examples']:
                column = COLUMNS.index(example['column'])
                example['sourceJsonToken'] = tokens[example['row']][column]
                example['expectedBinary64'] = float(example['expected']).hex()
                example['actualBinary64'] = float(example['actual']).hex()
        # Diagnostic only: no monkeypatch, no replacement of actual loader output.
        probe = read_json(path, orient='values', precise_float=True).values.tolist()
        require(len(probe) == len(rows) and all(p[0] == r[0] for p, r in zip(probe, rows)), 'PROBE_CALENDAR_MISMATCH')
        result['separatePreciseFloatProbeMismatches'] = sum(p[j] != r[j] for p, r in zip(probe, rows) for j in range(1, 6))
        results[pair] = result
    # Inputs are not expected to change while being consumed; check again after loading.
    read_inputs(args.data.resolve())
    passed = all(v[stage]['numericMismatchCount'] == 0 for v in results.values() for stage in ('raw', 'public'))
    report = {'schemaVersion': 'MERIDIAN_FREQTRADE_LOADER_DIAGNOSTIC_V1', 'status': 'LOADER_INPUT_PARITY_ONLY' if passed else 'LOADER_NUMERIC_PARITY_FAILED', 'freqtradeCommit': COMMIT, 'python': platform.python_version(), 'dependencyLockSha256': digest(lock), 'manifestSha256': MANIFEST_SHA256, 'arenaInputSha256': manifest['arenaInputSha256'], 'tolerance': 0, 'results': results, 'strategyExecuted': False, 'performanceParityEstablished': False, 'liveAuthorized': False, 'autoPromotion': False}
    print(json.dumps(report, sort_keys=True, indent=2))
    return 0 if passed else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, RuntimeError, ImportError) as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        raise SystemExit(1)
