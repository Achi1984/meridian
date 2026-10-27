import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateTrialLedger } from '../../docs/strategy-lab/validate-trial-ledger.mjs';

export const COMPARISON_LIMITS = Object.freeze({
  sideBytes: 2 * 1024 * 1024,
  combinedBytes: 4 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
  maxDepth: 32,
  maxNodes: 50000,
  maxStringLength: 4096,
});

export const USAGE = `Usage: node scripts/research/compare-trial-ledgers.mjs [--help]
Read one JSON object from stdin with exactly this envelope:
{"earlier": <MERIDIAN_HISTORICAL_TRIAL_LEDGER_V1>, "later": <MERIDIAN_HISTORICAL_TRIAL_LEDGER_V1>}.
Each side is a full historical trial ledger. The comparator returns each side's
unchanged validateTrialLedger result and deterministic offline differences; it
does not authenticate provenance, certify completeness, authorize execution,
promote a strategy, or establish capacity. Submitted budget declarations and
the validator's arithmetic remainingBudget are reported separately.
Malformed JSON, unsafe object graphs, input/output limits, or an invalid envelope
fail with a nonzero exit and no partial JSON audit.`;

const COLLECTIONS = [
  ['sources', 'id', 'sources'],
  ['attempts', 'attemptId', 'attempts'],
  ['resultRecords', 'resultRecordId', 'resultRecords'],
  ['nonEmpiricalRecords', 'recordId', 'nonEmpiricalRecords'],
  ['proposedProtocol.cells', 'cellId', 'proposedCells'],
  ['coverage.gaps', 'id', 'coverageGaps'],
];

function invalid(code) {
  const error = new TypeError(code);
  error.code = code;
  return error;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  if (typeof value === 'number') return `number:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map(canonical).sort(compareText).join(',')}]`;
  }
  const keys = Object.keys(value).sort(compareText);
  return `{${keys.map((key) => `${canonical(key)}:${canonical(value[key])}`).join(',')}}`;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue).sort((left, right) => compareText(canonical(left), canonical(right)));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText)
      .map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function snapshot(value, budget, seen, depth = 0) {
  budget.nodes += 1;
  if (budget.nodes > COMPARISON_LIMITS.maxNodes) throw invalid('NODE_LIMIT_EXCEEDED');
  if (depth > COMPARISON_LIMITS.maxDepth) throw invalid('DEPTH_LIMIT_EXCEEDED');

  const charge = (bytes) => {
    budget.bytes += bytes;
    if (budget.bytes > COMPARISON_LIMITS.sideBytes) throw invalid('SIDE_BYTE_LIMIT_EXCEEDED');
  };
  const jsonBytes = (entry) => Buffer.byteLength(JSON.stringify(entry), 'utf8');

  if (value === null || typeof value === 'boolean') {
    charge(jsonBytes(value));
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid('NONFINITE_NUMBER');
    charge(jsonBytes(value));
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > COMPARISON_LIMITS.maxStringLength) throw invalid('STRING_LIMIT_EXCEEDED');
    charge(jsonBytes(value));
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw invalid('UNSAFE_OR_SHARED_JSON_VALUE');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw invalid('UNSAFE_JSON_ARRAY');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors).filter((key) => key !== 'length');
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || ownKeys.length !== length
      || ownKeys.some((key) => typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))) {
      throw invalid('UNSAFE_JSON_ARRAY');
    }
    charge(2 + Math.max(0, length - 1));
    const copied = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw invalid('ACCESSOR_OR_HIDDEN_PROPERTY');
      }
      copied.push(snapshot(descriptor.value, budget, seen, depth + 1));
    }
    return copied;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid('UNSAFE_JSON_OBJECT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) throw invalid('UNSAFE_JSON_OBJECT');
  charge(2);
  const copied = Object.create(null);
  for (const [index, key] of keys.entries()) {
    if (key.length > COMPARISON_LIMITS.maxStringLength) throw invalid('STRING_LIMIT_EXCEEDED');
    charge(jsonBytes(key) + 1 + (index ? 1 : 0));
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw invalid('ACCESSOR_OR_HIDDEN_PROPERTY');
    }
    Object.defineProperty(copied, key, {
      value: snapshot(descriptor.value, budget, seen, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copied;
}

function snapshotEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw invalid('CLI_REQUIRES_EXACT_EARLIER_LATER_ENVELOPE');
  }
  const prototype = Object.getPrototypeOf(envelope);
  if (prototype !== Object.prototype && prototype !== null) throw invalid('UNSAFE_JSON_ENVELOPE');
  const descriptors = Object.getOwnPropertyDescriptors(envelope);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || !keys.includes('earlier') || !keys.includes('later')) {
    throw invalid('CLI_REQUIRES_EXACT_EARLIER_LATER_ENVELOPE');
  }
  for (const key of ['earlier', 'later']) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw invalid('ACCESSOR_OR_HIDDEN_PROPERTY');
    }
  }
  const seen = new WeakSet();
  const earlierBudget = {bytes: 0, nodes: 0};
  const laterBudget = {bytes: 0, nodes: 0};
  const earlier = snapshot(descriptors.earlier.value, earlierBudget, seen);
  const later = snapshot(descriptors.later.value, laterBudget, seen);
  if (earlierBudget.bytes + laterBudget.bytes > COMPARISON_LIMITS.combinedBytes) {
    throw invalid('COMBINED_BYTE_LIMIT_EXCEEDED');
  }
  return {earlier, later};
}

