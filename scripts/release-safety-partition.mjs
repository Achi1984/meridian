#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const testDir = path.join(root, 'test');
const shardArg = process.argv.indexOf('--shard');
const shard = shardArg >= 0 ? process.argv[shardArg + 1] : null;
const valid = new Set(['browser', 'core-auth', 'supervisor']);

if (!valid.has(shard)) {
  console.error('usage: release-safety-partition.mjs --shard browser|core-auth|supervisor');
  process.exit(2);
}

const controlTests = new Set([
  'release-safety-sharding.test.js',
  'release-safety-test-partition.test.js'
]);
const files = fs.readdirSync(testDir)
  .filter(name => name.endsWith('.test.js') && !controlTests.has(name))
  .sort();
const classify = name => {
  if (name === 'research-supervisor.test.js') return 'supervisor';
  const source = fs.readFileSync(path.join(testDir, name), 'utf8');
  if (name.includes('chrome') || name === 'v11-terminal-entry.test.js' || /withMobileChrome|browserRun\(/.test(source)) {
    return 'browser';
  }
  return 'core-auth';
};
const assignments = files.map(name => ({name: `test/${name}`, shard: classify(name)}));
const selected = assignments.filter(item => item.shard === shard).map(item => item.name);
const union = assignments.map(item => item.name);
if (new Set(union).size !== union.length || union.length !== files.length || assignments.some(item => !valid.has(item.shard))) {
  console.error('invalid release safety partition');
  process.exit(1);
}
process.stdout.write(selected.join('\n') + (selected.length ? '\n' : ''));
