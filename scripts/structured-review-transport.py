"""Strict received-string transport; not proof of original model output or provenance.

Import is inert. Runtime executable resolution uses the trusted launcher PATH,
never JSON fields. The caller owns PATH, this script and its sibling validator.
"""
import json
import math
import os
import pathlib
import shutil
import subprocess
import sys

MAX_JSON_BYTES = 16384
MAX_FRAME_BYTES = 131072
NODE_SCRIPT = """import fs from 'node:fs';
import {validateStructuredReviewClaim} from './codex-bridge-v3-review-coordinator.mjs';
try {
  const {claim,expected}=JSON.parse(fs.readFileSync(0,'utf8'));
  const result=validateStructuredReviewClaim(claim,expected);
  const output=JSON.stringify(result);
  if(Buffer.byteLength(output,'utf8')>2048) throw Error('bounded');
  process.stdout.write(output);
} catch { process.exitCode=1; }
"""


class TransportError(ValueError):
    pass


def reject(code):
    raise TransportError(code)


def strict_object(raw, bound=MAX_JSON_BYTES, depth_limit=2):
    if type(raw) is not str or len(raw) > bound:
        reject('INVALID_INPUT_BOUND')
    try:
        if len(raw.encode('utf-8')) > bound:
            reject('INVALID_INPUT_BOUND')
    except UnicodeError:
        reject('INVALID_UTF8')
    depth = 0
    quoted = escaped = False
    for char in raw:
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in '[]':
            reject('ARRAY_NOT_ALLOWED')
        elif char == '{':
            depth += 1
            if depth > depth_limit:
                reject('DEPTH_LIMIT')
        elif char == '}':
            depth -= 1
            if depth < 0:
                reject('INVALID_JSON')
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                reject('DUPLICATE_KEY')
            value[key] = item
        return value
    try:
        value = json.loads(raw, object_pairs_hook=pairs,
                           parse_constant=lambda _: reject('NONFINITE_NUMBER'))
    except TransportError:
        raise
    except (ValueError, TypeError, RecursionError):
        reject('INVALID_JSON')
    if type(value) is not dict:
        reject('OBJECT_REQUIRED')
    def finite(item):
        if type(item) is float and not math.isfinite(item):
            reject('NONFINITE_NUMBER')
        if type(item) is dict:
            for child in item.values():
                finite(child)
    finite(value)
    return value


def validate_received(claim_raw, expected_raw):
    claim = strict_object(claim_raw)
    expected = strict_object(expected_raw)
    # This resolver trusts launcher configuration, never the received JSON.
    node = shutil.which('node')
    if node is None:
        reject('VALIDATOR_UNAVAILABLE')
    node = str(pathlib.Path(node).resolve())
    payload = json.dumps({'claim':claim, 'expected':expected}, separators=(',', ':'), allow_nan=False)
    try:
        result = subprocess.run([node, '--input-type=module', '-e', NODE_SCRIPT],
            input=payload, text=True, encoding='utf-8', capture_output=True, timeout=5,
            cwd=pathlib.Path(__file__).resolve().parent, shell=False,
            env={'PATH':'/usr/bin:/bin', 'LANG':'C', 'LC_ALL':'C'})
    except (OSError, subprocess.SubprocessError, UnicodeError):
        reject('VALIDATOR_FAILED')
    if result.returncode != 0:
        reject('CLAIM_REJECTED')
    if len(result.stdout.encode('utf-8')) > 2048:
        reject('INVALID_VALIDATOR_RESULT')
    try:
        output = strict_object(result.stdout, bound=2048, depth_limit=1)
        keys = {'status','reason','mayRequest','mayMerge','mayActivate','authenticated',
                'provenanceVerified','authorized','schemaVersion','verdict'}
        if set(output) != keys or any(output[name] is not False for name in
                ('mayRequest','mayMerge','mayActivate','authenticated','provenanceVerified','authorized')):
            reject('INVALID_VALIDATOR_RESULT')
    except TransportError:
        reject('INVALID_VALIDATOR_RESULT')
    return output


def main():
    try:
        if len(sys.argv) != 1:
            reject('ARGUMENTS_NOT_ALLOWED')
        raw = sys.stdin.buffer.read(MAX_FRAME_BYTES + 1)
        if len(raw) > MAX_FRAME_BYTES:
            reject('INVALID_INPUT_BOUND')
        frame = strict_object(raw.decode('utf-8'), bound=MAX_FRAME_BYTES, depth_limit=1)
        if set(frame) != {'claim','expected'}:
            reject('INVALID_FRAME')
        output = validate_received(frame['claim'], frame['expected'])
        print(json.dumps(output, separators=(',', ':'), allow_nan=False), flush=True)
        return 0
    except TransportError as error:
        print(str(error), file=sys.stderr)
        return 1
    except BaseException:
        print('TRANSPORT_FAILED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
