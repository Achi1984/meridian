import {readFileSync} from 'node:fs';
import {canonicalJson, sha256} from './engine.mjs';
import {ASSETS, INPUT} from './validate.mjs';

const profilePath = new URL('../../research-supervisor/historical_run_profile.json', import.meta.url);
const bridgePath = new URL('../../research-supervisor/b1_bridge_manifest.json', import.meta.url);
const profileData = JSON.parse(readFileSync(profilePath, 'utf8'));
const bridge = JSON.parse(readFileSync(bridgePath, 'utf8'));
if (profileData.protocolId !== bridge.protocolId ||
    profileData.protocolSha256 !== bridge.protocolSha256 ||
    canonicalJson(profileData.expectedWholeFileSha256) !== canonicalJson(INPUT.normalizedHashes) ||
    canonicalJson(profileData.assets) !== canonicalJson(ASSETS)) {
  throw new Error('HISTORICAL_PROFILE_SOURCE_MISMATCH');
}

const {approvalReceipt, ...frozenProfileData} = profileData;
const profileIdentity = {
  ...frozenProfileData,
  pathDescriptors: bridge.pathDescriptors,
  pathIds: bridge.pathIds,
  manifestSha256: bridge.manifestSha256,
  computationOrder: bridge.computationOrder,
  computationOrderSha256: bridge.computationOrderSha256
};

export function historicalProfileSha256(profile = profileIdentity) {
  const identity = Object.fromEntries(Object.keys(profileIdentity)
    .map(key => [key, profile[key]]));
  return sha256(canonicalJson(identity));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const HISTORICAL_INPUT_MANIFEST = profileData.inputManifest;
export const HISTORICAL_ADMISSION_RECEIPT = approvalReceipt;
export const HISTORICAL_RUN_PROFILE = deepFreeze({
  ...profileIdentity,
  computationPathIds: bridge.computationOrder.map(index => bridge.pathIds[index]),
  sourceIdentitySha256: sha256(canonicalJson(profileData.sourceSha256)),
  runProfileSha256: historicalProfileSha256(profileIdentity)
});
