import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson, sha256} from './engine.mjs';
import {ASSETS, INPUT} from './validate.mjs';

const profilePath = new URL('../../research-supervisor/historical_run_profile.json', import.meta.url);
const bridgePath = new URL('../../research-supervisor/b1_bridge_manifest.json', import.meta.url);
const profileData = JSON.parse(readFileSync(profilePath, 'utf8'));
const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DESCRIPTORS = bridge.pathDescriptors;
const ORDER = bridge.computationOrder;

if (profileData.protocolId !== bridge.protocolId ||
    profileData.protocolSha256 !== bridge.protocolSha256 ||
    canonicalJson(profileData.expectedWholeFileSha256) !== canonicalJson(INPUT.normalizedHashes) ||
    canonicalJson(profileData.assets) !== canonicalJson(ASSETS) ||
    DESCRIPTORS.length !== 44 || ORDER.length !== 44) {
  throw new Error('HISTORICAL_PROFILE_SOURCE_MISMATCH');
}

function deriveIdentities(profile, manifest) {
  if (manifest === null) {
    return {
      inputManifestSha256: null,
      inputSha256: null,
      pathIds: null,
      manifestSha256: null,
      computationOrderSha256: null
    };
  }
  if (manifest.sourceCommit !== profile.sourceCommit ||
      canonicalJson(manifest.files) !== canonicalJson(profile.expectedWholeFileSha256) ||
      Object.keys(manifest.selectedSeriesSha256 ?? {}).length !== ASSETS.length ||
      ASSETS.some(asset => !/^[a-f0-9]{64}$/.test(manifest.selectedSeriesSha256[asset] ?? ''))) {
    throw new Error('HISTORICAL_INPUT_MANIFEST_INVALID');
  }
  const inputIdentity = {
    datasetKind: 'FROZEN_RESEARCH_INPUT',
    sourceCommit: manifest.sourceCommit,
    sourceProvenance: {normalizedFileSha256: manifest.files},
    canonicalSeriesSha256: manifest.selectedSeriesSha256
  };
  const inputSha256 = sha256(canonicalJson(inputIdentity));
  const pathIds = DESCRIPTORS.map(([kind, variantId, scenarioId, segmentId]) => sha256(canonicalJson({
    protocolId: profile.protocolId,
    protocolSha256: profile.protocolSha256,
    implementationId: profile.implementationId,
    implementationSha256: profile.implementationSha256,
    inputSha256,
    canonicalSeriesSha256: manifest.selectedSeriesSha256,
    variantId,
    scenarioId,
    segmentId
  })));
  const paths = DESCRIPTORS.map(([kind, variantId, scenarioId, segmentId], index) => ({
    kind, variantId, scenarioId, segmentId, pathId: pathIds[index]
  }));
  const computation = ORDER.map((index, ordinal) => ({ordinal: ordinal + 1, ...paths[index]}));
  return {
    inputManifestSha256: sha256(canonicalJson(manifest)),
    inputSha256,
    pathIds,
    manifestSha256: sha256(canonicalJson(paths)),
    computationOrderSha256: sha256(canonicalJson(computation))
  };
}

export function deriveHistoricalProfile(manifest = profileData.inputManifest) {
  const {approvalReceipt, ...base} = profileData;
  const identities = deriveIdentities(base, manifest);
  const identity = {
    ...base,
    inputManifest: manifest,
    ...identities,
    pathDescriptors: DESCRIPTORS,
    computationOrder: ORDER
  };
  const sourceIdentitySha256 = sha256(canonicalJson(base.sourceSha256));
  return deepFreeze({
    ...identity,
    computationPathIds: identities.pathIds === null
      ? null
      : ORDER.map(index => identities.pathIds[index]),
    sourceIdentitySha256,
    runProfileSha256: historicalProfileSha256(identity),
    approvalReceipt
  });
}

export function historicalProfileSha256(profile) {
  const identity = Object.fromEntries(Object.keys(profile)
    .filter(key => key !== 'approvalReceipt' && key !== 'computationPathIds' &&
      key !== 'sourceIdentitySha256' && key !== 'runProfileSha256')
    .map(key => [key, profile[key]]));
  return sha256(canonicalJson(identity));
}

export function verifyHistoricalSourcePins(profile = HISTORICAL_RUN_PROFILE) {
  try {
    if (!profile || !profile.sourceFiles || !profile.sourceSha256 ||
        canonicalJson(Object.keys(profile.sourceFiles).sort()) !==
          canonicalJson(Object.keys(profile.sourceSha256).sort())) {
      return {ok: false, error: {code: 'HISTORICAL_SOURCE_PIN_MISMATCH'}};
    }
    const observed = {};
    for (const [name, relative] of Object.entries(profile.sourceFiles)) {
      const absolute = path.resolve(ROOT, relative);
      if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) {
        return {ok: false, error: {code: 'HISTORICAL_SOURCE_PIN_MISMATCH'}};
      }
      observed[name] = sha256(readFileSync(absolute));
    }
    if (canonicalJson(observed) !== canonicalJson(profile.sourceSha256)) {
      return {ok: false, error: {code: 'HISTORICAL_SOURCE_PIN_MISMATCH'}};
    }
    return {ok: true, sourceIdentitySha256: sha256(canonicalJson(observed))};
  } catch {
    return {ok: false, error: {code: 'HISTORICAL_SOURCE_PIN_MISMATCH'}};
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const HISTORICAL_RUN_PROFILE = deriveHistoricalProfile();
export const HISTORICAL_INPUT_MANIFEST = HISTORICAL_RUN_PROFILE.inputManifest;
export const HISTORICAL_ADMISSION_RECEIPT = HISTORICAL_RUN_PROFILE.approvalReceipt;
