import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const COMPARISON_LIMITS = Object.freeze({
  inputBytes: 65536,
  maxDepth: 32,
  maxValues: 4096,
  maxArrayItems: 512,
  maxObjectKeys: 128,
  maxStringCharacters: 8192
});

export const USAGE = `Usage: node scripts/research/compare-strategy-evidence.mjs [--help]
Read one JSON object from stdin with exactly two evidence objects:
{"earlier":{...},"later":{...}}
The comparison is offline, caller-asserted, and grants no authority.`;

const EVIDENCE_KEYS = new Set([
  'strategy', 'rules', 'data', 'window', 'costReference', 'criteriaReference',
  'lifecycleReceipts', 'metrics', 'failures', 'unknowns', 'holdoutUseClaims',
  'syntheticFixture'
]);
const IDENTITY_FIELDS = [
  ['strategy', 'STRATEGY_IDENTITY_CHANGED'],
  ['rules', 'RULES_IDENTITY_CHANGED'],
  ['data', 'DATA_IDENTITY_CHANGED'],
  ['window', 'WINDOW_CHANGED'],
  ['costReference', 'COST_REFERENCE_CHANGED'],
  ['criteriaReference', 'CRITERIA_REFERENCE_CHANGED']
];
const METRIC_FIELDS = ['applicability', 'unit', 'denominator', 'value'];
const CLAIM_COLLECTIONS = [
  ['lifecycleReceipts', 'lifecycleReceipts'],
  ['failures', 'failures'],
  ['unknowns', 'unknowns'],
  ['holdoutUseClaims', 'holdoutUseClaims']
];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(code) {
  const error = new TypeError(code);
  error.code = code;
  return error;
}

