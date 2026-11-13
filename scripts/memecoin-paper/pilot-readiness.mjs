import {createHash} from "node:crypto";
import {closeSync, fstatSync, openSync, readSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {NETWORK_ENABLED} from "./adapters.mjs";
import {canonicalCheckpointBytes} from "./checkpoint-store.mjs";
import {PAPER_LEDGER_POLICY} from "./ledger.mjs";

export const MAX_READINESS_PACKET_BYTES = 262_144;
const MAX_NODES = 20_000;
const MAX_DEPTH = 32;
const MAX_STRING_LENGTH = 4096;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const EVIDENCE_NAMES = Object.freeze([
  "provider",
  "clock",
  "storage",
  "host",
  "costModel",
  "stopProcedure",
  "reportProcedure",
  "independentReview"
]);
const ROOT_KEYS = new Set([
  "schemaVersion",
  "evaluatedAt",
  "codeCommit",
  "configurationSha256",
  "candidateIdentitySha256",
  "manifest",
  "candidateIdentities",
  "operationalEvidence",
  "candidateDataGates"
]);
const UNAVAILABLE_CANDIDATE_EVIDENCE = new Set([
  "concentration",
  "developer",
  "bundle",
  "smartWallet"
]);

function copyBounded(value, budget = {nodes: 0}, depth = 0) {
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES || depth > MAX_DEPTH) {
    throw new TypeError("readiness packet exceeds its structural bound");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) throw new TypeError("readiness packet string is oversized");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("readiness packet contains an unsafe number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (value.length > 2000 || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError("readiness packet array is sparse or oversized");
    }
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError("readiness packet contains an array accessor");
      }
      result.push(copyBounded(descriptor.value, budget, depth + 1));
    }
    return result;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("readiness packet must contain plain JSON data");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256 || keys.some(key => typeof key !== "string" ||
      key === "__proto__" || key === "constructor" || key === "prototype")) {
    throw new TypeError("readiness packet object is oversized or has unsafe keys");
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("readiness packet contains an accessor or hidden field");
    }
    Object.defineProperty(result, key, {
      value: copyBounded(descriptor.value, budget, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return result;
}

function hash(value) {
  return createHash("sha256").update(canonicalCheckpointBytes(value)).digest("hex");
}

function hasOnlyKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.has(key));
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function validTime(value) {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

function addUnsetOrInvalid(blockers, label, value, valid) {
  if (!hasValue(value)) blockers.push(`${label}:UNSET`);
  else if (!valid(value)) blockers.push(`${label}:INVALID`);
}

function validateManifest(manifest, evaluatedAt, blockers) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    blockers.push("manifest:UNSET");
    return {providers: [], limits: null};
  }
  if (manifest.manifestVersion !== "memecoin-paper-one-shot-v1" ||
      manifest.mode !== "READ_ONLY_PAPER" || manifest.execution !== "SIMULATED_ONLY") {
    blockers.push("manifest:INVALID_MODE_OR_VERSION");
  }
  if (manifest.enabled !== false) blockers.push("manifest:NOT_DISABLED");
  if (manifest.stopSwitch?.engaged !== true) blockers.push("manifest:STOP_SWITCH_NOT_ENGAGED");
  if (manifest.syntheticFixturesMayNotMixWithRealScans !== true) {
    blockers.push("manifest:SYNTHETIC_REAL_SEPARATION_NOT_PINNED");
  }
  if (manifest.durationMs !== EIGHT_HOURS_MS) blockers.push("manifest:DURATION_NOT_EXACTLY_EIGHT_HOURS");
  for (const [field, valid] of [
    ["runId", value => typeof value === "string" && SAFE_ID.test(value)],
    ["startAt", validTime],
    ["endAt", validTime]
  ]) {
    addUnsetOrInvalid(blockers, `manifest.${field}`, manifest[field], valid);
  }
  if (validTime(manifest.startAt) && validTime(manifest.endAt) &&
      manifest.endAt - manifest.startAt !== EIGHT_HOURS_MS) {
    blockers.push("manifest:WINDOW_NOT_EXACTLY_EIGHT_HOURS");
  }
  if (validTime(manifest.endAt) && manifest.endAt <= evaluatedAt) {
    blockers.push("manifest:RUN_WINDOW_EXPIRED");
  }
  if (!Array.isArray(manifest.allowedMints) || manifest.allowedMints.length === 0) {
    blockers.push("manifest.allowedMints:UNSET");
  } else if (manifest.allowedMints.some(mint => typeof mint !== "string" || !BASE58.test(mint)) ||
      new Set(manifest.allowedMints).size !== manifest.allowedMints.length) {
    blockers.push("manifest.allowedMints:INVALID");
  }
  if (!Array.isArray(manifest.allowedPools) || manifest.allowedPools.length === 0) {
    blockers.push("manifest.allowedPools:UNSET");
  } else if (manifest.allowedPools.some(pool => typeof pool !== "string" || !BASE58.test(pool)) ||
      new Set(manifest.allowedPools).size !== manifest.allowedPools.length) {
    blockers.push("manifest.allowedPools:INVALID");
  }
  if (manifest.restartPolicy !== "UNRECOVERABLE_FAIL_CLOSED") {
    blockers.push("manifest.restartPolicy:UNSET_OR_UNREVIEWED");
  } else {
    blockers.push("manifest.restartPolicy:RESTART_NOT_AUTHORIZED");
  }
  blockers.push("manifest:REQUEST_TIMEOUT_NOT_CONFIGURED");
  blockers.push("manifest:RUN_WATCHDOG_NOT_IMPLEMENTED");

  const providers = Array.isArray(manifest.providers) ? manifest.providers : [];
  if (providers.length === 0 || providers.some(provider =>
    !provider || typeof provider.name !== "string" ||
    !/^[A-Za-z0-9 ._-]{1,120}$/.test(provider.name) ||
    typeof provider.host !== "string" || !/^[a-z0-9.-]{1,253}$/i.test(provider.host) ||
    typeof provider.enabled !== "boolean")) {
    blockers.push("manifest.providers:UNSET_OR_INVALID");
  }
  if (providers.some(provider => provider?.enabled !== true)) {
    blockers.push("manifest.providers:PROVIDER_DISABLED");
  }
  const limits = manifest.pollBudget;
  const limitKeys = [
    "intervalMs", "maxRequestsPerRun", "maxRequestsPerProvider",
    "maxBytesPerResponse", "maxBytesPerRun", "maxEvents", "maxCandidates"
  ];
  if (!limits || typeof limits !== "object" ||
      limitKeys.some(key => !Number.isSafeInteger(limits[key]) || limits[key] <= 0)) {
    blockers.push("manifest.pollBudget:UNSET_OR_INVALID");
  } else if (limits.maxRequestsPerProvider > limits.maxRequestsPerRun ||
      limits.maxBytesPerResponse > limits.maxBytesPerRun) {
    blockers.push("manifest.pollBudget:INCONSISTENT");
  }
  if (manifest.http?.redirects !== "error" || manifest.http?.credentials !== false ||
      manifest.http?.arbitraryUrls !== false || manifest.http?.tokenProvidedUrls !== false) {
    blockers.push("manifest.http:RESTRICTIONS_MISSING");
  }
  return {
    providers: providers.filter(provider => provider && typeof provider.name === "string" &&
      /^[A-Za-z0-9 ._-]{1,120}$/.test(provider.name) &&
      typeof provider.host === "string" && /^[a-z0-9.-]{1,253}$/i.test(provider.host))
      .map(provider => ({name: provider.name, host: provider.host})),
    limits: limits && typeof limits === "object" &&
      limitKeys.every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0)
      ? Object.fromEntries(limitKeys.map(key => [key, limits[key]])) : null
  };
}

