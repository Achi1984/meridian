import {createHash} from 'node:crypto';
import {closeSync, lstatSync, readFileSync, realpathSync, writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createInterface} from 'node:readline';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {createExecution, canonicalJson, sha256} from '../research/b1-7/engine.mjs';
import {PROTOCOL_ID, PROTOCOL_SHA256} from '../research/b1-7/validate.mjs';
import {loadCapturedInputs} from '../research/b1-7/captured-input.mjs';
import {HISTORICAL_RUN_PROFILE,
  deriveHistoricalProfile, historicalProfileSha256,
  verifyHistoricalSourcePins} from '../research/b1-7/historical-profile.mjs';
import {createSyntheticSeries} from '../../test/fixtures/b1-7/synthetic-series.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'b1_bridge_manifest.json');
const TEST_SCENARIO = process.env.NODE_ENV === 'test' ? process.env.B1_TEST_SCENARIO : null;

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

export async function runB1Adapter(runProfile = 'SYNTHETIC', testInput = null) {
  const fd = Number(process.env.B1_RESULT_FD);
  if (!Number.isInteger(fd) || fd < 3) throw new Error('RESULT_CHANNEL_INVALID');
  const historical = runProfile === HISTORICAL_RUN_PROFILE.profile;
  if (runProfile !== 'SYNTHETIC' && !historical) throw new Error('B1_RUN_PROFILE_INVALID');
  const historicalTest = historical && testInput !== null;
  if (historicalTest) {
    if (process.env.NODE_ENV !== 'test' ||
        !['SUCCESS', 'ENGINE_FAILURE', 'HISTORICAL_TIMEOUT',
          'INSUFFICIENT_EVIDENCE'].includes(TEST_SCENARIO) ||
        TEST_SCENARIO !== testInput.scenario ||
        typeof testInput.profilePath !== 'string' || !path.isAbsolute(testInput.profilePath)) {
      throw new Error('HISTORICAL_TEST_HOOK_REJECTED');
    }
    const originalPath = testInput.profilePath;
    const resolvedPath = realpathSync(originalPath);
    const temporaryRoot = realpathSync(tmpdir());
    const metadata = lstatSync(originalPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() ||
        (resolvedPath !== temporaryRoot && !resolvedPath.startsWith(`${temporaryRoot}${path.sep}`)) ||
        resolvedPath === ROOT || resolvedPath.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error('HISTORICAL_TEST_HOOK_REJECTED');
    }
  }
  if (TEST_SCENARIO && !['SUCCESS', 'ENGINE_FAILURE', 'HISTORICAL_TIMEOUT',
    'INSUFFICIENT_EVIDENCE'].includes(TEST_SCENARIO)) {
    throw new Error('B1_TEST_SCENARIO_INVALID');
  }
  let profilePath = MANIFEST_PATH;
  let profile = null;
  let series = null;
  let source = null;
  let historicalSourceIdentitySha256 = null;
  if (historicalTest) {
    profilePath = testInput.profilePath;
    profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    if (profile.profile !== HISTORICAL_RUN_PROFILE.profile ||
        profile.status !== 'FROZEN_FOR_D2' || !profile.inputManifest) {
      throw new Error('HISTORICAL_TEST_PROFILE_INVALID');
    }
    const derived = deriveHistoricalProfile(profile.inputManifest);
    profile = {
      ...profile,
      ...derived,
      status: 'FROZEN_FOR_D2',
      approvalReceipt: profile.approvalReceipt
    };
    const runProfileSha256 = historicalProfileSha256(profile);
    if (profile.approvalReceipt?.runProfileSha256 !== runProfileSha256) {
      throw new Error('HISTORICAL_TEST_PROFILE_INVALID');
    }
    profile.runProfileSha256 = runProfileSha256;
    series = testInput.series;
    source = {
      kind: 'FROZEN_RESEARCH_INPUT',
      commit: profile.inputManifest.sourceCommit,
      files: profile.inputManifest.files
    };
  } else if (historical) {
    const sourcePins = verifyHistoricalSourcePins(HISTORICAL_RUN_PROFILE);
    if (!sourcePins.ok) throw new Error(sourcePins.error.code);
    historicalSourceIdentitySha256 = sourcePins.sourceIdentitySha256;
    const loaded = await loadCapturedInputs();
    if (!loaded.ok) throw new Error(loaded.error?.code ?? 'HISTORICAL_ADMISSION_REQUIRED');
    profilePath = null;
    series = loaded.seriesByAsset;
    source = loaded.source;
  } else {
    series = createSyntheticSeries();
    source = {kind: 'SYNTHETIC_FIXTURE'};
  }
  if (TEST_SCENARIO === 'INSUFFICIENT_EVIDENCE' && !historicalTest) {
    profilePath = process.env.B1_TEST_MANIFEST_PATH;
    if (typeof profilePath !== 'string' || !path.isAbsolute(profilePath)) {
      throw new Error('B1_TEST_MANIFEST_PATH_INVALID');
    }
    const {createInsufficientEvidenceSeries} = await import('./test_b1_generated_fixture.mjs');
    series = createInsufficientEvidenceSeries();
  }
  profile ??= historical ? HISTORICAL_RUN_PROFILE : JSON.parse(readFileSync(profilePath, 'utf8'));
  const testSourcePins = historicalTest ? verifyHistoricalSourcePins(profile) : null;
  if (testSourcePins && !testSourcePins.ok) throw new Error(testSourcePins.error.code);
  const sourceSha256 = historicalTest
    ? testSourcePins.sourceIdentitySha256
    : historical ? historicalSourceIdentitySha256 : sourcePins(profile);
  const inputIdentity = historical ? {
    datasetKind: source.kind,
    sourceCommit: source.commit,
    sourceProvenance: {normalizedFileSha256: source.files},
    canonicalSeriesSha256: Object.fromEntries(Object.entries(series).map(([asset, rows]) =>
      [asset, sha256(canonicalJson(rows))]))
  } : null;
  const inputSha256 = historical
    ? sha256(canonicalJson(inputIdentity))
    : fixtureIdentity(series);
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
  const executionOptions = {
    seriesByAsset: series,
    source,
    implementationSha256
  };
  if (TEST_SCENARIO === 'ENGINE_FAILURE') {
    executionOptions.syntheticClock = ({phase}) => phase === 'path-start-check' ? 1_800_001 : 0;
  }
  const session = createExecution(executionOptions);
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
      await receive('controls_ready');
      sendFrame(fd, Buffer.from(JSON.stringify(controls)));
      await receive('controls_committed');
      controlsRecorded = true;
    }
    process.stdout.write(`${JSON.stringify({
      type: 'path_started', index: boundary.ordinal - 1, pathId: boundary.pathId
    })}\n`);
    await receive('path_started_ack', boundary.ordinal - 1);
    if (TEST_SCENARIO === 'HISTORICAL_TIMEOUT' && historicalTest) {
      await new Promise(resolve => setTimeout(resolve, 30_000));
    }
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
    if (!controlsRecorded && finalResult?.status === 'INSUFFICIENT_EVIDENCE' &&
        finalResult.controlDefinitions?.status === 'INSUFFICIENT_EVIDENCE') {
      process.stdout.write(`${JSON.stringify({type: 'controls'})}\n`);
      await receive('controls_ready');
      sendFrame(fd, Buffer.from(JSON.stringify(finalResult.controlDefinitions)));
      await receive('controls_committed');
      controlsRecorded = true;
    }
    const reason = finalResult?.failure?.code ??
      (finalResult?.status === 'INSUFFICIENT_EVIDENCE'
        ? finalResult.controlDefinitions?.reason ?? 'INSUFFICIENT_EVIDENCE'
        : 'EXECUTION_INCOMPLETE');
    process.stdout.write(`${JSON.stringify({
      type: 'execution_failed', status: finalResult?.status ?? 'INVALID',
      reason
    })}\n`);
    const failureSummary = {...finalResult};
    if (historical && failureSummary.evidence) {
      failureSummary.evidence = {
        ...failureSummary.evidence,
        sourceAuthenticity: 'NOT_ESTABLISHED'
      };
    }
    delete failureSummary.paths;
    delete failureSummary.controlDefinitions;
    process.stdout.write(`${JSON.stringify({type: 'final_summary'})}\n`);
    await receive('final_summary_ready');
    sendFrame(fd, Buffer.from(JSON.stringify(failureSummary)));
    await receive('final_ack');
    closeSync(fd);
    process.stdin.destroy();
    return;
  }
  const summary = {...finalResult};
  if (historical) {
    summary.evidence = {...summary.evidence, sourceAuthenticity: 'NOT_ESTABLISHED'};
  }
  delete summary.paths;
  delete summary.controlDefinitions;
  process.stdout.write(`${JSON.stringify({type: 'final_summary'})}\n`);
  await receive('final_summary_ready');
  sendFrame(fd, Buffer.from(JSON.stringify(summary)));
  await receive('final_ack');
  closeSync(fd);
  process.stdin.destroy();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runB1Adapter(process.env.B1_RUN_PROFILE ?? 'SYNTHETIC').catch(error => {
    process.stderr.write(`${error?.code ?? error?.message ?? 'B1_ADAPTER_FAILED'}\n`);
    process.exitCode = 1;
  });
}