function snapshot(value, state = {values: 0}, depth = 0) {
  state.values += 1;
  if (state.values > COMPARISON_LIMITS.maxValues) throw invalid('OBJECT_LIMIT_EXCEEDED');
  if (depth > COMPARISON_LIMITS.maxDepth) throw invalid('DEPTH_LIMIT_EXCEEDED');
  if (value === undefined || value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > COMPARISON_LIMITS.maxStringCharacters) throw invalid('STRING_LIMIT_EXCEEDED');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid('NONFINITE_NUMBER');
    return value;
  }
  if (typeof value !== 'object') throw invalid('NON_JSON_VALUE');

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw invalid('NON_PLAIN_ARRAY');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length > COMPARISON_LIMITS.maxArrayItems) {
      throw invalid('ARRAY_LIMIT_EXCEEDED');
    }
    const keys = Reflect.ownKeys(descriptors).filter(key => key !== 'length');
    if (keys.length !== length) throw invalid('SPARSE_OR_EXTENDED_ARRAY');
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw invalid('ACCESSOR_OR_HIDDEN_PROPERTY');
      }
      result.push(snapshot(descriptor.value, state, depth + 1));
    }
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) throw invalid('NON_PLAIN_OBJECT');

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > COMPARISON_LIMITS.maxObjectKeys) throw invalid('OBJECT_KEY_LIMIT_EXCEEDED');
  const result = {};
  for (const key of keys) {
    if (typeof key !== 'string') throw invalid('SYMBOL_PROPERTY');
    if (key.length > COMPARISON_LIMITS.maxStringCharacters) throw invalid('STRING_LIMIT_EXCEEDED');
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw invalid('ACCESSOR_OR_HIDDEN_PROPERTY');
    }
    Object.defineProperty(result, key, {
      value: snapshot(descriptor.value, state, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return result;
}

function canonical(value) {
  if (value === undefined) return 'u';
  if (value === null) return 'n';
  if (typeof value === 'boolean') return value ? 'b1' : 'b0';
  if (typeof value === 'number') return `d${value};`;
  if (typeof value === 'string') return `s${value.length}:${value}`;
  if (Array.isArray(value)) return `a${value.length}[${value.map(canonical).join('')}]`;
  const keys = Object.keys(value).sort();
  return `o${keys.length}{${keys.map(key => `${canonical(key)}${canonical(value[key])}`).join('')}}`;
}

function fieldValue(object, key) {
  if (!Object.hasOwn(object, key)) return {state: 'ABSENT'};
  const value = object[key];
  if (value === undefined) return {state: 'UNDEFINED'};
  if (value === null) return {state: 'NULL', value: null};
  return {state: 'PRESENT', value};
}

function entriesFor(evidence, key) {
  const entries = evidence[key];
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) throw invalid('COLLECTION_NOT_ARRAY');
  const indexed = entries.map(entry => {
    const id = entry && typeof entry === 'object'
      ? entry.id ?? entry.receiptRef ?? entry.stage ?? entry.name
      : undefined;
    return {id: id === undefined ? canonical(entry) : String(id), entry};
  });
  indexed.sort((left, right) => compareText(left.id, right.id) ||
    compareText(canonical(left.entry), canonical(right.entry)));
  const seen = new Set();
  for (const item of indexed) {
    if (seen.has(item.id)) throw invalid('DUPLICATE_COLLECTION_ID');
    seen.add(item.id);
  }
  return indexed;
}

function compareCollection(earlier, later, key) {
  const before = new Map(entriesFor(earlier, key).map(item => [item.id, item.entry]));
  const after = new Map(entriesFor(later, key).map(item => [item.id, item.entry]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
    if (!before.has(id)) added.push({id, later: after.get(id)});
    else if (!after.has(id)) removed.push({id, earlier: before.get(id)});
    else if (canonical(before.get(id)) !== canonical(after.get(id))) {
      changed.push({id, earlier: before.get(id), later: after.get(id)});
    }
  }
  return {added, removed, changed};
}

function compareMetrics(earlier, later, incompatibilities) {
  const before = new Map(entriesFor(earlier, 'metrics').map(item => [item.id, item.entry]));
  const after = new Map(entriesFor(later, 'metrics').map(item => [item.id, item.entry]));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort(compareText);
  const metrics = [];
  for (const name of names) {
    const left = before.get(name);
    const right = after.get(name);
    const metric = {name};
    for (const field of METRIC_FIELDS) {
      metric[field] = {
        earlier: fieldValue(left ?? Object.create(null), field),
        later: fieldValue(right ?? Object.create(null), field)
      };
    }
    if (!left || !right) {
      incompatibilities.push(`METRIC_SET_CHANGED:${name}`);
      metric.change = left ? 'REMOVED' : 'ADDED';
    } else {
      const semanticChange = ['applicability', 'unit', 'denominator']
        .some(field => canonical(fieldValue(left, field)) !== canonical(fieldValue(right, field)));
      if (semanticChange) incompatibilities.push(`METRIC_SEMANTICS_CHANGED:${name}`);
      metric.change = canonical(left) === canonical(right) ? 'UNCHANGED' : 'CHANGED';
    }
    metrics.push(metric);
  }
  return metrics;
}

function evidenceObject(input) {
  const result = snapshot(input);
  if (result === null || Array.isArray(result) || typeof result !== 'object') {
    throw invalid('EVIDENCE_NOT_OBJECT');
  }
  for (const key of Object.keys(result)) {
    if (!EVIDENCE_KEYS.has(key)) throw invalid('UNKNOWN_EVIDENCE_FIELD');
  }
  for (const key of ['lifecycleReceipts', 'metrics', 'failures', 'unknowns', 'holdoutUseClaims']) {
    if (Object.hasOwn(result, key) && result[key] !== undefined && !Array.isArray(result[key])) {
      throw invalid('COLLECTION_NOT_ARRAY');
    }
  }
  return result;
}

export function compareStrategyEvidence(earlierInput, laterInput) {
  const earlier = evidenceObject(earlierInput);
  const later = evidenceObject(laterInput);
  const incompatibilities = [];
  const identity = {};
  const undeclaredMetadata = [];
  for (const [field, reason] of IDENTITY_FIELDS) {
    const before = fieldValue(earlier, field);
    const after = fieldValue(later, field);
    identity[field] = {earlier: before, later: after, changed: canonical(before) !== canonical(after)};
    if (identity[field].changed) incompatibilities.push(reason);
    if (before.state !== 'PRESENT' || before.value === null ||
        after.state !== 'PRESENT' || after.value === null) undeclaredMetadata.push(field);
  }

  const collections = {};
  for (const [key, outputKey] of CLAIM_COLLECTIONS) {
    collections[outputKey] = compareCollection(earlier, later, key);
  }
  const metrics = compareMetrics(earlier, later, incompatibilities);
  const reasons = [...new Set(incompatibilities)].sort(compareText);
  const earlierHoldoutClaims = entriesFor(earlier, 'holdoutUseClaims').map(item => item.entry);
  const laterHoldoutClaims = entriesFor(later, 'holdoutUseClaims').map(item => item.entry);
  const synthetic = {
    earlier: fieldValue(earlier, 'syntheticFixture'),
    later: fieldValue(later, 'syntheticFixture')
  };

  return {
    comparison: {
      declaredComparability: reasons.length ? 'DECLARED_INCOMPATIBLE' :
        undeclaredMetadata.length ? 'COMPARABILITY_UNDECLARED' : 'DECLARED_COMPARABLE',
      incompatibilityReasons: reasons,
      undeclaredMetadataFields: undeclaredMetadata,
      metadataEqualityIsAuthenticatedEquivalence: false
    },
    identity,
    lifecycleReceipts: collections.lifecycleReceipts,
    costAndCriteriaReferences: {
      cost: identity.costReference,
      criteria: identity.criteriaReference
    },
    metrics,
    failures: collections.failures,
    unknowns: collections.unknowns,
    holdoutUseClaims: {
      ...collections.holdoutUseClaims,
      earlierClaimsRemainVisible: earlierHoldoutClaims,
      callerClaimedUseInEitherInput: earlierHoldoutClaims.length > 0 || laterHoldoutClaims.length > 0
    },
    syntheticFixtureClaims: synthetic,
    executionAuthorized: false,
    autoPromotion: false,
    provenanceVerified: false
  };
}

async function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > COMPARISON_LIMITS.inputBytes) throw invalid('INPUT_BYTE_LIMIT_EXCEEDED');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function runCli() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (process.argv.length !== 2) {
    process.stderr.write('Invalid arguments. Use --help for usage.\n');
    process.exitCode = 2;
    return;
  }
  void (async () => {
    try {
      const text = await readBoundedStdin();
      const input = JSON.parse(text);
      if (!input || Array.isArray(input) || typeof input !== 'object' ||
          Object.keys(input).length !== 2 ||
          !Object.hasOwn(input, 'earlier') || !Object.hasOwn(input, 'later')) {
        throw invalid('CLI_REQUIRES_TWO_EVIDENCE_OBJECTS');
      }
      const result = compareStrategyEvidence(input.earlier, input.later);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stderr.write('Invalid comparison input; provide exactly two bounded JSON evidence objects.\n');
      process.exitCode = 1;
    }
  })();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
