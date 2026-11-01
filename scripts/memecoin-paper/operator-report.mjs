const REPORT_TYPE = "MEMECOIN_PAPER_OPERATOR_REPORT_V1";
const INPUT_LIMIT_BYTES = 1_048_576;
const OUTPUT_LIMIT_BYTES = 262_144;
const MAX_NODES = 50_000;
const MAX_ROWS = 1_000;
const MAX_TEXT = 240;
const MAX_AMOUNT_DIGITS = 128;
const SAFE_RECEIPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const RECEIPT_METHODS = new Set([
  "authorizeEntry", "executeEntry", "observeExitQuote", "riskSnapshot", "finishRun"
]);
const LEDGER_EVENT_TYPES = new Set([
  "RISK_RESERVATION_RELEASED", "LOCAL_DAY_OPEN", "RISK_AUTHORIZED", "STOP_ARMED",
  "PAPER_FILL", "PAPER_EXIT", "RISK_MARK", "RUN_FINISHED"
]);
const COST_FIELDS = Object.freeze([
  "feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"
]);
const REPORT_SOURCES = new Set([
  "SYNTHETIC_FIXTURE_REPLAY_ONLY",
  "SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY"
]);
const CLOCK_REASONS = new Set([
  "CLOCK_FAULT_LATCHED", "CLOCK_RESTART_BLOCKED", "CLOCK_SOURCE_MISMATCH",
  "CLOCK_SAMPLE_INVALID", "CLOCK_REGRESSION", "CLOCK_SKEW_EXCEEDED",
  "CLOCK_GAP_EXCEEDED", "CLOCK_TIME_MISMATCH", "CLOCK_OVERFLOW"
]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value instanceof Map || value instanceof Set) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function quotedStringBytes(value) {
  if (Buffer.byteLength(value) > INPUT_LIMIT_BYTES) throw new TypeError("report input exceeds 1 MiB");
  return Buffer.byteLength(JSON.stringify(value));
}

function inputBytes(value) {
  const seen = new Set();
  let nodes = 0;
  let bytes = 0;
  const visit = (item, depth) => {
    if (++nodes > MAX_NODES || depth > 24) throw new TypeError("report input exceeds structural limits");
    if (item === null || typeof item === "boolean") {
      bytes += item === null ? 4 : 5;
    } else if (typeof item === "string") {
      bytes += quotedStringBytes(item);
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("report input contains a non-finite number");
      bytes += Buffer.byteLength(JSON.stringify(item));
    } else if (typeof item === "bigint") {
      bytes += Buffer.byteLength(JSON.stringify(item.toString()));
    } else if (Array.isArray(item)) {
      if (seen.has(item)) throw new TypeError("report input must not be cyclic");
      seen.add(item);
      if (item.length > MAX_NODES || Reflect.ownKeys(item).some(key =>
        key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) ||
          Number(key) >= item.length))) {
        throw new TypeError("report input contains an unsupported array property");
      }
      bytes += 2;
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !("value" in descriptor)) throw new TypeError("report input contains an unsupported array value");
        visit(descriptor.value, depth + 1);
        bytes += index === 0 ? 0 : 1;
      }
      seen.delete(item);
    } else if (item instanceof Map || item instanceof Set) {
      if (seen.has(item)) throw new TypeError("report input must not be cyclic");
      seen.add(item);
      bytes += 2;
      if (item.size > MAX_ROWS || Reflect.ownKeys(item).length) {
        throw new TypeError("report input contains an oversized or decorated collection");
      }
      const values = item instanceof Map ? [...item.entries()] : [...item.values()];
      values.forEach((value, index) => {
        if (item instanceof Map) {
          visit(value[0], depth + 1);
          bytes += 1;
          visit(value[1], depth + 1);
        } else {
          visit(value, depth + 1);
        }
        bytes += index === 0 ? 0 : 1;
      });
      seen.delete(item);
    } else if (isRecord(item)) {
      if (seen.has(item)) throw new TypeError("report input must not be cyclic");
      seen.add(item);
      bytes += 2;
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => typeof key !== "string")) throw new TypeError("report input contains an unsupported key");
      keys.sort();
      keys.forEach((key, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError("report input contains an unsupported property");
        }
        bytes += quotedStringBytes(key) + 1;
        visit(descriptor.value, depth + 1);
        bytes += index === 0 ? 0 : 1;
      });
      seen.delete(item);
    } else {
      throw new TypeError("report input must contain only snapshot data");
    }
    if (bytes > INPUT_LIMIT_BYTES) throw new TypeError("report input exceeds 1 MiB");
  };
  visit(value, 0);
  return bytes;
}

function cleanText(value, limit = MAX_TEXT) {
  if (typeof value !== "string") return null;
  return value.slice(0, limit * 4)
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "[escape]")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeId(value) {
  return cleanText(value, 120);
}

function timestamp(value) {
  const milliseconds = typeof value === "number" ? value :
    typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) return null;
  return new Date(milliseconds).toISOString();
}

function decimal(value, {signed = false} = {}) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "bigint" ? value.toString() : value;
  const expression = signed ? /^-?(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/;
  if (typeof text !== "string" || !expression.test(text) ||
      text.replace("-", "").length > MAX_AMOUNT_DIGITS) {
    throw new TypeError("report contains a non-exact or out-of-range decimal amount");
  }
  return text;
}

function countValue(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("report contains an invalid count");
  return value;
}

function listCoverage(observedTotal, total, sourceTruncated = null, unaccounted = null) {
  const observed = countValue(observedTotal);
  const knownTotal = countValue(total);
  return {
    observedTotal: observed,
    total: knownTotal,
    displayed: observed === null ? 0 : Math.min(observed, 40),
    displayTruncated: observed === null ? null : observed > 40,
    sourceTruncated,
    unaccounted: countValue(unaccounted) ??
      (observed !== null && knownTotal !== null ? Math.max(knownTotal - observed, 0) : null)
  };
}

function truncationFlag(...values) {
  if (values.includes(true)) return true;
  return values.length > 0 && values.every(value => value === false) ? false : null;
}