function inspectEvidence(name, evidence, context, evaluatedAt) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return {status: "UNSET", blocker: `${name}:UNSET`};
  }
  if (!hasOnlyKeys(evidence, new Set([
    "status", "kind", "source", "observedAt", "expiresAt", "binding"
  ]))) {
    return {status: "INVALID", blocker: `${name}:UNKNOWN_FIELDS`};
  }
  if (!hasValue(evidence.status)) return {status: "UNSET", blocker: `${name}:UNSET`};
  if (!["VERIFIED", "UNKNOWN", "UNSET"].includes(evidence.status)) {
    return {status: "INVALID", blocker: `${name}:INVALID_STATUS_OR_KIND`};
  }
  if (evidence.status === "UNSET" || evidence.status === "UNKNOWN") {
    return {status: evidence.status, blocker: `${name}:${evidence.status}`};
  }
  if (!hasValue(evidence.kind)) return {status: "UNKNOWN", blocker: `${name}:EVIDENCE_KIND_UNKNOWN`};
  if (!["OBSERVED", "SYNTHETIC", "UNKNOWN"].includes(evidence.kind)) {
    return {status: "INVALID", blocker: `${name}:INVALID_STATUS_OR_KIND`};
  }
  if (evidence.kind === "SYNTHETIC") {
    return {status: "SYNTHETIC", blocker: `${name}:SYNTHETIC_EVIDENCE_NOT_OPERATIONAL`};
  }
  if (typeof evidence.source !== "string" || !evidence.source.trim() ||
      !validTime(evidence.observedAt) || !validTime(evidence.expiresAt)) {
    return {status: "UNKNOWN", blocker: `${name}:SOURCE_OR_TIME_UNKNOWN`};
  }
  if (evidence.observedAt > evaluatedAt || evidence.expiresAt < evaluatedAt) {
    return {status: "STALE", blocker: `${name}:STALE_OR_FUTURE_EVIDENCE`};
  }
  const binding = evidence.binding;
  if (!binding) return {status: "UNKNOWN", blocker: `${name}:IDENTITY_BINDING_UNKNOWN`};
  if (!hasOnlyKeys(binding, new Set([
    "codeCommit", "configurationSha256", "candidateIdentitySha256", "runId"
  ]))) {
    return {status: "INVALID", blocker: `${name}:INVALID_BINDING`};
  }
  if (!binding || binding.codeCommit !== context.codeCommit ||
      binding.configurationSha256 !== context.configurationSha256 ||
      binding.candidateIdentitySha256 !== context.candidateIdentitySha256 ||
      binding.runId !== context.runId) {
    return {status: "MISMATCH", blocker: `${name}:IDENTITY_MISMATCH`};
  }
  return {status: "ASSERTED_VERIFIED", blocker: null};
}

