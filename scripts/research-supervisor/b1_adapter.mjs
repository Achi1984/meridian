import {createHash} from 'node:crypto';
import {closeSync, readFileSync, writeSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {createExecution, canonicalJson, sha256} from '../research/b1-7/engine.mjs';
import {PROTOCOL_ID, PROTOCOL_SHA256} from '../research/b1-7/validate.mjs';
import {createSyntheticSeries} from '../../test/fixtures/b1-7/synthetic-series.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'b1_bridge_manifest.json');

async function* inputLines() {
  const input = createInterface({input: process.stdin, crlfDelay: Infinity});
  for await (const line of input) yield line;
}

const lines = inputLines();

async function receive(type, index) {
  const next = await lines.next();
  if (next.done) throw new Error('PARENT_ACK_MISSING');
  let value;
  try {
    value = JSON.parse(next.value);
  } catch {
    throw new Error('PARENT_ACK_INVALID');
  }
  const expected = index === undefined ? {event: type} : {event: type, index};
  if (Object.keys(value).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, item]) => value[key] !== item)) {
    throw new Error('PARENT_ACK_INVALID');
  }
}

function sourcePins(profile) {
  const observed = {};
  for (const [name, relative] of Object.entries(profile.sourceFiles)) {
    const bytes = readFileSync(path.join(ROOT, relative));
    observed[name] = createHash('sha256').update(bytes).digest('hex');
  }
  if (canonicalJson(observed) !== canonicalJson(profile.sourceSha256)) {
    throw new Error('B1_SOURCE_PIN_MISMATCH');
  }
  return sha256(canonicalJson(observed));
}

function fixtureIdentity(series) {
  const canonicalSeriesSha256 = {};
  for (const asset of Object.keys(series)) {
    canonicalSeriesSha256[asset] = sha256(canonicalJson(series[asset]));
  }
  const identity = {
    datasetKind: 'SYNTHETIC_FIXTURE',
    sourceCommit: 'SYNTHETIC_FIXTURE',
    sourceProvenance: {syntheticFixtureSeriesSha256: canonicalSeriesSha256},
    canonicalSeriesSha256
  };
  return sha256(canonicalJson(identity));
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function sendFrame(fd, bytes) {
  writeAll(fd, Buffer.from(`FRAME ${bytes.length}\n`));
  writeAll(fd, bytes);
}

async function execute() {
  const fd = Number(process.env.B1_RESULT_FD);
  if (!Number.isInteger(fd) || fd < 3) throw new Error('RESULT_CHANNEL_INVALID');
  const profile = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const sourceSha256 = sourcePins(profile);
  const series = createSyntheticSeries();
  const inputSha256 = fixtureIdentity(series);
  if (inputSha256 !== profile.inputSha256) throw new Error('B1_INPUT_PIN_MISMATCH');
  const fileSha = name => createHash('sha256').update(readFileSync(path.join(ROOT, name))).digest('hex');
  const implementationSha256 = sha256(canonicalJson({
    capturedInputSha256: fileSha(profile.sourceFiles.loader),
    engineSha256: fileSha(profile.sourceFiles.engine),
    validatorSha256: fileSha(profile.sourceFiles.validator)
  }));
  if (implementationSha256 !== profile.implementationSha256) {
    throw new Error('B1_IMPLEMENTATION_PIN_MISMATCH');
  }
  const session = createExecution({
    seriesByAsset: series,
    source: {kind: 'SYNTHETIC_FIXTURE'},
    implementationSha256
  });
  const manifestSha256 = sha256(canonicalJson(session.manifest));
  const computationOrderSha256 = sha256(canonicalJson(session.computationOrder));
  if (PROTOCOL_ID !== profile.protocolId || PROTOCOL_SHA256 !== profile.protocolSha256 ||
      session.status !== 'READY' || manifestSha256 !== profile.manifestSha256 ||
      computationOrderSha256 !== profile.computationOrderSha256 ||
      session.manifest.length !== 44 || session.computationOrder.length !== 44 ||
      session.manifest.some((item, index) => item.pathId !== profile.pathIds[index]) ||
      session.computationOrder.some((item, index) =>
        item.pathId !== profile.pathIds[profile.computationOrder[index]])) {
    throw new Error('B1_MANIFEST_PIN_MISMATCH');
  }
  process.stdout.write(`${JSON.stringify({
    type: 'ready', protocolSha256: PROTOCOL_SHA256, sourceSha256, inputSha256,
    implementationSha256, manifestSha256, computationOrderSha256
  })}\n`);
  await receive('prepared');

  let controlsRecorded = false;
  while (session.status === 'READY') {
    const boundary = session.beforePathBoundary();
    if (boundary.status !== 'READY') throw new Error('SESSION_BOUNDARY_INVALID');
    if (boundary.phase === 'DIAGNOSTIC' && !controlsRecorded) {
      const controls = session.controlDefinitions;
      if (!controls) throw new Error('CONTROLS_MISSING');
      process.stdout.write(`${JSON.stringify({type: 'controls'})}\n`);
      sendFrame(fd, Buffer.from(JSON.stringify(controls)));
      await receive('controls_committed');
      controlsRecorded = true;
    }
    process.stdout.write(`${JSON.stringify({
      type: 'path_started', index: boundary.ordinal - 1, pathId: boundary.pathId
    })}\n`);
    await receive('path_started_ack', boundary.ordinal - 1);
    const outcome = session.advanceOne(boundary.pathId);
    if (outcome.completedPath?.status === 'COMPLETED' &&
        outcome.completedPath.pathId === boundary.pathId) {
      sendFrame(fd, Buffer.from(JSON.stringify(outcome.completedPath)));
      await receive('path_committed', boundary.ordinal - 1);
    } else {
      break;
    }
    if (session.status !== 'READY') break;
  }
  const finalResult = session.finalResult();
  if (!finalResult || finalResult.status !== 'COMPLETED' || session.status !== 'COMPLETED') {
    if (!controlsRecorded && finalResult?.controlDefinitions) {
      process.stdout.write(`${JSON.stringify({type: 'controls'})}\n`);
      sendFrame(fd, Buffer.from(JSON.stringify(finalResult.controlDefinitions)));
      await receive('controls_committed');
      controlsRecorded = true;
    }
    process.stdout.write(`${JSON.stringify({
      type: 'execution_failed', status: finalResult?.status ?? 'INVALID',
      reason: finalResult?.failure?.code ?? 'EXECUTION_INCOMPLETE'
    })}\n`);
    const failureSummary = {...finalResult};
    delete failureSummary.paths;
    delete failureSummary.controlDefinitions;
    process.stdout.write(`${JSON.stringify({type: 'final_summary'})}\n`);
    sendFrame(fd, Buffer.from(JSON.stringify(failureSummary)));
    await receive('final_ack');
    closeSync(fd);
    process.stdin.destroy();
    return;
  }
  const summary = {...finalResult};
  delete summary.paths;
  delete summary.controlDefinitions;
  process.stdout.write(`${JSON.stringify({type: 'final_summary'})}\n`);
  sendFrame(fd, Buffer.from(JSON.stringify(summary)));
  await receive('final_ack');
  closeSync(fd);
  process.stdin.destroy();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  execute().catch(error => {
    process.stderr.write(`${error?.code ?? error?.message ?? 'B1_ADAPTER_FAILED'}\n`);
    process.exitCode = 1;
  });
}