function stableValue(value) {
  if (typeof value === "bigint") return {$bigint: value.toString()};
  if (value instanceof Map) {
    return {$map: [...value.entries()].map(([key, item]) => [stableValue(key), stableValue(item)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])))};
  }
  if (value instanceof Set) {
    return {$set: [...value.values()].map(stableValue).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)))};
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function uniqueReceipts(receipts) {
  if (!Array.isArray(receipts) || receipts.length > MAX_ROWS) {
    throw new TypeError("checkpoint receipts must be a bounded array");
  }
  const byId = new Map();
  for (const receipt of receipts) {
    if (!isRecord(receipt) || typeof receipt.commandId !== "string" ||
        !SAFE_RECEIPT_ID.test(receipt.commandId) || !RECEIPT_METHODS.has(receipt.method) ||
        !Object.hasOwn(receipt, "result")) {
      throw new TypeError("checkpoint receipt is incomplete");
    }
    const signature = JSON.stringify(stableValue({
      method: receipt.method,
      result: receipt.result,
      resultDigest: receipt.resultDigest ?? null
    }));
    const previous = byId.get(receipt.commandId);
    if (previous && previous.signature !== signature) {
      throw new TypeError("conflicting duplicate checkpoint receipt");
    }
    if (!previous) byId.set(receipt.commandId, {signature, receipt});
  }
  return [...byId.values()].map(item => item.receipt);
}

function checkIdentity(report, runId, summary) {
  const statedId = report.experimentId ?? report.metadata?.runId ?? summary?.runId;
  if (statedId !== null && statedId !== undefined &&
      [report.experimentId, report.metadata?.runId, summary?.runId, runId]
        .some(value => value !== null && value !== undefined && value !== statedId)) {
    throw new TypeError("report contains mixed experiment identity");
  }
  return safeId(statedId);
}

function replayData(report) {
  const ledger = isRecord(report.ledger) ? report.ledger : {};
  const runEnd = isRecord(report.runEnd) ? report.runEnd : null;
  const audit = Array.isArray(report.audit) ? report.audit : [];
  if (audit.length > MAX_ROWS) throw new TypeError("replay audit exceeds row limits");
  if (report.discovery && Object.hasOwn(report.discovery, "truncated") &&
      typeof report.discovery.truncated !== "boolean") {
    throw new TypeError("replay discovery truncation state is invalid");
  }
  const scoutRows = audit.filter(row => row?.stage === "Scout");
  const selected = scoutRows.filter(row => row.status === "SELECTED");
  const startTimes = selected.map(row => timestamp(row.sampledAt)).filter(Boolean).sort();
  const startAt = startTimes[0] ?? null;
  let endAt = null;
  if (startAt && Number.isSafeInteger(runEnd?.elapsedMs) && runEnd.elapsedMs >= 0 &&
      runEnd.elapsedMs <= 8 * 60 * 60 * 1000) {
    endAt = timestamp(Date.parse(startAt) + runEnd.elapsedMs);
  }
  if (runEnd?.elapsedMs !== undefined && (!Number.isSafeInteger(runEnd.elapsedMs) ||
      runEnd.elapsedMs < 0 || runEnd.elapsedMs > 8 * 60 * 60 * 1000)) {
    throw new TypeError("replay time bounds are inconsistent");
  }
  if (startAt && endAt && selected.some(row => {
    const sampledAt = timestamp(row.sampledAt);
    return sampledAt && (sampledAt < startAt || sampledAt > endAt);
  })) throw new TypeError("replay candidates have mixed time identity");
  if (startAt && endAt) {
    const observedTimes = [
      ...Object.values(report.filters?.checks ?? {}).map(check => check?.observedAt),
      ...Object.values(report.analysis?.components ?? {}).map(check => check?.observedAt),
      ...audit.filter(event => event?.type === "RUN_FINISHED").map(event => event.observedAt)
    ].filter(value => value !== null && value !== undefined);
    for (const value of observedTimes) {
      const observedAt = timestamp(value);
      if (!observedAt || observedAt < startAt || observedAt > endAt) {
        throw new TypeError("replay evidence has mixed time identity");
      }
    }
  }
  return {
    variant: "replay",
    runId: ledger.runId,
    summary: ledger,
    runEnd,
    audit,
    auditPresent: Array.isArray(report.audit),
    results: [],
    metadata: null,
    discovery: isRecord(report.discovery) ? report.discovery : null,
    scoutRows,
    filter: isRecord(report.filters) ? report.filters : null,
    analysis: isRecord(report.analysis) ? report.analysis : null,
    source: report.source,
    sourceReady: report.realDataPreparation?.status === "BLOCKED" ? "BLOCKED" :
      report.liveCandidateEvidence === false ? "NOT_READY" : "UNKNOWN",
    discoveryTruncated: typeof report.discovery?.truncated === "boolean"
      ? report.discovery.truncated : null,
    auditTruncated: truncationFlag(report.auditTruncated, ledger.auditTruncated),
    replayAuditTruncated: typeof report.auditTruncated === "boolean"
      ? report.auditTruncated : null,
    ledgerAuditTruncated: typeof ledger.auditTruncated === "boolean"
      ? ledger.auditTruncated : null,
    startAt,
    endAt,
    complete: Boolean(runEnd && runEnd.status === "FINISHED"),
    fillEvidence: Object.hasOwn(report, "simulatedFill") ? [report.simulatedFill] : null
  };
}