function getPath(value, path) {
  let current = value;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function resultIdentitiesByAttempt(ledger) {
  const identities = new Map();
  if (!Array.isArray(ledger?.resultRecords)) return identities;
  for (const record of ledger.resultRecords) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)
      || typeof record.attemptRef !== 'string' || typeof record.resultIdentity !== 'string') continue;
    const linked = identities.get(record.attemptRef) ?? [];
    linked.push(record.resultIdentity);
    identities.set(record.attemptRef, linked);
  }
  for (const linked of identities.values()) linked.sort(compareText);
  return identities;
}

function runTuple(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const identity = record.runIdentity;
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)) return null;
  return {
    provider: identity.provider,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
  };
}

function auditRecord(collection, record, linkedResults) {
  if (collection !== 'attempts') return stableValue(record);
  return stableValue({
    record,
    runTuple: runTuple(record),
    linkedResultIdentities: typeof record?.attemptId === 'string'
      ? (linkedResults.get(record.attemptId) ?? [])
      : [],
  });
}

function recordsFor(ledger, path) {
  const value = getPath(ledger, path);
  return {value, records: Array.isArray(value) ? value : []};
}

function identityKey(record, identityField) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const identity = record[identityField];
  return typeof identity === 'string' && identity.length > 0
    ? `${identityField}:${canonical(identity)}`
    : null;
}

