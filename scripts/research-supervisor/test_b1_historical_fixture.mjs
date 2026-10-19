import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJson, sha256} from '../research/b1-7/engine.mjs';
import {deriveHistoricalProfile, historicalProfileSha256} from
  '../research/b1-7/historical-profile.mjs';
import {ASSETS} from '../research/b1-7/validate.mjs';
import {createSyntheticSeries} from '../../test/fixtures/b1-7/synthetic-series.mjs';
import {createInsufficientEvidenceSeries} from './test_b1_generated_fixture.mjs';
import {runB1Adapter} from './b1_adapter.mjs';

function generatedSeries(scenario) {
  const series = scenario === 'INSUFFICIENT_EVIDENCE'
    ? createInsufficientEvidenceSeries()
    : createSyntheticSeries();
  if (scenario === 'COMPLETED_INSUFFICIENT_SCREEN') {
    for (const rows of Object.values(series)) {
      let prior = rows[589].close;
      for (let index = 590; index < rows.length; index++) {
        const row = rows[index];
        row.open = prior;
        row.close = prior * (index % 2 === 0 ? 1.025 : 1.015);
        row.high = row.close * 1.004;
        row.low = prior * 0.996;
        prior = row.close;
      }
    }
  }
  return series;
}

function makeProfile(scenario) {
  const series = generatedSeries(scenario);
  const manifest = {
    sourceCommit: '1c7b6dccd886f57e866c7d359c091b1e72a193ea',
    files: JSON.parse(readFileSync(new URL('./historical_run_profile.json', import.meta.url)))
      .expectedWholeFileSha256,
    selectedSeriesSha256: Object.fromEntries(ASSETS.map(asset =>
      [asset, sha256(canonicalJson(series[asset]))]))
  };
  const profile = JSON.parse(readFileSync(
    new URL('./historical_run_profile.json', import.meta.url), 'utf8'));
  const derived = deriveHistoricalProfile(manifest);
  const sourceIdentitySha256 = sha256(canonicalJson(profile.sourceSha256));
  Object.assign(profile, {
    status: 'FROZEN_FOR_D2',
    inputManifest: manifest,
    inputManifestSha256: derived.inputManifestSha256,
    inputSha256: derived.inputSha256
  });
  const identity = {
    ...profile,
    pathDescriptors: derived.pathDescriptors,
    pathIds: derived.pathIds,
    manifestSha256: derived.manifestSha256,
    computationOrder: derived.computationOrder,
    computationOrderSha256: derived.computationOrderSha256
  };
  const runProfileSha256 = historicalProfileSha256(identity);
  profile.approvalReceipt = {
    schema: 'MERIDIAN_TEST_GENERATED_FIXTURE_R1',
    decision: 'TEST_ONLY_GENERATED_FIXTURE',
    owner: 'TEST_ONLY',
    approvedAt: null,
    sourceCommit: profile.sourceCommit,
    sourceIdentitySha256,
    protocolSha256: profile.protocolSha256,
    implementationSha256: profile.implementationSha256,
    inputManifestSha256: profile.inputManifestSha256,
    runProfileSha256,
    manifestSha256: derived.manifestSha256,
    computationOrderSha256: derived.computationOrderSha256,
    trialKey: profile.trialKey,
    pathIds: derived.pathIds
  };
  return profile;
}

const args = process.argv.slice(2);
if (args[0] === '--profile') {
  const profilePath = args[1];
  const scenario = args[2] ?? 'SUCCESS';
  if (!path.isAbsolute(profilePath) ||
      !['SUCCESS', 'INSUFFICIENT_EVIDENCE',
        'COMPLETED_INSUFFICIENT_SCREEN'].includes(scenario)) {
    throw new Error('HISTORICAL_TEST_PROFILE_ARGUMENT_INVALID');
  }
  writeFileSync(profilePath, `${JSON.stringify(makeProfile(scenario))}\n`, {mode: 0o600});
} else if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const profilePath = process.env.B1_TEST_HISTORICAL_PROFILE_PATH;
  const scenario = process.env.B1_TEST_SCENARIO;
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  runB1Adapter(profile.profile, {
    profilePath,
    scenario,
    series: generatedSeries(scenario)
  }).catch(error => {
    process.stderr.write(`${error?.code ?? error?.message ?? 'HISTORICAL_TEST_ADAPTER_FAILED'}\n`);
    process.exitCode = 1;
  });
}