function checkpointData(report) {
  const metadata = isRecord(report.metadata) ? report.metadata : null;
  const snapshot = isRecord(report.snapshot) ? report.snapshot : null;
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const results = uniqueReceipts(Array.isArray(report.results) ? report.results : []);
  if (metadata) {
    if (Object.hasOwn(metadata, "clockAdmissionBlocked") &&
        typeof metadata.clockAdmissionBlocked !== "boolean") {
      throw new TypeError("checkpoint clock state is invalid");
    }
    const sequence = countValue(metadata.sequence);
    if (sequence !== null && sequence !== results.length) {
      throw new TypeError("checkpoint receipt count does not match acknowledged sequence");
    }
    const startedAt = countValue(metadata.startedAt);
    const deadlineAt = countValue(metadata.deadlineAt);
    if (startedAt !== null && deadlineAt !== null &&
        deadlineAt !== startedAt + 8 * 60 * 60 * 1000) {
      throw new TypeError("checkpoint time bounds are inconsistent");
    }
  }
  const runId = metadata?.runId ?? summary.runId ?? null;
  const startAt = timestamp(metadata?.startedAt);
  const deadlineAt = timestamp(metadata?.deadlineAt);
  if (startAt && deadlineAt) {
    for (const receipt of results) {
      const result = isRecord(receipt.result) ? receipt.result : {};
      if (result.runId !== undefined && result.runId !== metadata?.runId) {
        throw new TypeError("checkpoint receipt has mixed experiment identity");
      }
      for (const key of ["sampledAt", "authorizedAt", "observedAt"]) {
        if (result[key] === null || result[key] === undefined) continue;
        const observedAt = timestamp(result[key]);
        if (!observedAt || observedAt < startAt || observedAt > deadlineAt) {
          throw new TypeError("checkpoint receipt has mixed time identity");
        }
      }
    }
  }
  const endReceipt = [...results].reverse().find(item => item.method === "finishRun");
  const runEnd = isRecord(endReceipt?.result) ? endReceipt.result : null;
  const endAt = startAt && Number.isSafeInteger(runEnd?.elapsedMs) && runEnd.elapsedMs >= 0 &&
    runEnd.elapsedMs <= 8 * 60 * 60 * 1000
    ? timestamp(Date.parse(startAt) + runEnd.elapsedMs) : null;
  if (runEnd?.elapsedMs !== undefined && (!Number.isSafeInteger(runEnd.elapsedMs) ||
      runEnd.elapsedMs < 0 || runEnd.elapsedMs > 8 * 60 * 60 * 1000)) {
    throw new TypeError("checkpoint result has inconsistent time bounds");
  }
  return {
    variant: "checkpoint",
    runId,
    summary,
    runEnd,
    audit: Array.isArray(snapshot?.auditEvents) ? snapshot.auditEvents : [],
    auditPresent: Array.isArray(snapshot?.auditEvents),
    results,
    metadata,
    discovery: null,
    scoutRows: [],
    filter: null,
    analysis: null,
    source: report.source,
    sourceReady: report.liveCandidateEvidence === false ? "NOT_READY" : "UNKNOWN",
    discoveryTruncated: null,
    auditTruncated: truncationFlag(summary.auditTruncated),
    replayAuditTruncated: null,
    ledgerAuditTruncated: typeof summary.auditTruncated === "boolean"
      ? summary.auditTruncated : null,
    startAt,
    endAt,
    complete: Boolean(runEnd && runEnd.status === "FINISHED"),
    fillEvidence: results
  };
}

function candidateOutcome(filter, analysis) {
  const filterStatus = filter?.status;
  const analysisStatus = analysis?.status;
  if (filterStatus === "REJECT" || analysisStatus === "REJECT") return "REJECT";
  if (filterStatus === "PASS" && analysisStatus === "PASS") return "ACCEPTED";
  if (!filter && !analysis) return "UNKNOWN";
  return "UNKNOWN";
}

function candidateReasons(filter, analysis) {
  const reasons = [];
  for (const [gate, check] of Object.entries(filter?.checks ?? {})) {
    if (check?.status && check.status !== "PASS") {
      reasons.push({
        gate: cleanText(gate, 80),
        status: cleanText(check.status, 32),
        reason: cleanText(check.reason),
        source: cleanText(check.source, 120),
        observedAt: timestamp(check.observedAt)
      });
    }
  }
  for (const [component, check] of Object.entries(analysis?.components ?? {})) {
    if (check?.status && check.status !== "PASS") {
      reasons.push({
        gate: cleanText(component, 80),
        status: cleanText(check.status, 32),
        reason: cleanText(check.reason),
        source: cleanText(check.source, 120),
        observedAt: timestamp(check.observedAt)
      });
    }
  }
  return reasons;
}

function checkpointCandidates(results) {
  const authorizations = results.filter(item => item.method === "authorizeEntry");
  if (!authorizations.length) return {
    considered: null, accepted: null, rejected: null, unknown: null,
    audited: 0, unaccountedObserved: null, discoveryTruncated: null,
    scoutAuditTruncated: null, details: [],
    basis: "authorization receipts absent; scan counts unavailable"
  };
  let accepted = 0;
  let rejected = 0;
  let unknown = 0;
  const details = [];
  const identityByMint = new Map();
  for (const receipt of authorizations) {
    const result = isRecord(receipt.result) ? receipt.result : {};
    const status = result.status === "AUTHORIZED" ? "ACCEPTED" :
      result.status === "REJECT" ? "REJECT" : "UNKNOWN";
    if (status === "ACCEPTED") {
      if (result.chainId !== "solana" || typeof result.mint !== "string" ||
          typeof result.pool !== "string" || typeof result.quote !== "string") {
        throw new TypeError("authorized candidate receipt has incomplete Solana identity");
      }
      const identity = JSON.stringify([result.chainId, result.pool, result.quote]);
      const previousIdentity = identityByMint.get(result.mint);
      if (previousIdentity && previousIdentity !== identity) {
        throw new TypeError("checkpoint receipts contain mixed pool identity");
      }
      identityByMint.set(result.mint, identity);
    }
    if (status === "ACCEPTED") accepted += 1;
    else if (status === "REJECT") rejected += 1;
    else unknown += 1;
    details.push({
      chainId: cleanText(result.chainId, 32),
      mint: cleanText(result.mint, 80),
      pool: cleanText(result.pool, 80),
      relatedPool: null,
      quote: cleanText(result.quote, 80),
      sampledAt: timestamp(result.sampledAt),
      status,
      reasons: status === "REJECT" ? [{
        gate: "authorization",
        status: "REJECT",
        reason: cleanText(result.reason),
        source: null,
        observedAt: timestamp(result.authorizedAt)
      }] : []
    });
  }
  return {
    considered: authorizations.length,
    accepted,
    rejected,
    unknown,
    audited: authorizations.length,
    unaccountedObserved: null,
    discoveryTruncated: null,
    scoutAuditTruncated: null,
    basis: "unique authorization receipts only; scout scan counts are not in this receipt",
    details
  };
}