function invalidReport(errors) {
  const blockers = errors.slice(0, 20);
  return {
    reportType: "MEMECOIN_PAPER_PILOT_READINESS_ONLY",
    inputStatus: "INVALID",
    readinessOnly: true,
    executionStarted: false,
    dimensions: {
      SOURCE_READY: {status: "BLOCKED", ready: false, blockers},
      OPERATIONALLY_VERIFIED: {
        status: "NOT_ESTABLISHED",
        verified: false,
        blockers
      },
      RUN_AUTHORIZED: {
        status: "NOT_AUTHORIZED",
        authorized: false,
        blockers: ["This offline projection never authorizes or starts a run."]
      }
    },
    caveat: "Invalid input. Readiness projection only; no execution, provider access, or authorization."
  };
}

function project(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalidReport(["root:OBJECT_REQUIRED"]);
  }
  for (const key of Object.keys(input)) {
    if (!ROOT_KEYS.has(key)) errors.push(`root.${key}:UNKNOWN_FIELD`);
  }
  if (input.schemaVersion !== "memecoin-paper-pilot-readiness-v1") {
    errors.push("schemaVersion:UNSUPPORTED");
  }
  if (!Number.isSafeInteger(input.evaluatedAt) ||
      !Number.isFinite(new Date(input.evaluatedAt).getTime())) {
    errors.push("evaluatedAt:EXPLICIT_INTEGER_MILLISECONDS_REQUIRED");
  }
  if (!input.manifest || typeof input.manifest !== "object" || Array.isArray(input.manifest)) {
    errors.push("manifest:OBJECT_REQUIRED");
  }
  if (!Array.isArray(input.candidateIdentities)) errors.push("candidateIdentities:ARRAY_REQUIRED");
  if (!input.operationalEvidence || typeof input.operationalEvidence !== "object" ||
      Array.isArray(input.operationalEvidence)) errors.push("operationalEvidence:OBJECT_REQUIRED");
  if (!Array.isArray(input.candidateDataGates)) errors.push("candidateDataGates:ARRAY_REQUIRED");
  if (errors.length) return invalidReport(errors);

  const sourceBlockers = [];
  const operationalBlockers = [];
  const evaluatedAt = input.evaluatedAt;
  addUnsetOrInvalid(sourceBlockers, "codeCommit", input.codeCommit,
    value => typeof value === "string" && SHA1.test(value));
  const manifestInfo = validateManifest(input.manifest, evaluatedAt, operationalBlockers);

  let actualConfigurationSha256 = null;
  try {
    actualConfigurationSha256 = hash(input.manifest);
  } catch {
    errors.push("manifest:CANONICAL_HASH_FAILED");
  }
  if (!hasValue(input.configurationSha256)) {
    sourceBlockers.push("configurationSha256:UNSET");
  } else if (!SHA256.test(input.configurationSha256) ||
      input.configurationSha256 !== actualConfigurationSha256) {
    errors.push("configurationSha256:MISMATCH");
  }

  const identities = input.candidateIdentities;
  const normalizedIdentities = [];
  const seenMints = new Set();
  for (const [index, identity] of identities.entries()) {
    if (!identity || typeof identity !== "object" || Array.isArray(identity) ||
        !hasOnlyKeys(identity, new Set(["chainId", "mint", "pool", "quote"])) ||
        identity.chainId !== "solana" || !BASE58.test(identity.mint ?? "") ||
        !BASE58.test(identity.pool ?? "") || !BASE58.test(identity.quote ?? "")) {
      errors.push(`candidateIdentities[${index}]:INVALID_IDENTITY`);
      continue;
    }
    if (seenMints.has(identity.mint)) errors.push(`candidateIdentities[${index}]:DUPLICATE_MINT`);
    seenMints.add(identity.mint);
    normalizedIdentities.push({
      chainId: identity.chainId,
      mint: identity.mint,
      pool: identity.pool,
      quote: identity.quote
    });
  }
  if (normalizedIdentities.length === 0) sourceBlockers.push("candidateIdentities:UNSET");
  const actualCandidateHash = hash(normalizedIdentities);
  if (!hasValue(input.candidateIdentitySha256)) {
    sourceBlockers.push("candidateIdentitySha256:UNSET");
  } else if (!SHA256.test(input.candidateIdentitySha256) ||
      input.candidateIdentitySha256 !== actualCandidateHash) {
    errors.push("candidateIdentitySha256:MISMATCH");
  }
  if (Array.isArray(input.manifest.allowedMints) && Array.isArray(input.manifest.allowedPools) &&
      normalizedIdentities.length > 0) {
    const sameSet = (left, right) => {
      if (left.length !== right.length) return false;
      const sortedLeft = [...left].sort();
      const sortedRight = [...right].sort();
      return sortedLeft.every((value, index) => value === sortedRight[index]);
    };
    if (!sameSet(input.manifest.allowedMints, normalizedIdentities.map(item => item.mint)) ||
        !sameSet(input.manifest.allowedPools, normalizedIdentities.map(item => item.pool))) {
      errors.push("candidateIdentities:MANIFEST_ALLOWLIST_MISMATCH");
    }
  }
  if (errors.length) return invalidReport(errors);

  if (!NETWORK_ENABLED) sourceBlockers.push("realDataAdapter:NOT_IMPLEMENTED_NETWORK_DISABLED");
  if (input.manifest.enabled === false) {
    operationalBlockers.push("manifest:DISABLED_NOT_STARTABLE");
  }
  if (input.manifest.stopSwitch?.engaged === true) {
    operationalBlockers.push("manifest:OWNER_STOP_SWITCH_REMAINS_ENGAGED");
  }

  const context = {
    codeCommit: input.codeCommit ?? null,
    configurationSha256: actualConfigurationSha256,
    candidateIdentitySha256: actualCandidateHash,
    runId: input.manifest.runId ?? null
  };
  const evidenceStatuses = {};
  for (const name of EVIDENCE_NAMES) {
    const result = inspectEvidence(name, input.operationalEvidence[name], context, evaluatedAt);
    evidenceStatuses[name] = result.status;
    if (result.blocker) operationalBlockers.push(result.blocker);
  }
  for (const name of Object.keys(input.operationalEvidence)) {
    if (!EVIDENCE_NAMES.includes(name)) errors.push(`operationalEvidence.${name}:UNKNOWN_FIELD`);
  }
  if (errors.length) return invalidReport(errors);

  const candidateGateResults = [];
  for (const [index, gate] of input.candidateDataGates.entries()) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate) ||
        !hasOnlyKeys(gate, new Set(["mint", "pool", "filterStatus", "unavailableEvidence"])) ||
        !BASE58.test(gate.mint ?? "") || !BASE58.test(gate.pool ?? "") ||
        !["PASS", "REJECT", "UNKNOWN"].includes(gate.filterStatus) ||
        !Array.isArray(gate.unavailableEvidence) ||
        gate.unavailableEvidence.some(item => !UNAVAILABLE_CANDIDATE_EVIDENCE.has(item))) {
      errors.push(`candidateDataGates[${index}]:INVALID`);
      continue;
    }
    const identity = normalizedIdentities.find(item => item.mint === gate.mint && item.pool === gate.pool);
    if (!identity) {
      errors.push(`candidateDataGates[${index}]:IDENTITY_NOT_ALLOWLISTED`);
      continue;
    }
    candidateGateResults.push({
      mint: gate.mint,
      pool: gate.pool,
      filterStatus: gate.filterStatus,
      unavailableEvidence: [...new Set(gate.unavailableEvidence)],
      entryDisposition: gate.filterStatus === "PASS"
        ? "FILTER_PASS_ASSERTED_ONLY_NOT_ENTRY_AUTHORITY"
        : "ENTRY_BLOCKED_BY_EXISTING_FILTER_CONTRACT"
    });
  }
  if (errors.length) return invalidReport(errors);

  const risk = PAPER_LEDGER_POLICY;
  const limitProfile = {
    initialVirtualUsd: (BigInt(risk.initialCapitalCents) / 100n).toString(),
    initialCapitalCents: risk.initialCapitalCents,
    maxEntryUsd: (BigInt(risk.maxEntryCents) / 100n).toString(),
    maxEntryPercentOfMarkedEquity:
      (BigInt(risk.maxEntryCents) * 100n / BigInt(risk.initialCapitalCents)).toString(),
    maxOpenPositions: risk.maxOpenPositions,
    initialStopPercent: risk.initialStopBps / 100,
    trailingStopPercent: risk.trailingDistanceBps / 100,
    trailingActivationPercent: risk.trailingActivationBps / 100,
    dailyLossUsd: (BigInt(risk.dailyLossLimitCents) / 100n).toString(),
    timezone: risk.timezone,
    windowMs: EIGHT_HOURS_MS
  };
  const sourceReady = sourceBlockers.length === 0;
  const operationUnique = [...new Set(operationalBlockers)];
  return {
    reportType: "MEMECOIN_PAPER_PILOT_READINESS_ONLY",
    inputStatus: "VALID",
    readinessOnly: true,
    executionStarted: false,
    provenance: "CALLER_SUPPLIED_LOCAL_ASSERTIONS_NOT_AUTHENTICATED",
    evaluatedAt,
    identities: {
      codeCommit: !hasValue(input.codeCommit) ? "UNSET"
        : typeof input.codeCommit === "string" && SHA1.test(input.codeCommit)
          ? input.codeCommit : "INVALID",
      configurationSha256: !hasValue(input.configurationSha256) ? "UNSET"
        : input.configurationSha256,
      candidateIdentitySha256: !hasValue(input.candidateIdentitySha256) ? "UNSET"
        : input.candidateIdentitySha256,
      runId: !hasValue(input.manifest.runId) ? "UNSET"
        : typeof input.manifest.runId === "string" && SAFE_ID.test(input.manifest.runId)
          ? input.manifest.runId : "INVALID",
      startAt: !hasValue(input.manifest.startAt) ? "UNSET"
        : Number.isSafeInteger(input.manifest.startAt) ? input.manifest.startAt : "INVALID",
      endAt: !hasValue(input.manifest.endAt) ? "UNSET"
        : Number.isSafeInteger(input.manifest.endAt) ? input.manifest.endAt : "INVALID"
    },
    limitProfile,
    configuredProviders: manifestInfo.providers,
    configuredPollBudget: manifestInfo.limits,
    operationalEvidence: evidenceStatuses,
    candidateDataGates: candidateGateResults,
    candidateDataInterpretation:
      "Unavailable concentration, developer, bundle, or smart-wallet evidence blocks that candidate. A bounded observation can produce zero entries; zero entries do not establish profitability.",
    dimensions: {
      SOURCE_READY: {
        status: sourceReady ? "SOURCE_CONFIGURATION_COMPLETE" : "BLOCKED",
        ready: sourceReady,
        blockers: sourceBlockers
      },
      OPERATIONALLY_VERIFIED: {
        status: operationUnique.length === 0
          ? "ASSERTED_COMPLETE_NOT_INDEPENDENTLY_VERIFIED" : "BLOCKED",
        verified: false,
        blockers: operationUnique,
        limitation: "This offline projection cannot authenticate host, provider, clock, durability, cost, or reviewer claims."
      },
      RUN_AUTHORIZED: {
        status: "NOT_AUTHORIZED",
        authorized: false,
        blockers: ["Separate owner authorization and an implemented run/stop procedure are absent."]
      }
    },
    caveat: "Readiness projection only. No execution, network/provider access, wallet/order access, or authorization."
  };
}

