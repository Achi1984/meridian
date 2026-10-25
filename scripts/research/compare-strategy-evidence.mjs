import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateEvidenceContract} from '../../docs/strategy-lab/validate-evidence-contract.mjs';

export const COMPARISON_LIMITS = Object.freeze({
  inputBytes: 65536,
  maxDepth: 12,
  maxValues: 4096,
  maxArrayItems: 128,
  maxObjectKeys: 64,
  maxStringBytes: 8192
});

export const USAGE = `Usage: node scripts/research/compare-strategy-evidence.mjs [--help]
Read one JSON object from stdin containing exactly two MERIDIAN_PAPER_FIRST_EVIDENCE_V2
evidence objects as {"earlier":{...},"later":{...}}.
See docs/strategy-lab/PAPER_FIRST_EVIDENCE_CONTRACT.md for the unchanged contract.
The comparison validates caller-supplied structure only; it does not authenticate evidence or grant authority.`;

const IDENTITY_FIELDS = ['strategy', 'rules', 'data', 'windows', 'costAssumptions', 'criteria'];
const METRIC_FIELDS = ['applicability', 'value', 'unit', 'denominator', 'reason', 'threshold'];
const SEMANTIC_METRIC_FIELDS = ['applicability', 'unit', 'denominator'];
const COLLECTIONS = ['lifecycleReceipts', 'failures', 'unknowns', 'holdoutUseClaims'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(code) {
  const error = new TypeError(code);
  error.code = code;
  return error;
}

function snapshotPair(earlierInput, laterInput) {
  const budget = {values: 0, inputBytes: 0};
  const charge = bytes => {
    budget.inputBytes += bytes;
    if (budget.inputBytes > COMPARISON_LIMITS.inputBytes) throw invalid('INPUT_BYTE_LIMIT_EXCEEDED');
  };
  function copy(value, depth, seen) {
    budget.values += 1;
    if (budget.values > COMPARISON_LIMITS.maxValues) throw invalid('OBJECT_LIMIT_EXCEEDED');
    if (depth > COMPARISON_LIMITS.maxDepth) throw invalid('DEPTH_LIMIT_EXCEEDED');
    if (value === undefined) return value;
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) throw invalid('NONFINITE_NUMBER');
      charge(Buffer.byteLength(JSON.stringify(value), 'utf8'));
      return value;
    }
    if (typeof value === 'string') {
      if (Buffer.byteLength(value, 'utf8') > COMPARISON_LIMITS.maxStringBytes) {
        throw invalid('STRING_LIMIT_EXCEEDED');
      }
      charge(Buffer.byteLength(JSON.stringify(value), 'utf8'));
      return value;
    }
    if (typeof value !== 'object' || seen.has(value)) throw invalid('UNSAFE_OR_UNBOUNDED_SHAPE');
    seen.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw invalid('UNSAFE_OR_UNBOUNDED_SHAPE');
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = descriptors.length?.value;
      const keys = Reflect.ownKeys(descriptors).filter(key => key !== 'length');
      if (!Number.isSafeInteger(length) || length > COMPARISON_LIMITS.maxArrayItems ||
          keys.length !== length || keys.some(key => typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))) {
        throw invalid('UNSAFE_OR_UNBOUNDED_SHAPE');
      }
      charge(2 + Math.max(0, length - 1));
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw invalid('ACCESSOR_OR_HIDDEN_PROPERTY');
        }
        result.push(copy(descriptor.value, depth + 1, seen));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid('UNSAFE_OR_UNBOUNDED_SHAPE');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > COMPARISON_LIMITS.maxObjectKeys ||
        keys.some(key => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) {
      throw invalid('UNSAFE_OR_UNBOUNDED_SHAPE');
    }
    charge(2);
    const result = {};
    for (const [index, key] of keys.entries()) {
      if (Buffer.byteLength(key, 'utf8') > COMPARISON_LIMITS.maxStringBytes) {
        throw invalid('STRING_LIMIT_EXCEEDED');
      }
      charge(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + (index ? 1 : 0));
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw invalid('ACCESSOR_OR_HIDDEN_PROPERTY');
      }
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1, seen),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return result;
  }
  return [copy(earlierInput, 0, new WeakSet()), copy(laterInput, 0, new WeakSet())];
}

function canonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return `number:${value}`;
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort(compareText);
  return `{${keys.map(key => `${canonical(key)}:${canonical(value[key])}`).join(',')}}`;
}

function field(object, key) {
  if (!object || !Object.hasOwn(object, key)) return {state: 'ABSENT'};
  const value = object[key];
  if (value === undefined) return {state: 'UNDEFINED'};
  if (value === null) return {state: 'NULL', value: null};
  return {state: 'PRESENT', value};
}



function identityFor(input, validation) {
  const receipts = input.lifecycle?.receipts ?? [];
  const validatedReceiptRefs = new Set(validation.lifecycle.receipts.map(receipt => receipt.receiptRef));
  const data = [];
  const windows = [];
  const criteria = [];
  const metrics = [];
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object' || !validatedReceiptRefs.has(receipt.receiptRef)) continue;
    if (receipt.dataRef !== null) {
      data.push({stage: receipt.stage, receiptRef: receipt.receiptRef, reference: receipt.dataRef});
    }
    if (receipt.dataWindow !== null || receipt.plannedWindow !== null) {
      windows.push({
        stage: receipt.stage,
        receiptRef: receipt.receiptRef,
        dataWindow: receipt.dataWindow,
        plannedWindow: receipt.plannedWindow
      });
    }
    if (receipt.preregistration !== null) {
      criteria.push({
        stage: receipt.stage,
        receiptRef: receipt.receiptRef,
        preregistration: receipt.preregistration
      });
    }
    for (const metric of receipt.metrics ?? []) {
      metrics.push({
        stage: receipt.stage,
        receiptRef: receipt.receiptRef,
        name: metric.name,
        threshold: metric.threshold
      });
    }
  }
  const strategy = input.strategy;
  return {
    strategy: strategy ? {id: strategy.id, version: strategy.version} : undefined,
    rules: strategy?.rulesRef,
    data: data.sort((a, b) => compareText(`${a.stage}:${a.receiptRef}`, `${b.stage}:${b.receiptRef}`)),
    windows: windows.sort((a, b) => compareText(`${a.stage}:${a.receiptRef}`, `${b.stage}:${b.receiptRef}`)),
    costAssumptions: strategy?.costAssumptions,
    criteria: {
      preregistrations: criteria.sort((a, b) => compareText(`${a.stage}:${a.receiptRef}`, `${b.stage}:${b.receiptRef}`)),
      thresholds: metrics.sort((a, b) => compareText(`${a.stage}:${a.receiptRef}:${a.name}`, `${b.stage}:${b.receiptRef}:${b.name}`))
    }
  };
}

function issueRecords(validation, statusSet) {
  return validation.evidenceCompleteness.issues
    .filter(issue => statusSet.has(issue.status))
    .map(issue => ({id: `${issue.path}\0${issue.reason}`, ...issue}))
    .sort((a, b) => compareText(a.id, b.id));
}

function identified(records, key = item => item.id) {
  return new Map(records.map(item => [key(item), item]));
}

function diffRecords(earlierRecords, laterRecords, key = item => item.id) {
  const earlier = identified(earlierRecords, key);
  const later = identified(laterRecords, key);
  const added = [];
  const removed = [];
  const changed = [];
  for (const id of [...new Set([...earlier.keys(), ...later.keys()])].sort(compareText)) {
    if (!earlier.has(id)) added.push({id, later: later.get(id)});
    else if (!later.has(id)) removed.push({id, earlier: earlier.get(id)});
    else if (canonical(earlier.get(id)) !== canonical(later.get(id))) {
      changed.push({id, earlier: earlier.get(id), later: later.get(id)});
    }
  }
  return {added, removed, changed};
}

function issueKey(issue) {
  return `${issue.path}\0${issue.reason}`;
}