function candidatesFor(data) {
  if (data.variant === "checkpoint") return checkpointCandidates(data.results);
  const rows = data.scoutRows;
  if (!data.discovery && rows.length === 0) return {
    considered: null, accepted: null, rejected: null, unknown: null,
    audited: 0, unaccountedObserved: null, discoveryTruncated: null,
    scoutAuditTruncated: null, details: [],
    basis: "candidate discovery receipt unavailable"
  };
  const observed = countValue(data.discovery?.observedRecords);
  const selected = rows.filter(row => row.status === "SELECTED");
  const scoutRejected = rows.filter(row => row.status === "REJECT");
  if (observed !== null && observed < rows.length) {
    throw new TypeError("scout audit exceeds its reported observation count");
  }
  if (selected.length > 1) {
    throw new TypeError("replay report has more candidate rows than its single-candidate contract");
  }
  const details = [];
  let accepted = 0;
  let rejected = scoutRejected.length;
  let unknown = 0;
  for (const row of scoutRejected) {
    details.push({
    chainId: cleanText(row.chainId, 32),
    mint: cleanText(row.mint, 80),
      pool: cleanText(row.selectedPool, 80),
      relatedPool: cleanText(row.duplicatePool, 80),
      quote: cleanText(row.quote, 80),
      sampledAt: timestamp(row.sampledAt),
      status: "REJECT",
      reasons: [{
        gate: "scout",
        status: "REJECT",
        reason: cleanText(row.reason),
        source: cleanText(row.source, 120),
        observedAt: timestamp(row.sampledAt)
      }]
    });
  }
  for (const row of selected) {
    const status = candidateOutcome(data.filter, data.analysis);
    if (status === "ACCEPTED") accepted += 1;
    else if (status === "REJECT") rejected += 1;
    else unknown += 1;
    details.push({
      chainId: cleanText(row.chainId, 32),
      mint: cleanText(row.mint, 80),
      pool: cleanText(row.selectedPool, 80),
      relatedPool: null,
      quote: cleanText(row.quote, 80),
      sampledAt: timestamp(row.sampledAt),
      status,
      reasons: candidateReasons(data.filter, data.analysis)
    });
  }
  const considered = observed;
  const unaccountedObserved = observed === null ? null : observed - rows.length;
  if (unaccountedObserved === 0 && !data.discovery?.truncated &&
      considered !== accepted + rejected + unknown) {
    throw new TypeError("candidate outcome counts are inconsistent");
  }
  return {
    considered,
    accepted,
    rejected,
    unknown,
    audited: rows.length,
    unaccountedObserved,
    discoveryTruncated: data.discovery?.truncated ?? null,
    scoutAuditTruncated: unaccountedObserved === null ? null : unaccountedObserved > 0,
    basis: "bounded Scout audit and reported Filter/Analyst outcomes",
    details
  };
}

function checkAmounts(summary, runEnd) {
  const accounting = isRecord(runEnd?.accounting) ? runEnd.accounting : null;
  const pnl = isRecord(summary?.pnl) ? summary.pnl : {};
  const pairs = [
    [summary.cashCents, accounting?.cashCents],
    [pnl.realizedGrossCents, accounting?.realizedGrossPnlCents],
    [pnl.realizedNetCents, accounting?.realizedNetPnlCents]
  ];
  for (const [left, right] of pairs) {
    if (left !== null && left !== undefined && right !== null && right !== undefined &&
        decimal(left, {signed: true}) !== decimal(right, {signed: true})) {
      throw new TypeError("ledger summary conflicts with run-end accounting");
    }
  }
  const positions = Array.isArray(summary?.openPositions) ? summary.openPositions : null;
  if (positions && positions.length > MAX_ROWS) throw new TypeError("open position count exceeds limits");
  const endingPositions = Array.isArray(runEnd?.openPositions) ? runEnd.openPositions : null;
  if (endingPositions && endingPositions.length > MAX_ROWS) throw new TypeError("run-end position count exceeds limits");
  if (positions && endingPositions && positions.length !== endingPositions.length) {
    throw new TypeError("open position counts conflict between summary and run-end receipt");
  }
  if (endingPositions) {
    const endingByMint = new Map();
    for (const position of endingPositions) {
      if (!isRecord(position) || typeof position.mint !== "string" || endingByMint.has(position.mint)) {
        throw new TypeError("run-end open positions contain conflicting identity");
      }
      endingByMint.set(position.mint, position);
    }
    if (positions) {
      const summaryMints = new Set();
      for (const position of positions) {
        if (!isRecord(position) || summaryMints.has(position.mint) || !endingByMint.has(position.mint)) {
          throw new TypeError("summary and run-end positions have mixed identity");
        }
        summaryMints.add(position.mint);
      }
    }
  } else if (positions) {
    const mints = new Set();
    for (const position of positions) {
      if (!isRecord(position) || typeof position.mint !== "string" || mints.has(position.mint)) {
        throw new TypeError("summary open positions contain conflicting identity");
      }
      mints.add(position.mint);
    }
  }
}

function reportedCosts(summary) {
  const costs = isRecord(summary?.costs) ? summary.costs : null;
  const entry = isRecord(costs?.entry) ? costs.entry : null;
  const exit = isRecord(costs?.exit) ? costs.exit : null;
  const complete = Boolean(entry && exit && COST_FIELDS.every(key =>
    entry[key] !== null && entry[key] !== undefined &&
    exit[key] !== null && exit[key] !== undefined));
  const entryByType = {};
  const exitByType = {};
  const totalByType = {};
  for (const key of COST_FIELDS) {
    entryByType[key] = entry && Object.hasOwn(entry, key) ? decimal(entry[key]) : null;
    exitByType[key] = exit && Object.hasOwn(exit, key) ? decimal(exit[key]) : null;
    totalByType[key] = complete ? (BigInt(entryByType[key]) + BigInt(exitByType[key])).toString() : null;
  }
  return {
    basis: "reported ledger cost totals; exact integer-cent addition only",
    entryByType,
    exitByType,
    totalByType,
    totalCents: complete ? COST_FIELDS.reduce((sum, key) =>
      sum + BigInt(totalByType[key]), 0n).toString() : null
  };
}