function groupRecords(records, identityField) {
  const groups = new Map();
  const unkeyed = [];
  for (const record of records) {
    const key = identityKey(record, identityField);
    if (key === null) {
      unkeyed.push(record);
      continue;
    }
    const group = groups.get(key) ?? {id: record[identityField], records: []};
    group.records.push(record);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.records.sort((a, b) => compareText(canonical(a), canonical(b)));
  unkeyed.sort((a, b) => compareText(canonical(a), canonical(b)));
  return {groups, unkeyed};
}

function changedFields(earlier, later, isAttempt = false) {
  const left = isAttempt ? earlier?.record : earlier;
  const right = isAttempt ? later?.record : later;
  const keys = new Set([
    ...(left && typeof left === 'object' && !Array.isArray(left) ? Object.keys(left) : []),
    ...(right && typeof right === 'object' && !Array.isArray(right) ? Object.keys(right) : []),
  ]);
  const changes = Object.create(null);
  for (const key of [...keys].sort(compareText)) {
    const before = left?.[key];
    const after = right?.[key];
    if (canonical(before) !== canonical(after)) changes[key] = {earlier: before, later: after};
  }
  if (isAttempt
    && canonical(earlier?.linkedResultIdentities) !== canonical(later?.linkedResultIdentities)) {
    changes.linkedResultIdentities = {
      earlier: earlier?.linkedResultIdentities ?? [],
      later: later?.linkedResultIdentities ?? [],
    };
  }
  return changes;
}

function compareRecords(path, identityField, earlierInput, laterInput, earlierLinked, laterLinked) {
  const earlierCollection = recordsFor(earlierInput, path);
  const laterCollection = recordsFor(laterInput, path);
  const left = groupRecords(earlierCollection.records, identityField);
  const right = groupRecords(laterCollection.records, identityField);
  const added = [];
  const removed = [];
  const changed = [];
  const ambiguous = [];
  const allKeys = [...new Set([...left.groups.keys(), ...right.groups.keys()])].sort(compareText);

  const wrap = (record, linked) => auditRecord(path === 'proposedProtocol.cells' ? 'cells' : path, record, linked);
  for (const key of allKeys) {
    const before = left.groups.get(key);
    const after = right.groups.get(key);
    if (!before) {
      if (after.records.length > 1) {
        ambiguous.push({id: after.id, earlier: [], later: after.records.map((row) => wrap(row, laterLinked))});
        added.push({id: after.id, records: after.records.map((row) => wrap(row, laterLinked))});
      } else {
        added.push({id: after.id, record: wrap(after.records[0], laterLinked)});
      }
    } else if (!after) {
      if (before.records.length > 1) {
        ambiguous.push({id: before.id, earlier: before.records.map((row) => wrap(row, earlierLinked)), later: []});
        removed.push({id: before.id, records: before.records.map((row) => wrap(row, earlierLinked))});
      } else {
        removed.push({id: before.id, record: wrap(before.records[0], earlierLinked)});
      }
    } else if (before.records.length > 1 || after.records.length > 1) {
      ambiguous.push({
        id: before.id,
        earlier: before.records.map((row) => wrap(row, earlierLinked)),
        later: after.records.map((row) => wrap(row, laterLinked)),
      });
    } else {
      const earlierRecord = wrap(before.records[0], earlierLinked);
      const laterRecord = wrap(after.records[0], laterLinked);
      if (canonical(earlierRecord) !== canonical(laterRecord)) {
        const difference = {id: before.id, earlier: earlierRecord, later: laterRecord};
        difference.changedFields = changedFields(earlierRecord, laterRecord, path === 'attempts');
        if (path === 'attempts') {
          const oldRun = earlierRecord.runTuple;
          const newRun = laterRecord.runTuple;
          if (canonical(oldRun) !== canonical(newRun)) {
            difference.suppliedRunIdentityChange = {
              earlier: oldRun,
              later: newRun,
              interpretation: 'SUPPLIED_IDENTITY_CHANGE_NOT_EXECUTION_EVIDENCE',
            };
          }
        }
        changed.push(difference);
      }
    }
  }

  const unmatched = (records, linked) => {
    for (const record of records) {
      const wrapped = wrap(record, linked);
      if (linked === earlierLinked) removed.push({id: null, record: wrapped});
      else added.push({id: null, record: wrapped});
    }
  };
  unmatched(left.unkeyed, earlierLinked);
  unmatched(right.unkeyed, laterLinked);
  const malformedEarlier = !Array.isArray(earlierCollection.value);
  const malformedLater = !Array.isArray(laterCollection.value);

  return {
    added,
    removed,
    changed,
    ambiguous,
    collectionShape: {
      earlier: Array.isArray(earlierCollection.value) ? null : stableValue(earlierCollection.value),
      later: Array.isArray(laterCollection.value) ? null : stableValue(laterCollection.value),
      changed: malformedEarlier || malformedLater
        ? canonical(earlierCollection.value) !== canonical(laterCollection.value)
        : false,
    },
  };
}

function findAliases(ledger, collectionPath, identityField, aliasKey, code) {
  const {records} = recordsFor(ledger, collectionPath);
  const groups = new Map();
  for (const record of records) {
    const key = aliasKey(record);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, recordsInGroup]) => recordsInGroup.length > 1)
    .map(([identity, recordsInGroup]) => ({
      code,
      collection: collectionPath,
      identity,
      records: recordsInGroup.sort((a, b) => compareText(canonical(a), canonical(b))),
      identityField,
    }))
    .sort((a, b) => compareText(a.identity, b.identity));
}

