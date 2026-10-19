import {canonicalJson, sha256} from './engine.mjs';
import {ASSETS, INPUT} from './validate.mjs';
import {HISTORICAL_ADMISSION_RECEIPT, HISTORICAL_INPUT_MANIFEST,
  historicalProfileSha256} from './historical-profile.mjs';

export {HISTORICAL_ADMISSION_RECEIPT, HISTORICAL_INPUT_MANIFEST};

const RECEIPT_KEYS = Object.freeze([
  'schema', 'decision', 'owner', 'approvedAt', 'sourceCommit', 'sourceIdentitySha256',
  'protocolSha256', 'implementationSha256', 'inputManifestSha256', 'runProfileSha256',
  'manifestSha256', 'computationOrderSha256', 'trialKey', 'pathIds'
]);

function snapshot(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) return null;
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function approvedAtValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().replace('.000Z', 'Z') === value &&
    parsed <= Date.now();
}

function snapshotPathIds(value) {
  try {
    if (!Array.isArray(value)) return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (length !== 44 || Reflect.ownKeys(value).length !== 45) return null;
    const result = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !digest(descriptor.value)) {
        return null;
      }
      result.push(descriptor.value);
    }
    return new Set(result).size === 44 ? result : null;
  } catch {
    return null;
  }
}

const denied = code => ({ok: false, status: 'REJECTED', error: {code}});

export function inspectHistoricalAdmission({receipt, manifest, profile}) {
  if (manifest === null) {
    return {ok: false, status: 'BLOCKED', error: {code: 'INPUT_MANIFEST_NOT_FROZEN'}};
  }
  if (receipt === null) {
    return {ok: false, status: 'BLOCKED', error: {code: 'D2_APPROVAL_REQUIRED'}};
  }
  if (profile?.status !== 'FROZEN_FOR_D2' ||
      profile.runProfileSha256 !== historicalProfileSha256(profile) ||
      !profile.inputManifest || !digest(profile.inputManifestSha256) ||
      canonicalJson(profile.inputManifest) !== canonicalJson(manifest) ||
      !profile.sourceFiles || !profile.sourceSha256 ||
      profile.sourceIdentitySha256 !== sha256(canonicalJson(profile.sourceSha256)) ||
      canonicalJson(Object.keys(profile.sourceFiles).sort()) !==
        canonicalJson(Object.keys(profile.sourceSha256).sort()) ||
      Object.values(profile.sourceSha256).some(value => !digest(value) || value === '0'.repeat(64))) {
    return {ok: false, status: 'BLOCKED', error: {code: 'HISTORICAL_PROFILE_NOT_FROZEN'}};
  }
  const selected = snapshot(manifest, ['sourceCommit', 'files', 'selectedSeriesSha256']);
  const files = selected && snapshot(selected.files, ASSETS);
  const selectedSeriesSha256 = selected && snapshot(selected.selectedSeriesSha256, ASSETS);
  const approved = snapshot(receipt, RECEIPT_KEYS);
  const actualPaths = snapshotPathIds(approved?.pathIds);
  const expectedPaths = snapshotPathIds(profile?.pathIds);
  if (!selected || !files || !selectedSeriesSha256) return denied('INPUT_MANIFEST_INVALID');
  if (!approved || !actualPaths || !expectedPaths) return denied('D2_APPROVAL_INVALID');
  if (approved.sourceCommit !== profile?.sourceCommit || approved.sourceCommit !== INPUT.sourceCommit) {
    return denied('D2_SOURCE_MISMATCH');
  }
  if (approved.sourceIdentitySha256 !== profile?.sourceIdentitySha256) {
    return denied('D2_SOURCE_MISMATCH');
  }
  if (approved.protocolSha256 !== profile?.protocolSha256) return denied('D2_PROTOCOL_MISMATCH');
  if (approved.implementationSha256 !== profile?.implementationSha256) {
    return denied('D2_IMPLEMENTATION_MISMATCH');
  }
  if (approved.inputManifestSha256 !== sha256(canonicalJson(selected))) {
    return denied('D2_MANIFEST_MISMATCH');
  }
  if (profile.inputManifestSha256 !== approved.inputManifestSha256) {
    return denied('D2_PROFILE_MISMATCH');
  }
  if (approved.runProfileSha256 !== profile?.runProfileSha256 ||
      !digest(approved.runProfileSha256)) return denied('D2_PROFILE_MISMATCH');
  if (approved.manifestSha256 !== profile?.manifestSha256 ||
      approved.computationOrderSha256 !== profile?.computationOrderSha256) {
    return denied('D2_PATHS_MISMATCH');
  }
  if (typeof profile?.trialKey !== 'string' || approved.trialKey !== profile.trialKey) {
    return denied('D2_TRIAL_MISMATCH');
  }
  if (canonicalJson(actualPaths) !== canonicalJson(expectedPaths)) {
    return denied('D2_PATHS_MISMATCH');
  }
  if (selected.sourceCommit !== INPUT.sourceCommit ||
      ASSETS.some(asset => !digest(files[asset]) || files[asset] !== INPUT.normalizedHashes[asset])) {
    return denied('D2_SOURCE_MISMATCH');
  }
  if (ASSETS.some(asset => !digest(selectedSeriesSha256[asset]))) {
    return denied('INPUT_MANIFEST_INVALID');
  }
  if (approved.schema !== 'MERIDIAN_D2_HISTORICAL_APPROVAL_R1' ||
      approved.decision !== 'APPROVE_ONE_SHOT_HISTORICAL_RESEARCH' ||
      approved.owner !== 'Achi1984' ||
      !approvedAtValid(approved.approvedAt)) {
    return denied('D2_APPROVAL_INVALID');
  }
  return {ok: true, status: 'ADMITTED', inputManifestSha256: approved.inputManifestSha256};
}