function stopEvents(data) {
  const stops = [];
  const add = (kind, status, reason, observedAt, source) => {
    const item = {
      kind: cleanText(kind, 64),
      status: cleanText(status, 32),
      reason: cleanText(reason),
      observedAt: timestamp(observedAt),
      source: cleanText(source, 120)
    };
    const key = JSON.stringify(item);
    if (!stops.some(existing => JSON.stringify(existing) === key)) stops.push(item);
  };
  for (const receipt of data.results) {
    const result = isRecord(receipt.result) ? receipt.result : {};
    if (receipt.method === "riskSnapshot" &&
        ["DAILY_LOSS_LIMIT", "EQUITY_UNKNOWN", "REJECT"].includes(result.status)) {
      add("RISK_GATE", result.status, result.reason ?? result.status, result.observedAt, receipt.commandId);
    }
    const reason = typeof result.reason === "string" ? result.reason : null;
    if (reason && CLOCK_REASONS.has(reason)) {
      add(reason === "CLOCK_RESTART_BLOCKED" ? "RESTART_STOP" : "CLOCK_STOP",
        result.status ?? "UNKNOWN", reason, result.observedAt, receipt.commandId);
    }
    if (receipt.method === "observeExitQuote" && result.status === "CLOSED_PAPER" &&
        ["STOP", "DAILY_LOSS_LIMIT"].includes(result.reason)) {
      add(result.reason === "STOP" ? "POSITION_STOP" : "RISK_GATE",
        result.status, result.reason, result.observedAt, receipt.commandId);
    }
    for (const exit of Array.isArray(result.exitRequests) ? result.exitRequests : []) {
      if (exit?.status === "CLOSED_PAPER" && ["STOP", "DAILY_LOSS_LIMIT"].includes(exit.reason)) {
        add(exit.reason === "STOP" ? "POSITION_STOP" : "RISK_GATE",
          exit.status, exit.reason, exit.observedAt, receipt.commandId);
      }
    }
  }
  for (const event of data.audit) {
    if (!isRecord(event)) continue;
    if (event.type === "PAPER_EXIT" && ["STOP", "DAILY_LOSS_LIMIT"].includes(event.reason)) {
      add(event.reason === "STOP" ? "POSITION_STOP" : "RISK_GATE",
        event.status ?? "CLOSED_PAPER", event.reason, event.observedAt, event.type);
    }
    if (event.type === "RUN_FINISHED") {
      add("RUN_WINDOW", "STOPPED", "run ended; new work is disabled", event.observedAt, event.type);
    }
  }
  if (data.runEnd?.status === "FINISHED" &&
      !stops.some(item => item.kind === "RUN_WINDOW")) {
    add("RUN_WINDOW", "STOPPED", "run ended; new work is disabled", null, "finishRun receipt");
  }
  if (data.metadata?.clockAdmissionBlocked === true &&
      !stops.some(item => item.kind === "CLOCK_STOP" || item.kind === "RESTART_STOP")) {
    add("CLOCK_STOP", "BLOCKED", "clock admission is blocked; specific fault receipt unavailable",
      null, "checkpoint metadata");
  }
  if (data.runEnd?.status === "INVALID_RUN_WINDOW") {
    add("RUN_WINDOW", "STOPPED", data.runEnd.reason ?? data.runEnd.status, null, "finishRun receipt");
  }
  return stops;
}

function unresolvedFills(data) {
  const result = [];
  for (const receipt of data.results) {
    const item = isRecord(receipt.result) ? receipt.result : {};
    if (receipt.method === "executeEntry" && item.status === "UNFILLED") {
      result.push({
        kind: "ENTRY_UNFILLED",
        receiptId: safeId(receipt.commandId),
        status: item.status,
        reason: cleanText(item.reason)
      });
    }
    if (receipt.method === "observeExitQuote" &&
        ["UNFILLED", "VALUATION_UNAVAILABLE"].includes(item.status)) {
      result.push({
        kind: "EXIT_UNRESOLVED",
        receiptId: safeId(receipt.commandId),
        status: item.status,
        reason: cleanText(item.reason)
      });
    }
  }
  if (data.variant === "replay") {
    for (const item of data.fillEvidence ?? []) {
      if (item?.status === "UNFILLED") {
        result.push({
          kind: "ENTRY_UNFILLED",
          receiptId: safeId(item.eventId),
          status: item.status,
          reason: cleanText(item.reason)
        });
      }
    }
    for (const event of data.audit) {
      if (event?.type === "PAPER_EXIT_UNFILLED" || event?.type === "EXIT_UNRESOLVED") {
        result.push({
          kind: "EXIT_UNRESOLVED",
          receiptId: safeId(event.eventId),
          status: cleanText(event.status ?? "UNFILLED", 32),
          reason: cleanText(event.reason)
        });
      }
    }
  }
  return result;
}

function evidenceSummary(data, candidates) {
  const observed = [];
  const statuses = [];
  const sources = [];
  for (const row of data.scoutRows) {
    const at = timestamp(row.sampledAt);
    if (at) observed.push(at);
    if (typeof row.source === "string") sources.push(cleanText(row.source, 120));
  }
  for (const [gate, check] of Object.entries(data.filter?.checks ?? {})) {
    if (["PASS", "REJECT", "UNKNOWN"].includes(check?.status)) statuses.push(check.status);
    const at = timestamp(check?.observedAt);
    if (at) observed.push(at);
    if (typeof check?.source === "string") sources.push(cleanText(check.source, 120));
  }
  const status = statuses.length === 0 ? "UNKNOWN" :
    statuses.includes("UNKNOWN") ? "UNKNOWN" :
      statuses.includes("REJECT") ? "REJECT" : "PASS";
  const sorted = observed.sort();
  return {
    status,
    observedFrom: sorted[0] ?? null,
    observedThrough: sorted.at(-1) ?? null,
    basis: "source-reported sample/check timestamps; no wall-clock freshness recomputation",
    sources: [...new Set(sources.filter(Boolean))].slice(0, 20),
    coverage: {
      discovery: {
        observedRecords: countValue(data.discovery?.observedRecords),
        scoutAuditRows: data.variant === "replay" ? data.scoutRows.length : null,
        unaccountedObservedRecords: data.variant === "replay"
          ? candidates.unaccountedObserved : null,
        sourceTruncated: data.discoveryTruncated,
        scoutAuditTruncated: data.variant === "replay"
          ? candidates.scoutAuditTruncated : null,
        exhaustive: typeof data.discovery?.exhaustive === "boolean"
          ? data.discovery.exhaustive : null
      },
      audit: {
        present: data.auditPresent,
        observedRows: data.auditPresent ? data.audit.length : null,
        truncated: data.auditTruncated,
        totalRows: data.auditTruncated === false && data.auditPresent ? data.audit.length : null,
        replayLoggerTruncated: data.replayAuditTruncated,
        ledgerAuditTruncated: data.ledgerAuditTruncated,
        ledgerEventsReported: countValue(data.summary?.eventCount),
        ledgerEventsAudited: data.auditPresent
          ? data.audit.filter(event => isRecord(event) && LEDGER_EVENT_TYPES.has(event.type)).length
          : null
      }
    }
  };
}

