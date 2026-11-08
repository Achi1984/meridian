import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
const workflow = fs.readFileSync(new URL('.github/workflows/backend-safety.yml', root), 'utf8');
const step = workflow.split('      - name: Research and auth regression tests\n')[1].split('      - name: ')[0];
const script = step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');

test('Release Safety partitions every discovered test exactly once and preserves failures', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-test-partition-'));
  try {
    const log = path.join(temporary, 'calls.jsonl');
    const stub = path.join(temporary, 'node');
    fs.writeFileSync(stub, '#!' + process.execPath + '\n' +
      'const fs=require("node:fs"); fs.appendFileSync(process.env.PARTITION_LOG, JSON.stringify(process.argv.slice(2))+"\\n"); process.exit(Number(process.env.PARTITION_EXIT||0));\n', {mode: 0o755});
    const env = {...process.env, PATH: temporary + path.delimiter + process.env.PATH, PARTITION_LOG: log};
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {cwd: root, env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ['--test', 'test/research-supervisor.test.js']);
    const files = calls.flatMap(args => { assert.equal(args[0], '--test'); return args.slice(1); });
    const expected = fs.readdirSync(new URL('test/', root)).filter(name => name.endsWith('.test.js')).map(name => 'test/' + name);
    assert.equal(new Set(files).size, files.length, 'no test executes twice');
    assert.deepEqual(files.sort(), expected.sort(), 'no discovered test is omitted');
    fs.writeFileSync(log, '');
    const failed = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {cwd: root, env: {...env, PARTITION_EXIT: '23'}, encoding: 'utf8'});
    assert.equal(failed.status, 23, 'first invocation failure remains a hard gate');
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
