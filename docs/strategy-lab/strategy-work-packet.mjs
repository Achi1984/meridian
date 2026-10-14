// Offline metadata admission. Trusted JSON data only; no I/O, dispatch or authority.
import {createHash} from 'node:crypto';

const VERSION = 'STRATEGY_WORK_PACKET_METADATA_V1';
const FLAGS = Object.freeze({recommendationOnly: true, dispatchAuthorized: false,
  executionAuthorized: false, empiricalRunAuthorized: false, mergeAuthorized: false,
  runtimeAuthorized: false, evidenceAuthenticated: false});
const fail = error => ({valid: false, error, ...FLAGS});
const exact = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x)) &&
  Reflect.ownKeys(x).length === keys.length && Object.keys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x, k));
const integer = (x, min, max) => Number.isSafeInteger(x) && !Object.is(x, -0) && x >= min && x <= max;
const boundedArray = (x, min, max) => Array.isArray(x) && x.length >= min && x.length <= max &&
  Reflect.ownKeys(x).length === x.length + 1 && Object.keys(x).length === x.length &&
  Array.from({length: x.length}, (_, i) => Object.hasOwn(x, i)).every(Boolean);
const matches = (x, regex) => typeof x === 'string' && regex.test(x) && !x.includes('\n');
const id = x => matches(x, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const hash = (x, size) => matches(x, size === 40 ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/);
const unique = values => new Set(values).size === values.length;
const stringSet = (x, min, max, check) => boundedArray(x, min, max) && x.every(check) && unique(x);
const TEST = /^test\/((?:strategy-|elliott-|trend-pullback-)[A-Za-z0-9_-]+)\.test\.js$/;
const DOC = /^docs\/strategy-lab\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})\.(?:md|mjs|json)$/;
const FROZEN = new Set(['docs/strategy-lab/fixtures/elliott-frozen-v1.mjs',
  'docs/strategy-lab/fixtures/elliott-frozen-wave5.mjs']);
function pathAllowed(path, {write = false, testOnly = false} = {}) {
  if (typeof path !== 'string' || path.includes('\n')) return false;
  if (!write && !testOnly && FROZEN.has(path)) return true;
  const match = TEST.exec(path) || (!testOnly && DOC.exec(path));
  if (!match || match[1].length > 96 || /(^|[-_.])m11([-_.]|$)/i.test(match[1])) return false;
  return !write || !match[1].startsWith('elliott-frozen-');
}
function canonicalRecord(value) {
  if (Array.isArray(value)) return value.map(canonicalRecord);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalRecord(value[key]);
    return result;
  }
  return value;
}
const PACKET_KEYS = ['schemaVersion', 'repository', 'lane', 'workClass', 'packetId', 'revision',
  'conceptIds', 'economicFamilyRefs', 'objective', 'expectedHeadSha', 'predecessor', 'sources',
  'allowedPaths', 'proposedWrites', 'acceptance', 'engineeringBudget', 'trialBudgetStatus'];