function findDuplicateIdentities(ledger, collectionPath, identityField) {
  const {records} = recordsFor(ledger, collectionPath);
  const groups = new Map();
  for (const record of records) {
    const key = identityKey(record, identityField);
    if (key === null) continue;
    const group = groups.get(key) ?? {id: record[identityField], records: []};
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.records.length > 1)
    .map((group) => ({
      code: 'DUPLICATE_RECORD_IDENTITY',
      collection: collectionPath,
      identityField,
      identity: group.id,
      records: group.records.sort((a, b) => compareText(canonical(a), canonical(b))),
    }))
    .sort((a, b) => compareText(canonical(a.identity), canonical(b.identity)));
}

function runAliasKey(record) {
  const tuple = runTuple(record);
  if (!tuple || typeof tuple.provider !== 'string' || !tuple.provider
    || typeof tuple.runId !== 'string' || !tuple.runId
    || !(tuple.runAttempt === 'UNKNOWN' || Number.isSafeInteger(tuple.runAttempt))) return null;
  return canonical(tuple);
}

function declarations(ledger) {
  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return {unstructuredLedger: ledger};
  }
  const excluded = new Set([
    'sources', 'attempts', 'resultRecords', 'nonEmpiricalRecords', 'proposedProtocol',
    'coverage', 'budget', 'reportedCounts',
  ]);
  return Object.fromEntries(Object.keys(ledger).filter((key) => !excluded.has(key))
    .sort(compareText).map((key) => [key, ledger[key]]));
}

function changedClaim(earlier, later) {
  return {
    earlier: stableValue(earlier),
    later: stableValue(later),
    changed: canonical(earlier) !== canonical(later),
  };
}

function assertOutputBound(result) {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, 'utf8') > COMPARISON_LIMITS.outputBytes) {
    throw invalid('OUTPUT_BYTE_LIMIT_EXCEEDED');
  }
  return result;
}

