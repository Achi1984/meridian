import {createHash} from 'node:crypto';
import {readFileSync, writeSync} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const {createExecution, canonicalJson, sha256} = await import(
  pathToFileURL(path.join(root, 'scripts/research/b1-7/engine.mjs')).href);
const {createSyntheticSeries} = await import(
  pathToFileURL(path.join(root, 'test/fixtures/b1-7/synthetic-series.mjs')).href);

const profile = JSON.parse(readFileSync('scripts/research-supervisor/b1_bridge_manifest.json'));
const mode = path.basename(process.argv[1]).replace(/^b1-/, '').replace(/-adapter\.mjs$/, '');
const fd = Number(process.env.B1_RESULT_FD);
const input = createInterface({input: process.stdin, crlfDelay: Infinity})[Symbol.asyncIterator]();

function frame(bytes) {
  const header = Buffer.from(`FRAME ${bytes.length}\n`);
  for (const part of [header, bytes]) {
    let offset = 0;
    while (offset < part.length) offset += writeSync(fd, part, offset, part.length - offset);
  }
}

function event(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function ack(name, index) {
  const item = await input.next();
  if (item.done) throw new Error('ACK_MISSING');
  const value = JSON.parse(item.value);
  if (value.event !== name || (index !== undefined && value.index !== index)) {
    throw new Error('ACK_INVALID');
  }
}

const waitForever = () => new Promise(() => {});

if (mode === 'prepare') await waitForever();
const series = createSyntheticSeries();
const sourceHashes = Object.fromEntries(Object.entries(profile.sourceSha256));
const sourceSha256 = sha256(canonicalJson(sourceHashes));
const fileSha = name => createHash('sha256').update(readFileSync(name)).digest('hex');
const implementationSha256 = sha256(canonicalJson({
  capturedInputSha256: fileSha(profile.sourceFiles.loader),
  engineSha256: fileSha(profile.sourceFiles.engine),
  validatorSha256: fileSha(profile.sourceFiles.validator)
}));
const session = createExecution({
  seriesByAsset: series, source: {kind: 'SYNTHETIC_FIXTURE'}, implementationSha256
});
event({
  type: 'ready', protocolSha256: profile.protocolSha256, sourceSha256,
  inputSha256: profile.inputSha256, implementationSha256,
  manifestSha256: profile.manifestSha256,
  computationOrderSha256: profile.computationOrderSha256
});
await ack('prepared');

if (mode === 'path') {
  const boundary = session.beforePathBoundary();
  event({type: 'path_started', index: 0, pathId: boundary.pathId});
  await ack('path_started_ack', 0);
  await waitForever();
}

if (mode === 'start-ack-loss') {
  const boundary = session.beforePathBoundary();
  writeSync(1, Buffer.from(`${JSON.stringify({
    type: 'path_started', index: 0, pathId: boundary.pathId
  })}\n`));
  process.stdin.destroy();
  process.exit(1);
}

if (mode === 'flood-control') {
  writeSync(1, Buffer.alloc(8193, 65));
  await waitForever();
}

if (["oversized-frame", "duplicate-result", "forged-digest", "truncated-frame",
  "extra-frame", "cumulative-cap"].includes(mode)) {
  const boundary = session.beforePathBoundary();
  event({type: 'path_started', index: 0, pathId: boundary.pathId});
  await ack('path_started_ack', 0);
  if (mode === 'oversized-frame') {
    writeSync(fd, Buffer.from('FRAME 1048577\n'));
    await waitForever();
  }
  if (mode === 'duplicate-result') {
    frame(Buffer.from('{"status":"COMPLETED","status":"COMPLETED"}'));
    await waitForever();
  }
  if (mode === 'truncated-frame') {
    writeSync(fd, Buffer.from('FRAME 100\n{"status":'));
    process.exit(1);
  }
  if (mode === 'extra-frame') {
    const bytes = Buffer.from('{}');
    writeSync(fd, Buffer.concat([
      Buffer.from(`FRAME ${bytes.length}\n`), bytes, Buffer.from('FRAME 1\nx')
    ]));
    await waitForever();
  }
  const outcome = session.advanceOne(boundary.pathId);
  const result = mode === 'forged-digest'
    ? {...outcome.completedPath, outputSha256: 'f'.repeat(64)}
    : outcome.completedPath;
  frame(Buffer.from(JSON.stringify(result)));
  await waitForever();
}

for (let index = 0; index < 44; index++) {
  const boundary = session.beforePathBoundary();
  if (boundary.ordinal === 20) {
    event({type: 'controls'});
    await ack('controls_ready');
    if (mode === 'calibration') await waitForever();
    frame(Buffer.from(JSON.stringify(session.controlDefinitions)));
    if (mode === 'controls-ack-loss') process.exit(1);
    await ack('controls_committed');
  }
  event({type: 'path_started', index, pathId: boundary.pathId});
  await ack('path_started_ack', index);
  const outcome = session.advanceOne(boundary.pathId);
  if (outcome.completedPath?.status !== 'COMPLETED') throw new Error('PATH_FAILED');
  frame(Buffer.from(JSON.stringify(outcome.completedPath)));
  if (mode === 'path-ack-loss' && index === 0) process.exit(1);
  await ack('path_committed', index);
}
event({type: 'final_summary'});
if (mode === 'finalization') await waitForever();
await ack('final_summary_ready');
const summary = {...session.finalResult()};
delete summary.paths;
delete summary.controlDefinitions;
frame(Buffer.from(JSON.stringify(summary)));
await ack('final_ack');
if (mode === 'postcommit') {
  writeSync(1, Buffer.from('{"type":"invalid_after_commit"}\n'));
  process.exit(1);
}
process.stdin.destroy();