export function validateStrategyWorkPacket(packet, observation) {
  if (!exact(packet, PACKET_KEYS) || packet.schemaVersion !== VERSION) return fail('PACKET_SCHEMA');
  if (packet.repository !== 'Achi1984/meridian') return fail('REPOSITORY');
  if (packet.lane !== 'STRATEGY') return fail('LANE');
  if (!['SOURCE_DESIGN', 'SOURCE_CHANGE', 'SYNTHETIC_CHECK'].includes(packet.workClass))
    return fail('UNSUPPORTED_WORK_CLASS');
  if (!id(packet.packetId)) return fail('PACKET_ID');
  if (!integer(packet.revision, 1, 1000000)) return fail('REVISION');
  if (!stringSet(packet.conceptIds, 1, 22, x => matches(x, /^C(?:0[1-9]|1[0-9]|2[0-2])$/)))
    return fail('CONCEPT_IDS');
  if (!stringSet(packet.economicFamilyRefs, 1, 22, id)) return fail('ECONOMIC_FAMILY_REFS');
  if (!matches(packet.objective, /^[\x20-\x7e]{1,500}$/) || packet.objective.trim().length === 0)
    return fail('OBJECTIVE');
  if (!hash(packet.expectedHeadSha, 40)) return fail('HEAD_SHA');
  const previous = packet.predecessor;
  if (packet.revision === 1 ? previous !== null :
    (!exact(previous, ['packetId', 'revision', 'operationKey']) || previous.packetId !== packet.packetId ||
      !integer(previous.revision, 1, 999999) || previous.revision !== packet.revision - 1 ||
      !hash(previous.operationKey, 64))) return fail('PREDECESSOR');

  if (!boundedArray(packet.sources, 1, 16)) return fail('SOURCES');
  const sourcePaths = new Set();
  for (const source of packet.sources) {
    if (!exact(source, ['path', 'commitSha', 'blobSha']) || !hash(source.commitSha, 40) ||
      !hash(source.blobSha, 40)) return fail('SOURCES');
    if (!pathAllowed(source.path)) return fail('SOURCE_PATH');
    if (sourcePaths.has(source.path)) return fail('SOURCES');
    sourcePaths.add(source.path);
  }
  if (!stringSet(packet.allowedPaths, 1, 8, x => pathAllowed(x, {write: true})))
    return fail('ALLOWED_PATHS');
  if (!stringSet(packet.proposedWrites, 0, 8, x => pathAllowed(x, {write: true})) ||
    !packet.proposedWrites.every(x => packet.allowedPaths.includes(x))) return fail('PROPOSED_WRITES');
  if (!boundedArray(packet.acceptance, 1, 8)) return fail('ACCEPTANCE');
  for (const check of packet.acceptance) {
    if (!exact(check, ['id', 'testPath']) || !id(check.id) ||
      !pathAllowed(check.testPath, {testOnly: true})) return fail('ACCEPTANCE');
  }
  if (!unique(packet.acceptance.map(x => x.id)) || !unique(packet.acceptance.map(x => x.testPath)))
    return fail('ACCEPTANCE');
  const budget = packet.engineeringBudget;
  if (!exact(budget, ['maxAttempts', 'maxChangedFiles']) || !integer(budget.maxAttempts, 1, 3) ||
    !integer(budget.maxChangedFiles, 1, 8) || packet.proposedWrites.length > budget.maxChangedFiles)
    return fail('ENGINEERING_BUDGET');
  if (!['UNKNOWN', 'RECONCILED'].includes(packet.trialBudgetStatus)) return fail('TRIAL_BUDGET_STATUS');

  if (!exact(observation, ['headSha', 'observedAtMs', 'decisionMs', 'maxAgeMs', 'm11State']))
    return fail('OBSERVATION_SCHEMA');
  if (!hash(observation.headSha, 40)) return fail('OBSERVATION_HEAD_SHA');
  if (![observation.observedAtMs, observation.decisionMs].every(x => integer(x, 0, Number.MAX_SAFE_INTEGER)))
    return fail('OBSERVATION_TIME');
  if (!integer(observation.maxAgeMs, 1, 300000)) return fail('OBSERVATION_MAX_AGE');
  if (!['FREE', 'BUSY', 'UNKNOWN'].includes(observation.m11State)) return fail('M11_STATE');
  if (observation.headSha !== packet.expectedHeadSha) return fail('HEAD_MISMATCH');
  if (observation.observedAtMs > observation.decisionMs) return fail('FUTURE_OBSERVATION');
  if (observation.decisionMs - observation.observedAtMs > observation.maxAgeMs) return fail('STALE_OBSERVATION');

  const normalized = {...packet};
  for (const key of ['conceptIds', 'economicFamilyRefs', 'allowedPaths', 'proposedWrites'])
    normalized[key] = [...packet[key]].sort();
  normalized.sources = [...packet.sources].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  normalized.acceptance = [...packet.acceptance].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const canonicalPacket = canonicalRecord(normalized);
  const operationKey = createHash('sha256').update(`${VERSION}\n${JSON.stringify(canonicalPacket)}`, 'utf8').digest('hex');
  return {valid: true, operationKey, canonicalPacket,
    resourceAdvice: observation.m11State === 'FREE' ? 'REVIEW_RESOURCE_AVAILABLE' : 'DEFER', ...FLAGS};
}