function makeReport(data, report) {
  const summary = isRecord(data.summary) ? data.summary : {};
  checkIdentity(report, data.runId, summary);
  checkAmounts(summary, data.runEnd);
  const candidates = candidatesFor(data);
  const receipts = data.results;
  const fills = data.variant === "replay" ? data.fillEvidence :
    receipts.filter(item => item.method === "executeEntry").map(item => item.result);
  const hasFillEvidence = data.variant === "replay" ? fills !== null :
    receipts.some(item => item.method === "executeEntry");
  const observedFillCount = hasFillEvidence
    ? fills.filter(item => item?.status === "FILLED_PAPER").length : null;
  const runEnd = data.runEnd;
  const accounting = isRecord(runEnd?.accounting) ? runEnd.accounting : null;
  const ledgerPositions = Array.isArray(summary.openPositions) ? summary.openPositions : null;
  const endingPositions = Array.isArray(runEnd?.openPositions) ? runEnd.openPositions : null;
  const endingByMint = new Map((endingPositions ?? []).filter(isRecord).map(item => [item.mint, item]));
  const positionRows = ledgerPositions ?? endingPositions?.map(position => ({
    mint: position.mint,
    markStatus: position.markStatus
  })) ?? [];
  const openPositionCount = ledgerPositions ? ledgerPositions.length :
    endingPositions ? endingPositions.length : null;
  const costs = reportedCosts(summary);
  let fillCount = observedFillCount === 0 && !data.complete ? null : observedFillCount;
  if (data.complete && observedFillCount === 0) {
    const auditFill = data.audit.some(event => isRecord(event) &&
      (event.type === "PAPER_FILL" || event.type === "PAPER_ENTRY" ||
       event.type === "STOP_ARMED" || event.type === "PAPER_EXIT" ||
       event.status === "FILLED_PAPER"));
    if (auditFill) throw new TypeError("zero-fill receipt conflicts with a recorded paper fill");
    const initialCapital = decimal(summary.initialCapitalCents);
    const cashAtEnd = decimal(summary.cashCents) ??
      decimal(runEnd?.accounting?.cashCents);
    const pnl = isRecord(summary.pnl) ? summary.pnl : {};
    const realizedGross = decimal(pnl.realizedGrossCents, {signed: true});
    const realizedNet = decimal(pnl.realizedNetCents, {signed: true});
    const unrealizedGross = decimal(pnl.unrealizedGrossCents, {signed: true});
    const unrealizedNet = decimal(pnl.unrealizedNetCents, {signed: true});
    const eventCount = countValue(summary.eventCount);
    const ledgerEventCount = data.audit.filter(event =>
      isRecord(event) && LEDGER_EVENT_TYPES.has(event.type)).length;
    if (eventCount !== null && data.auditPresent && summary.auditTruncated !== true &&
        !report.auditTruncated && eventCount !== ledgerEventCount) {
      throw new TypeError("ledger event count conflicts with its audit");
    }
    const explicitZeroLedger = initialCapital !== null && summary.cashCents !== null &&
      summary.cashCents !== undefined && cashAtEnd !== null &&
      ["realizedGrossCents", "realizedNetCents", "unrealizedGrossCents", "unrealizedNetCents"]
        .every(key => pnl[key] !== null && pnl[key] !== undefined) &&
      realizedGross === "0" && realizedNet === "0" &&
      unrealizedGross === "0" && unrealizedNet === "0" &&
      costs.totalCents !== null && ledgerPositions !== null && openPositionCount === 0 &&
      eventCount !== null && data.auditPresent &&
      summary.auditTruncated !== true && !report.auditTruncated &&
      eventCount === ledgerEventCount;
    const contradictoryLedger = (openPositionCount !== null && openPositionCount > 0) ||
      (initialCapital !== null && cashAtEnd !== null && initialCapital !== cashAtEnd) ||
      (realizedGross !== null && realizedGross !== "0") ||
      (realizedNet !== null && realizedNet !== "0") ||
      (unrealizedGross !== null && unrealizedGross !== "0") ||
      (unrealizedNet !== null && unrealizedNet !== "0") ||
      (costs.totalCents !== null && costs.totalCents !== "0");
    if (contradictoryLedger) {
      throw new TypeError("zero-fill evidence conflicts with ledger activity");
    }
    if (!explicitZeroLedger) fillCount = null;
  }
  const positions = positionRows.map(position => {
    const ending = endingByMint.get(position.mint);
    return {
      mint: cleanText(position.mint, 80),
      tokenAtoms: decimal(position.tokenAtoms),
      decimals: Number.isSafeInteger(position.decimals) ? position.decimals : null,
      entryCostCents: decimal(position.entryCostCents),
      stopPriceMicros: decimal(position.stopPriceMicros),
      trailingActive: typeof position.trailingActive === "boolean" ? position.trailingActive : null,
      markStatus: cleanText(ending?.markStatus, 40) ?? "UNKNOWN"
    };
  });
  const reserveValues = receipts.filter(item => item.method === "riskSnapshot")
    .map(item => item.result?.reservedPositions).filter(value => value !== undefined);
  const allStops = stopEvents(data);
  const allUnresolvedFills = unresolvedFills(data);
  const noTradeReasons = [];
  if (fillCount === 0) {
    for (const candidate of candidates.details ?? []) {
      for (const reason of candidate.reasons) {
        if (reason.status !== "PASS" && reason.reason) noTradeReasons.push({
          mint: candidate.mint,
          gate: reason.gate,
          status: reason.status,
          reason: reason.reason,
          source: reason.source,
          observedAt: reason.observedAt
        });
      }
    }
    for (const receipt of receipts) {
      const result = isRecord(receipt.result) ? receipt.result : {};
      if (receipt.method === "authorizeEntry" && result.status === "REJECT") {
        noTradeReasons.push({
          mint: cleanText(result.mint, 80),
          gate: "authorization",
          status: "REJECT",
          reason: cleanText(result.reason),
          source: safeId(receipt.commandId),
          observedAt: timestamp(result.authorizedAt)
        });
      }
      if (receipt.method === "executeEntry" && result.status === "UNFILLED") {
        noTradeReasons.push({
          mint: cleanText(result.mint, 80),
          gate: "entry-fill",
          status: "UNFILLED",
          reason: cleanText(result.reason),
          source: safeId(receipt.commandId),
          observedAt: timestamp(result.observedAt)
        });
      }
    }
    if (data.variant === "replay") {
      for (const item of data.fillEvidence ?? []) {
        if (item?.status === "UNFILLED") {
          noTradeReasons.push({
            mint: cleanText(item.mint, 80),
            gate: "entry-fill",
            status: "UNFILLED",
            reason: cleanText(item.reason),
            source: safeId(item.eventId),
            observedAt: timestamp(item.observedAt)
          });
        }
      }
    }
  }
  const allReasons = [...new Map(noTradeReasons.map(reason => [JSON.stringify(reason), reason])).values()];
  const reasonSourceTruncated = truncationFlag(
    data.auditPresent ? data.auditTruncated : null,
    candidates.scoutAuditTruncated,
    candidates.discoveryTruncated
  );
  const unresolvedSourceTruncated = data.variant === "checkpoint"
    ? false : data.auditPresent ? data.auditTruncated : null;
  const sources = evidenceSummary(data, candidates);
  const candidateListTruncated = data.variant === "checkpoint" ? false :
    truncationFlag(candidates.discoveryTruncated, candidates.scoutAuditTruncated);
  const candidateDetails = (candidates.details ?? []).slice(0, 40).map(candidate => ({
    ...candidate,
    reasons: candidate.reasons.slice(0, 40),
    reasonsCoverage: listCoverage(
      candidate.reasons.length,
      candidate.reasons.length,
      false
    )
  }));
  const dto = {
    schema: REPORT_TYPE,
    experiment: {
      id: checkIdentity(report, data.runId, summary),
      source: cleanText(data.source, 120),
      evidenceKind: "SYNTHETIC_FIXTURE",
      reportStatus: data.complete ? "FINISHED" : "INCOMPLETE",
      sourceReadiness: data.sourceReady,
      operationalStatus: "NOT_EVIDENCED",
      startAt: data.startAt,
      endAt: data.endAt
    },
    evidence: sources,
    candidates: {
      considered: candidates.considered,
      accepted: candidates.accepted,
      rejected: candidates.rejected,
      unknown: candidates.unknown,
      audited: candidates.audited,
      unaccountedObserved: candidates.unaccountedObserved,
      discoveryTruncated: candidates.discoveryTruncated,
      scoutAuditTruncated: candidates.scoutAuditTruncated,
      basis: cleanText(candidates.basis),
      details: candidateDetails,
      detailsCoverage: listCoverage(
        candidates.details?.length ?? 0,
        candidates.considered,
        candidateListTruncated,
        candidates.unaccountedObserved
      )
    },
    trading: {
      status: fillCount === null ? "UNKNOWN" : fillCount === 0 ? "ZERO_TRADES" : "TRADES_RECORDED",
      paperEntryFills: fillCount,
      noTradeReasons: allReasons.slice(0, 40),
      noTradeReasonsCoverage: listCoverage(
        allReasons.length,
        fillCount === 0 && reasonSourceTruncated === false ? allReasons.length :
          fillCount !== 0 ? allReasons.length : null,
        reasonSourceTruncated
      )
    },
    controls: {
      stops: allStops.slice(0, 40),
      stopsCoverage: listCoverage(
        allStops.length,
        data.variant === "checkpoint" || data.auditTruncated === false ? allStops.length : null,
        data.variant === "checkpoint" ? false :
          data.auditPresent ? data.auditTruncated : null
      ),
      reservations: reserveValues.length ? countValue(reserveValues.at(-1)) : null,
      openPositionCount,
      openPositions: positions.slice(0, 40),
      openPositionsCoverage: listCoverage(
        ledgerPositions || endingPositions ? positionRows.length : null,
        openPositionCount,
        false
      )
    },
    valuation: {
      status: accounting ? "MARKED_AT_RUN_END" :
        positions.some(position => position.markStatus !== "MARKED") ? "UNRESOLVED" : "UNKNOWN",
      cashCents: decimal(summary.cashCents) ?? decimal(accounting?.cashCents),
      realizedGrossPnlCents: decimal(summary.pnl?.realizedGrossCents, {signed: true}) ??
        decimal(accounting?.realizedGrossPnlCents, {signed: true}),
      realizedNetPnlCents: decimal(summary.pnl?.realizedNetCents, {signed: true}) ??
        decimal(accounting?.realizedNetPnlCents, {signed: true}),
      grossOpenValueCents: accounting ? decimal(accounting.grossOpenValueCents) : null,
      estimatedExitCostsCents: accounting ? decimal(accounting.estimatedExitCostsCents) : null,
      unrealizedGrossPnlCents: accounting ? decimal(accounting.grossUnrealizedPnlCents, {signed: true}) : null,
      unrealizedNetPnlCents: accounting ? decimal(accounting.netUnrealizedPnlCents, {signed: true}) : null,
      unresolvedPositions: openPositionCount !== null
        ? positions.filter(position => position.markStatus !== "MARKED").length : null,
      basis: accounting ? "finishRun accounting receipt" : "run-end marks/accounting unavailable"
    },
    costs,
    unresolvedFills: allUnresolvedFills.slice(0, 40),
    unresolvedFillsCoverage: listCoverage(
      allUnresolvedFills.length,
      unresolvedSourceTruncated === false ? allUnresolvedFills.length : null,
      unresolvedSourceTruncated
    ),
    provenance: (candidates.details ?? []).slice(0, 40).map(candidate => ({
      chainId: candidate.chainId,
      mint: candidate.mint,
      pool: candidate.pool,
      relatedPool: candidate.relatedPool,
      quote: candidate.quote,
      sampledAt: candidate.sampledAt,
      status: candidate.status
    })),
    provenanceCoverage: listCoverage(
      candidates.details?.length ?? 0,
      candidates.considered,
      candidateListTruncated,
      candidates.unaccountedObserved
    )
  };
  const bytes = Buffer.byteLength(JSON.stringify(dto));
  if (bytes > OUTPUT_LIMIT_BYTES) throw new TypeError("operator report exceeds 256 KiB");
  return dto;
}