export function projectPilotReadiness(input) {
  let safeInput;
  try {
    safeInput = copyBounded(input);
    if (Buffer.byteLength(JSON.stringify(safeInput), "utf8") > MAX_READINESS_PACKET_BYTES) {
      return invalidReport(["packet:OVERSIZED"]);
    }
  } catch (error) {
    return invalidReport([error instanceof Error ? error.message : "packet:INVALID"]);
  }
  return project(safeInput);
}

function readPacket(filename) {
  const file = path.resolve(filename);
  const descriptor = openSync(file, "r");
  try {
    if (!fstatSync(descriptor).isFile() || fstatSync(descriptor).size > MAX_READINESS_PACKET_BYTES) {
      throw new TypeError("readiness packet file is oversized or not a regular file");
    }
    const buffer = Buffer.alloc(MAX_READINESS_PACKET_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_READINESS_PACKET_BYTES) throw new TypeError("readiness packet file is oversized");
    return JSON.parse(buffer.subarray(0, length).toString("utf8"));
  } finally {
    closeSync(descriptor);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new TypeError("usage: node pilot-readiness.mjs <local-readiness-packet.json>");
    const report = projectPilotReadiness(readPacket(process.argv[2]));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.inputStatus !== "VALID") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "readiness packet could not be read"}\n`);
    process.exitCode = 2;
  }
}
