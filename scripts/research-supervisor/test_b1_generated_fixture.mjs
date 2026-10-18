import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  createExecution, canonicalJson, sha256
} from '../research/b1-7/engine.mjs';
import {ASSETS} from '../research/b1-7/validate.mjs';
import {createSyntheticSeries} from '../../test/fixtures/b1-7/synthetic-series.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'b1_bridge_manifest.json');
const CORRECTION_GROUPS = [
  [1.0000000000600173, [0]],
  [1.0000000000582074, [3, 17, 24, 31, 38, 52, 59, 66, 73, 87, 94, 101, 108, 122, 129, 136, 143, 157, 164, 171, 178]],
  [1.000000000057922, [10, 45, 80, 115, 150]],
  [0.9999999999997142, [5, 15, 30, 40, 50, 65, 75, 85, 100, 110, 120, 135, 145, 155, 170]],
  [0.9999999999997145, [20, 25, 35, 55, 60, 70, 90, 95, 105, 125, 130, 140, 160, 165, 175]]
];

function fixtureIdentity(series) {
  const canonicalSeriesSha256 = {};
  for (const asset of Object.keys(series)) {
    canonicalSeriesSha256[asset] = sha256(canonicalJson(series[asset]));
  }
  return sha256(canonicalJson({
    datasetKind: 'SYNTHETIC_FIXTURE',
    sourceCommit: 'SYNTHETIC_FIXTURE',
    sourceProvenance: {syntheticFixtureSeriesSha256: canonicalSeriesSha256},
    canonicalSeriesSha256
  }));
}

export function createInsufficientEvidenceSeries() {
  const series = createSyntheticSeries();
  for (const asset of ASSETS) {
    let close = 100;
    for (let index = 0; index < series[asset].length; index++) {
      const row = series[asset][index];
      const dailyReturn = asset === ASSETS[0] && index > 0 && index % 5 === 0 ? 2e-12 : 0;
      let nextClose = close * (1 + dailyReturn);
      if (index === 589) nextClose = close / (1 - 0.0015);
      row.open = index === 410 ? close / (1 + 0.0015) : close;
      row.close = nextClose;
      row.high = Math.max(row.open, nextClose) * 1.004;
      row.low = Math.min(row.open, nextClose) * 0.996;
      close = nextClose;
    }
  }
  for (const [factor, offsets] of CORRECTION_GROUPS) {
    for (const offset of offsets) {
      for (const asset of ASSETS) {
        const rows = series[asset];
        const index = 410 + offset;
        rows[index].close *= factor;
        rows[index].high = Math.max(rows[index].open, rows[index].close) * 1.004;
        rows[index].low = Math.min(rows[index].open, rows[index].close) * 0.996;
        for (let next = index + 1; next < rows.length; next++) {
          for (const key of ['open', 'high', 'low', 'close']) rows[next][key] *= factor;
        }
      }
    }
  }
  return series;
}

export function createInsufficientEvidenceProfile() {
  const profile = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const sourceSha256 = Object.fromEntries(Object.entries(profile.sourceFiles).map(([name, relative]) =>
    [name, createHash('sha256').update(readFileSync(path.join(ROOT, relative))).digest('hex')]));
  const implementationSha256 = sha256(canonicalJson({
    capturedInputSha256: sourceSha256.loader,
    engineSha256: sourceSha256.engine,
    validatorSha256: sourceSha256.validator
  }));
  const series = createInsufficientEvidenceSeries();
  const session = createExecution({
    seriesByAsset: series,
    source: {kind: 'SYNTHETIC_FIXTURE'},
    implementationSha256
  });
  profile.sourceSha256 = sourceSha256;
  profile.implementationSha256 = implementationSha256;
  profile.inputSha256 = fixtureIdentity(series);
  profile.pathIds = session.manifest.map(item => item.pathId);
  profile.manifestSha256 = sha256(canonicalJson(session.manifest));
  profile.computationOrderSha256 = sha256(canonicalJson(session.computationOrder));
  return profile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href &&
    process.argv[2] === '--profile') {
  process.stdout.write(`${JSON.stringify(createInsufficientEvidenceProfile())}\n`);
}