export function projectOperatorReport(input) {
  inputBytes(input);
  if (!isRecord(input) || !REPORT_SOURCES.has(input.reportType)) {
    throw new TypeError("unsupported Paper result or receipt contract");
  }
  const data = input.reportType === "SYNTHETIC_FIXTURE_REPLAY_ONLY"
    ? replayData(input) : checkpointData(input);
  return makeReport(data, input);
}

export function renderOperatorReport(report) {
  if (!isRecord(report) || report.schema !== REPORT_TYPE) {
    throw new TypeError("strict operator report DTO required");
  }
  const experiment = isRecord(report.experiment) ? report.experiment : {};
  const evidence = isRecord(report.evidence) ? report.evidence : {};
  const candidates = isRecord(report.candidates) ? report.candidates : {};
  const trading = isRecord(report.trading) ? report.trading : {};
  const controls = isRecord(report.controls) ? report.controls : {};
  const valuation = isRecord(report.valuation) ? report.valuation : {};
  const costs = isRecord(report.costs) ? report.costs : {};
  const rows = value => Array.isArray(value) ? value.slice(0, 40).filter(isRecord) : [];
  const amount = (value, signed = false) => {
    try {
      const exact = decimal(value, {signed});
      return exact === null ? "UNKNOWN" : `${exact} cents`;
    } catch {
      return "UNKNOWN";
    }
  };
  const count = value => {
    try {
      const exact = countValue(value);
      return exact === null ? "UNKNOWN" : String(exact);
    } catch {
      return "UNKNOWN";
    }
  };
  const noTradeReasons = rows(trading.noTradeReasons);
  const stops = rows(controls.stops);
  const fills = rows(report.unresolvedFills);
  const provenance = rows(report.provenance);
  const flag = value => value === true ? "YES" : value === false ? "NO" : "UNKNOWN";
  const coverage = value => isRecord(value) ? value : {};
  const coverageLine = (label, value) => {
    const item = coverage(value);
    return `${label}: total ${count(item.total)}, observed ${count(item.observedTotal)}, displayed ${count(item.displayed)} (display capped: ${flag(item.displayTruncated)}; source truncated: ${flag(item.sourceTruncated)}; unaccounted: ${count(item.unaccounted)})`;
  };
  const discoveryCoverage = coverage(evidence.coverage?.discovery);
  const auditCoverage = coverage(evidence.coverage?.audit);
  const detailCoverage = coverage(candidates.detailsCoverage);
  const noTradeCoverage = coverage(trading.noTradeReasonsCoverage);
  const stopCoverage = coverage(controls.stopsCoverage);
  const positionCoverage = coverage(controls.openPositionsCoverage);
  const unresolvedCoverage = coverage(report.unresolvedFillsCoverage);
  const provenanceCoverage = coverage(report.provenanceCoverage);
  const evidenceSources = Array.isArray(evidence.sources) ? evidence.sources.slice(0, 20) : [];
  const lines = [
    "PAPER OPERATOR REPORT",
    `Report status: ${cleanText(experiment.reportStatus, 32) ?? "UNKNOWN"}`,
    `Experiment: ${cleanText(experiment.id, 120) ?? "UNKNOWN"}`,
    `Run bounds: ${cleanText(experiment.startAt, 32) ?? "UNKNOWN"} to ${cleanText(experiment.endAt, 32) ?? "UNKNOWN"}`,
    `Evidence freshness: ${cleanText(evidence.status, 32) ?? "UNKNOWN"} (reported timestamps; not recomputed)`,
    `Candidates: considered ${count(candidates.considered)}, accepted ${count(candidates.accepted)}, rejected ${count(candidates.rejected)}, unknown ${count(candidates.unknown)}`,
    `Candidate evidence: audited ${count(candidates.audited)}; unaccounted observed ${count(candidates.unaccountedObserved)}; discovery truncated ${flag(candidates.discoveryTruncated)}; Scout audit truncated ${flag(candidates.scoutAuditTruncated)}`,
    `Paper entry fills: ${count(trading.paperEntryFills)} (${cleanText(trading.status, 32) ?? "UNKNOWN"})`,
    `Source readiness: ${cleanText(experiment.sourceReadiness, 32) ?? "UNKNOWN"}; operationally running: NOT EVIDENCED`,
    `Cash: ${amount(valuation.cashCents)}; reservations: ${count(controls.reservations)}; open positions: ${count(controls.openPositionCount)}`,
    `Valuation: ${cleanText(valuation.status, 32) ?? "UNKNOWN"}; realized gross/net ${amount(valuation.realizedGrossPnlCents, true)} / ${amount(valuation.realizedNetPnlCents, true)}; unrealized gross/net ${amount(valuation.unrealizedGrossPnlCents, true)} / ${amount(valuation.unrealizedNetPnlCents, true)}`,
    `Reported costs: ${amount(costs.totalCents)}`,
    `Unresolved positions: ${count(valuation.unresolvedPositions)}; unresolved fills: ${count(unresolvedCoverage.total)}`,
    `Discovery coverage: ${count(discoveryCoverage.observedRecords)} observed records; ${count(discoveryCoverage.scoutAuditRows)} Scout audit rows; source truncated ${flag(discoveryCoverage.sourceTruncated)}; audit truncated ${flag(discoveryCoverage.scoutAuditTruncated)}; unaccounted observed ${count(discoveryCoverage.unaccountedObservedRecords)}`,
    `Audit coverage: ${count(auditCoverage.observedRows)} rows observed; total ${count(auditCoverage.totalRows)}; truncated ${flag(auditCoverage.truncated)} (replay logger ${flag(auditCoverage.replayLoggerTruncated)}, ledger ${flag(auditCoverage.ledgerAuditTruncated)})`,
    coverageLine("Displayed candidate details", detailCoverage),
    coverageLine("Displayed no-trade reasons", noTradeCoverage),
    coverageLine("Displayed risk/clock stops", stopCoverage),
    coverageLine("Displayed open positions", positionCoverage),
    coverageLine("Displayed unresolved fills", unresolvedCoverage),
    coverageLine("Displayed provenance", provenanceCoverage),
    "No-trade reasons:"
  ];
  if (noTradeReasons.length) {
    for (const reason of noTradeReasons) {
      lines.push(`- ${cleanText(reason.gate, 80) ?? "unknown gate"} [${cleanText(reason.status, 32) ?? "UNKNOWN"}]: ${cleanText(reason.reason) ?? "reason unavailable"}`);
    }
  } else {
    lines.push("- None attributable from the supplied result/receipt snapshot.");
  }
  lines.push("Risk and clock stops:");
  if (stops.length) {
    for (const stop of stops) {
      lines.push(`- ${cleanText(stop.kind, 64) ?? "STOP"} [${cleanText(stop.status, 32) ?? "UNKNOWN"}]: ${cleanText(stop.reason) ?? "reason unavailable"}`);
    }
  } else {
    lines.push("- None evidenced in the supplied result/receipt snapshot.");
  }
  if (fills.length) {
    lines.push("Unresolved fills:");
    for (const fill of fills) {
      lines.push(`- ${cleanText(fill.kind, 40)} [${cleanText(fill.status, 32)}]: ${cleanText(fill.reason) ?? "reason unavailable"}`);
    }
  }
  lines.push("Details (identifiers and provenance; sanitized):");
  for (const candidate of provenance) {
    const relatedPool = candidate.relatedPool ? ` duplicatePool=${cleanText(candidate.relatedPool, 80)}` : "";
    lines.push(`- chain=${cleanText(candidate.chainId, 32) ?? "UNKNOWN"} mint=${cleanText(candidate.mint, 80) ?? "UNKNOWN"} pool=${cleanText(candidate.pool, 80) ?? "UNKNOWN"}${relatedPool} quote=${cleanText(candidate.quote, 80) ?? "UNKNOWN"} sampledAt=${cleanText(candidate.sampledAt, 32) ?? "UNKNOWN"} status=${cleanText(candidate.status, 32) ?? "UNKNOWN"}`);
  }
  lines.push(`Evidence sources: ${evidenceSources.map(item => cleanText(item, 120)).filter(Boolean).join(", ") || "UNKNOWN"}`);
  const rendered = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(rendered) > OUTPUT_LIMIT_BYTES) throw new TypeError("rendered operator report exceeds 256 KiB");
  return rendered;
}