function metricRecords(input, validation) {
  const sourceReceipts = input.lifecycle?.receipts ?? [];
  const validatedReceipts = validation.lifecycle.receipts;
  const records = [];
  for (const sourceReceipt of sourceReceipts) {
    if (!sourceReceipt || typeof sourceReceipt !== 'object' || !Array.isArray(sourceReceipt.metrics)) continue;
    const validatedReceipt = validatedReceipts.find(receipt => receipt.receiptRef === sourceReceipt.receiptRef);
    for (const sourceMetric of sourceReceipt.metrics) {
      if (!sourceMetric || typeof sourceMetric !== 'object') continue;
      const validatedMetric = validatedReceipt?.metrics.find(metric => metric.name === sourceMetric.name);
      const metric = {};
      for (const key of METRIC_FIELDS) metric[key] = field(sourceMetric, key);
      records.push({
        id: `${sourceReceipt.stage}\0${sourceReceipt.receiptRef}\0${sourceMetric.name}`,
        stage: sourceReceipt.stage,
        receiptRef: sourceReceipt.receiptRef,
        name: sourceMetric.name,
        validatorProjection: validatedMetric ? 'PRESENT' : 'NOT_PROJECTED',
        ...metric
      });
    }
  }
  return records.sort((a, b) => compareText(a.id, b.id));
}

function holdoutClaims(input) {
  const claims = [];
  for (const receipt of input.lifecycle?.receipts ?? []) {
    if (receipt?.stage !== 'OUT_OF_SAMPLE_HOLDOUT' || !receipt.holdoutAccess) continue;
    for (const exposure of receipt.holdoutAccess.exposures ?? []) {
      claims.push({
        stage: receipt.stage,
        receiptRef: receipt.receiptRef,
        history: receipt.holdoutAccess.history,
        role: exposure.role,
        at: exposure.at,
        purpose: exposure.purpose
      });
    }
  }
  claims.sort((a, b) => compareText(canonical(a), canonical(b)));
  const counts = new Map();
  return claims.map(claim => {
    const baseId = canonical(claim);
    const occurrence = counts.get(baseId) ?? 0;
    counts.set(baseId, occurrence + 1);
    return {id: `${baseId}:${occurrence}`, ...claim};
  });
}

function compareMetricRecords(earlier, later, incompatibilities) {
  const result = diffRecords(earlier, later);
  for (const item of [...result.added, ...result.removed]) {
    incompatibilities.push(`METRIC_SET_CHANGED:${item.id.replaceAll('\0', ':')}`);
  }
  for (const item of result.changed) {
    const semanticChange = SEMANTIC_METRIC_FIELDS.some(key =>
      canonical(item.earlier[key]) !== canonical(item.later[key]));
    if (semanticChange) incompatibilities.push(`METRIC_SEMANTICS_CHANGED:${item.id.replaceAll('\0', ':')}`);
  }
  return result;
}

