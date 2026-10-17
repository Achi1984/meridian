#!/usr/bin/env python3
"""Exact offline Feather input comparison; depends on the unchanged JSON diagnostic."""
import argparse
import importlib.metadata
import importlib.util
import json
import platform
from pathlib import Path
import struct
import subprocess
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('meridian_json_loader_check', HERE / 'verify-freqtrade-loader.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
require = base.require


def exact_frame(frame, rows):
    result = base.compare_frame(frame, rows)
    require(str(frame['date'].dtype) == 'datetime64[ms, UTC]', 'DATE_SCHEMA_CHANGED')
    require(all(str(frame[c].dtype) == 'float64' for c in base.COLUMNS[1:]), 'FLOAT64_SCHEMA_CHANGED')
    result['binary64MismatchCount'] = sum(
        struct.pack('>d', float(value)) != struct.pack('>d', float(rows[i][j]))
        for i, row in enumerate(frame[base.COLUMNS[1:]].itertuples(index=False, name=None))
        for j, value in enumerate(row, 1)
    )
    return result


def frame_from_rows(rows):
    from pandas import DataFrame, to_datetime
    frame = DataFrame({c: [row[i] for row in rows] for i, c in enumerate(base.COLUMNS)})
    for column in base.COLUMNS[1:]:
        frame[column] = frame[column].astype('float64')
    frame['date'] = to_datetime(frame['date'], unit='ms', utc=True).dt.as_unit('ms')
    require(exact_frame(frame, rows)['binary64MismatchCount'] == 0, 'INPUT_FRAME_CHANGED')
    return frame


def observe_loader(call, checkout):
    """Observe real function calls without replacing any upstream method."""
    import pyarrow.dataset
    dataset_code = pyarrow.dataset.dataset.__code__
    fallback_path = str(checkout / 'freqtrade/data/history/datahandlers/featherdatahandler.py')
    counts = {'arrowDatasetCalls': 0, 'featherFallbackCalls': 0}
    require(sys.getprofile() is None, 'EXISTING_PROFILER_UNSUPPORTED')

    def observe(frame, event, arg):
        if event == 'call':
            if frame.f_code is dataset_code:
                counts['arrowDatasetCalls'] += 1
            if frame.f_code.co_filename == fallback_path and frame.f_code.co_name == '_load_dataframe':
                counts['featherFallbackCalls'] += 1

    sys.setprofile(observe)
    try:
        result = call()
    finally:
        sys.setprofile(None)
    require(counts == {'arrowDatasetCalls': 1, 'featherFallbackCalls': 0}, 'UNEXPECTED_ARROW_PATH:' + json.dumps(counts))
    return result, counts


def verify_environment(checkout):
    require(sys.flags.isolated and sys.dont_write_bytecode, 'USE_PYTHON_I_B')
    require(platform.python_version() == '3.12.14', 'PYTHON_VERSION_MISMATCH')
    require(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'LOCK_PLATFORM_MISMATCH')
    require(subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip() == base.COMMIT, 'UPSTREAM_COMMIT_MISMATCH')
    require(not subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain', '--untracked-files=all'], text=True).strip(), 'UPSTREAM_WORKTREE_NOT_CLEAN')
    lock = HERE / 'freqtrade-loader-cp312-linux.lock'
    for line in lock.read_text().splitlines():
        if line and not line.startswith('#'):
            name, version = line.split(' --hash=')[0].split('==')
            require(importlib.metadata.version(name) == version, 'DEPENDENCY_VERSION_MISMATCH:' + name)
    return lock


def check_files(out, files):
    for entry in files:
        require(base.digest(out / entry['filename']) == entry['sha256'], 'FEATHER_HASH_MISMATCH')


def compare(checkout, data, out, lock):
    manifest, inputs = base.read_inputs(data)
    from freqtrade.data.history.datahandlers.featherdatahandler import FeatherDataHandler
    from freqtrade.enums import CandleType
    from pyarrow import Codec
    require(Codec.is_available('lz4'), 'LZ4_REQUIRED')
    # Never overwrite an existing output, including an incomplete prior attempt.
    out.mkdir(mode=0o700)
    handler = FeatherDataHandler(out)
    files = []
    results = {}
    for pair, rows in inputs.items():
        frame = frame_from_rows(rows)
        handler.ohlcv_store(pair, '1d', frame, CandleType.SPOT)
        filename = pair.replace('/', '_') + '-1d.feather'
        entry = {'pair': pair, 'filename': filename, 'sha256': base.digest(out / filename), 'rows': len(rows)}
        files.append(entry)
        raw, raw_path = observe_loader(lambda: handler._ohlcv_load(pair, '1d', None, CandleType.SPOT), checkout)
        public, public_path = observe_loader(lambda: handler.ohlcv_load(pair, '1d', CandleType.SPOT, timerange=None, fill_missing=False, drop_incomplete=False, startup_candles=0), checkout)
        require(public.equals(raw), 'PUBLIC_LOADER_REPAIRED_OR_CHANGED_DATA')
        results[pair] = {'raw': exact_frame(raw, rows), 'public': exact_frame(public, rows), 'rawPath': raw_path, 'publicPath': public_path, 'publicEqualsRaw': True}
    check_files(out, files)
    base.read_inputs(data)
    passed = all(v[s]['binary64MismatchCount'] == 0 for v in results.values() for s in ('raw', 'public'))
    report = {
        'schemaVersion': 'MERIDIAN_FREQTRADE_FEATHER_DIAGNOSTIC_V1',
        'status': 'EXACT_FEATHER_INPUT_PARITY_ONLY' if passed else 'EXACT_FEATHER_INPUT_PARITY_FAILED',
        'freqtradeCommit': base.COMMIT, 'python': platform.python_version(),
        'dependencyLockSha256': base.digest(lock), 'sourceManifestSha256': base.MANIFEST_SHA256,
        'jsonVerifierSha256': base.digest(HERE / 'verify-freqtrade-loader.py'),
        'featherVerifierSha256': base.digest(Path(__file__).resolve()),
        'arenaInputSha256': manifest['arenaInputSha256'], 'format': 'feather',
        'inputDecoder': 'CPYTHON_STDLIB_JSON', 'tolerance': 0, 'warmupBars': manifest['warmupBars'],
        'firstExecutionTime': manifest['firstExecutionTime'], 'files': files, 'results': results,
        'jsonLoaderResultSuperseded': False, 'strategyExecuted': False, 'performanceParityEstablished': False,
        'liveAuthorized': False, 'autoPromotion': False,
    }
    # A completion manifest is only written after every input/output/loader gate passes.
    if passed:
        with (out / 'manifest.json').open('x') as handle:
            handle.write(json.dumps(report, sort_keys=True, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True, type=Path)
    parser.add_argument('--data', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    checkout = args.checkout.resolve()
    lock = verify_environment(checkout)
    sys.addaudithook(base.deny_network)
    sys.path.insert(0, str(checkout))
    report = compare(checkout, args.data.resolve(), args.out.resolve(), lock)
    print(json.dumps(report, sort_keys=True, indent=2))
    return 0 if report['status'] == 'EXACT_FEATHER_INPUT_PARITY_ONLY' else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, RuntimeError, ImportError) as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        raise SystemExit(1)