export function compareTrialLedgers(envelope) {
  const {earlier, later} = snapshotEnvelope(envelope);
  const earlierValidation = validateTrialLedger(earlier);
  const laterValidation = validateTrialLedger(later);
  const earlierLinked = resultIdentitiesByAttempt(earlier);
  const laterLinked = resultIdentitiesByAttempt(later);
  const collections = Object.fromEntries(COLLECTIONS.map(([path, identityField, outputKey]) => [
    outputKey,
    compareRecords(path, identityField, earlier, later, earlierLinked, laterLinked),
  ]));
  const findings = [
    ...COLLECTIONS.flatMap(([path, identityField]) => [
      ...findDuplicateIdentities(earlier, path, identityField).map((finding) => ({side: 'earlier', ...finding})),
      ...findDuplicateIdentities(later, path, identityField).map((finding) => ({side: 'later', ...finding})),
    ]),
    ...findAliases(earlier, 'attempts', 'attemptId', runAliasKey, 'AMBIGUOUS_RUN_IDENTITY')
      .map((finding) => ({side: 'earlier', ...finding})),
    ...findAliases(later, 'attempts', 'attemptId', runAliasKey, 'AMBIGUOUS_RUN_IDENTITY')
      .map((finding) => ({side: 'later', ...finding})),
    ...findAliases(earlier, 'resultRecords', 'resultRecordId', (record) => (
      typeof record?.resultIdentity === 'string' && record.resultIdentity
        ? `resultIdentity:${canonical(record.resultIdentity)}`
        : null
    ), 'AMBIGUOUS_RESULT_IDENTITY').map((finding) => ({side: 'earlier', ...finding})),
    ...findAliases(later, 'resultRecords', 'resultRecordId', (record) => (
      typeof record?.resultIdentity === 'string' && record.resultIdentity
        ? `resultIdentity:${canonical(record.resultIdentity)}`
        : null
    ), 'AMBIGUOUS_RESULT_IDENTITY').map((finding) => ({side: 'later', ...finding})),
  ].sort((a, b) => compareText(`${a.side}:${a.code}:${a.identity}`, `${b.side}:${b.code}:${b.identity}`));

  const earlierProtocol = getPath(earlier, 'proposedProtocol');
  const laterProtocol = getPath(later, 'proposedProtocol');
  const earlierCoverage = getPath(earlier, 'coverage');
  const laterCoverage = getPath(later, 'coverage');
  const earlierBudget = getPath(earlier, 'budget');
  const laterBudget = getPath(later, 'budget');
  const result = {
    status: earlierValidation.valid && laterValidation.valid ? 'COMPARED' : 'INVALID',
    validation: {earlier: earlierValidation, later: laterValidation},
    differences: {
      ...collections,
      declarations: changedClaim(declarations(earlier), declarations(later)),
      proposedProtocol: changedClaim(earlierProtocol, laterProtocol),
      coverage: changedClaim(earlierCoverage, laterCoverage),
      budget: {
        earlier: {
          submitted: stableValue(earlierBudget),
          validationRemainingBudget: earlierValidation.remainingBudget,
          arithmeticConsistency: typeof earlierBudget?.remaining === 'number'
            && typeof earlierValidation.remainingBudget === 'number'
            ? (earlierBudget.remaining === earlierValidation.remainingBudget ? 'CONSISTENT' : 'INCONSISTENT')
            : 'UNRESOLVED',
        },
        later: {
          submitted: stableValue(laterBudget),
          validationRemainingBudget: laterValidation.remainingBudget,
          arithmeticConsistency: typeof laterBudget?.remaining === 'number'
            && typeof laterValidation.remainingBudget === 'number'
            ? (laterBudget.remaining === laterValidation.remainingBudget ? 'CONSISTENT' : 'INCONSISTENT')
            : 'UNRESOLVED',
        },
        changed: canonical(earlierBudget) !== canonical(laterBudget)
          || canonical(earlierValidation.remainingBudget) !== canonical(laterValidation.remainingBudget),
      },
      reportedCounts: changedClaim(earlier?.reportedCounts, later?.reportedCounts),
    },
    findings,
    executionAuthorized: false,
    completenessCertified: false,
    provenanceVerified: false,
    autoPromotion: false,
  };
  return assertOutputBound(result);
}

async function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > COMPARISON_LIMITS.combinedBytes) throw invalid('COMBINED_BYTE_LIMIT_EXCEEDED');
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
      const envelope = JSON.parse(await readBoundedStdin());
      if (!envelope.earlier || Array.isArray(envelope.earlier) || typeof envelope.earlier !== 'object'
        || !envelope.later || Array.isArray(envelope.later) || typeof envelope.later !== 'object') {
        throw invalid('CLI_REQUIRES_FULL_LEDGER_OBJECTS');
      }
      const audit = compareTrialLedgers(envelope);
      process.stdout.write(`${JSON.stringify(audit)}\n`);
    } catch {
      process.stderr.write('Invalid comparison input; no audit was produced.\n');
      process.exitCode = 1;
    }
  })();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