function compareOne(earlierInput, laterInput) {
  const [earlier, later] = snapshotPair(earlierInput, laterInput);
  const earlierValidation = validateEvidenceContract(earlier);
  const laterValidation = validateEvidenceContract(later);
  const earlierIdentity = identityFor(earlier, earlierValidation);
  const laterIdentity = identityFor(later, laterValidation);
  const incompatibilities = [];
  const identity = {};
  const missingIdentity = [];
  for (const key of IDENTITY_FIELDS) {
    const before = field(earlierIdentity, key);
    const after = field(laterIdentity, key);
    identity[key] = {earlier: before, later: after, changed: canonical(before) !== canonical(after)};
    if (identity[key].changed) incompatibilities.push(`${key.toUpperCase()}_CHANGED`);
    if (before.state !== 'PRESENT' || before.value === null ||
        after.state !== 'PRESENT' || after.value === null ||
        (Array.isArray(before.value) && before.value.length === 0) ||
        (Array.isArray(after.value) && after.value.length === 0) ||
        (key === 'criteria' && (!before.value?.preregistrations?.length ||
          !after.value?.preregistrations?.length))) {
      missingIdentity.push(key);
    }
  }
  const syntheticFixtureClaims = {
    earlier: field(earlier, 'syntheticFixture'),
    later: field(later, 'syntheticFixture')
  };
  if (syntheticFixtureClaims.earlier.state !== 'PRESENT' ||
      syntheticFixtureClaims.later.state !== 'PRESENT') {
    missingIdentity.push('syntheticFixtureClass');
  }
  if (syntheticFixtureClaims.earlier.state === 'PRESENT' &&
      syntheticFixtureClaims.later.state === 'PRESENT' &&
      syntheticFixtureClaims.earlier.value !== syntheticFixtureClaims.later.value) {
    incompatibilities.push('SYNTHETIC_CLASS_MISMATCH');
  }

  const receiptSummary = receipt => {
    const {metrics: ignoredMetrics, ...summary} = receipt;
    return {id: receipt.receiptRef, ...summary};
  };
  const receipts = diffRecords(
    earlierValidation.lifecycle.receipts.map(receiptSummary),
    laterValidation.lifecycle.receipts.map(receiptSummary)
  );
  const metrics = compareMetricRecords(
    metricRecords(earlier, earlierValidation),
    metricRecords(later, laterValidation),
    incompatibilities
  );
  const failureStatuses = new Set(['FAILED']);
  const unknownStatuses = new Set(['MISSING', 'NOT_ASSESSED', 'INCONCLUSIVE', 'INVALID']);
  const failures = diffRecords(
    issueRecords(earlierValidation, failureStatuses),
    issueRecords(laterValidation, failureStatuses),
    issueKey
  );
  const unknowns = diffRecords(
    issueRecords(earlierValidation, unknownStatuses),
    issueRecords(laterValidation, unknownStatuses),
    issueKey
  );
  const earlierHoldoutClaims = holdoutClaims(earlier);
  const laterHoldoutClaims = holdoutClaims(later);
  const holdoutUseClaims = diffRecords(
    earlierHoldoutClaims,
    laterHoldoutClaims
  );

  const validity = {
    earlier: earlierValidation.evidenceCompleteness.status,
    later: laterValidation.evidenceCompleteness.status
  };
  const completeAndValid = validity.earlier === 'ASSERTED_WELL_FORMED' &&
    validity.later === 'ASSERTED_WELL_FORMED' && missingIdentity.length === 0;
  const reasons = [...new Set(incompatibilities)].sort(compareText);
  const comparability = !completeAndValid
    ? 'NOT_COMPARABLE_INCOMPLETE_OR_INVALID'
    : reasons.length ? 'DECLARED_INCOMPATIBLE' : 'DECLARED_COMPARABLE';

  return {
    comparison: {
      declaredComparability: comparability,
      incompatibilityReasons: reasons,
      missingIdentityFields: missingIdentity,
      metadataEqualityIsAuthenticatedEquivalence: false
    },
    validation: {earlier: earlierValidation, later: laterValidation},
    identity,
    costAndCriteriaReferences: {
      cost: identity.costAssumptions,
      criteria: identity.criteria
    },
    lifecycleReceipts: receipts,
    metrics,
    failures: {...failures, earlier: issueRecords(earlierValidation, failureStatuses)},
    unknowns: {...unknowns, earlier: issueRecords(earlierValidation, unknownStatuses)},
    holdoutUseClaims: {
      ...holdoutUseClaims,
      earlierClaimsRemainVisible: earlierHoldoutClaims,
      callerClaimedUseInEitherInput: earlierHoldoutClaims.length > 0 || laterHoldoutClaims.length > 0
    },
    syntheticFixtureClaims,
    operationalReadiness: 'NOT_ASSESSED',
    executionAuthorized: false,
    autoPromotion: false,
    provenanceVerified: false
  };
}

export function compareStrategyEvidence(earlierInput, laterInput) {
  return compareOne(earlierInput, laterInput);
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
      const input = JSON.parse(await readBoundedStdin());
      if (!input || Array.isArray(input) || typeof input !== 'object' ||
          Object.keys(input).length !== 2 ||
          !Object.hasOwn(input, 'earlier') || !Object.hasOwn(input, 'later') ||
          !input.earlier || Array.isArray(input.earlier) || typeof input.earlier !== 'object' ||
          !input.later || Array.isArray(input.later) || typeof input.later !== 'object') {
        throw invalid('CLI_REQUIRES_TWO_EVIDENCE_OBJECTS');
      }
      const result = compareOne(input.earlier, input.later);
      if (result.validation.earlier.evidenceCompleteness.status !== 'ASSERTED_WELL_FORMED' ||
          result.validation.later.evidenceCompleteness.status !== 'ASSERTED_WELL_FORMED') {
        throw invalid('CLI_EVIDENCE_INVALID_OR_INCOMPLETE');
      }
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stderr.write('Invalid comparison input; provide exactly two bounded contract evidence objects.\n');
      process.exitCode = 1;
    }
  })();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
