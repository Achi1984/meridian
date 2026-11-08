import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseKrakenOhlc, parseKrakenTicker, sha256, SPOT_PAPER_PILOT_LIMITS
} from "./core.mjs";
import {
  DEFAULT_PAPER_EVIDENCE_PROFILE_ID, HOST_EIGHT_HOUR_PROFILE_ID,
  getPaperEvidenceProfile
} from "./evidence-profiles.mjs";
import { verifyExpectedHostContext } from "./host-context.mjs";
import {
  expectedDispatchFromEnvironment, FOUR_HOUR_DISPATCH_PROFILE_ID,
  verifyFourHourDispatchIdentity
} from "./dispatch-identity.mjs";

export const ACCEPTED_PAPER_SOURCE_SHA = "81edf0b5dc3d455c2c1e1906791d56c731bea0c9";
const EXPECTED_MANIFEST = getPaperEvidenceProfile();
const NOTIONAL_DIVISOR = 100_000_000_000_000n;
const TERMINAL_WRITE_GRACE_MS = 5_000;

const isInteger = value => Number.isSafeInteger(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const roundHalfUp = (numerator, denominator) =>
  (numerator * 2n + denominator) / (2n * denominator);
const requiresRawMarketEvidence = event => event.type === "observation" ||
  (event.type === "data_gap" && event.dataGap === "MISSED_DECISION_WINDOW");
const rawReferenceValid = record => record &&
  /^[a-f0-9]{64}$/.test(record.sha256) &&
  record.path === `responses/${record.sha256}.json` &&
  isInteger(record.bytes) && record.bytes > 0 &&
  record.bytes <= EXPECTED_MANIFEST.maxResponseBytes;

function engineBoundsMatch() {
  return SPOT_PAPER_PILOT_LIMITS.pair === EXPECTED_MANIFEST.pair &&
    SPOT_PAPER_PILOT_LIMITS.initialCashCents === EXPECTED_MANIFEST.initialCashCents &&
    SPOT_PAPER_PILOT_LIMITS.maxExposureCents === EXPECTED_MANIFEST.maxExposureCents &&
    SPOT_PAPER_PILOT_LIMITS.maxSessionLossCents === EXPECTED_MANIFEST.maxSessionLossCents &&
    SPOT_PAPER_PILOT_LIMITS.stopLossBps === EXPECTED_MANIFEST.stopLossBps &&
    SPOT_PAPER_PILOT_LIMITS.maxEntrySpreadBps === EXPECTED_MANIFEST.maxEntrySpreadBps &&
    SPOT_PAPER_PILOT_LIMITS.feeBpsPerSide === EXPECTED_MANIFEST.feeBpsPerSide &&
    SPOT_PAPER_PILOT_LIMITS.slippageBpsPerSide === EXPECTED_MANIFEST.slippageBpsPerSide &&
    SPOT_PAPER_PILOT_LIMITS.maxQuoteAgeMs === EXPECTED_MANIFEST.maxQuoteAgeMs &&
    SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs === EXPECTED_MANIFEST.maxCandleAgeMs &&
    SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs === EXPECTED_MANIFEST.requestTimeoutMs &&
    SPOT_PAPER_PILOT_LIMITS.maxBytes === EXPECTED_MANIFEST.maxBytes &&
    SPOT_PAPER_PILOT_LIMITS.maxResponseBytes === EXPECTED_MANIFEST.maxResponseBytes &&
    SPOT_PAPER_PILOT_LIMITS.warmupCandles === EXPECTED_MANIFEST.warmupCandles;
}

function verifyProvenance(provenance, runId, expected) {
  if (!provenance || provenance.schemaVersion !== EXPECTED_MANIFEST.schemaVersion ||
      provenance.acceptedSourceSha !== expected.acceptedSourceSha ||
      !/^[a-f0-9]{40}$/.test(provenance.workflowSha ?? "") ||
      !/^\d+$/.test(String(provenance.workflowRunId ?? "")) ||
      provenance.workflowRunNumber !== 1 || provenance.workflowRunAttempt !== 1 ||
      (expected.profileId !== DEFAULT_PAPER_EVIDENCE_PROFILE_ID &&
        provenance.profileId !== expected.profileId) ||
      runId !== `spot-paper-${provenance.workflowRunId}-${provenance.workflowRunAttempt}`) {
    return false;
  }
  return Object.entries(expected).every(([key, value]) =>
    key === "profileId" || provenance[key] === value);
}

function verifyMarketEvidence(events, responseBodies) {
  if (!Array.isArray(events) || !responseBodies || typeof responseBodies !== "object") {
    return { valid: false, acceptedObservations: 0, parsedQuotes: new Map() };
  }
  let valid = true;
  let acceptedObservations = 0;
  const parsedQuotes = new Map();
  for (const event of events) {
    const required = requiresRawMarketEvidence(event);
    if (!event.ohlc || !event.ticker) {
      if (required) valid = false;
      continue;
    }
    if (!rawReferenceValid(event.ohlc) || !rawReferenceValid(event.ticker) ||
        !isInteger(event.signalKnownAt) ||
        event.ticker.requestStartedAt < event.signalKnownAt) {
      valid = false;
      continue;
    }
    try {
      const ohlcRaw = responseBodies[event.ohlc.sha256];
      const tickerRaw = responseBodies[event.ticker.sha256];
      if (typeof ohlcRaw !== "string" || typeof tickerRaw !== "string" ||
          Buffer.byteLength(ohlcRaw, "utf8") !== event.ohlc.bytes ||
          Buffer.byteLength(tickerRaw, "utf8") !== event.ticker.bytes ||
          sha256(Buffer.from(ohlcRaw, "utf8")) !== event.ohlc.sha256 ||
          sha256(Buffer.from(tickerRaw, "utf8")) !== event.ticker.sha256) {
        valid = false;
        continue;
      }
      const ohlc = parseKrakenOhlc({
        raw: ohlcRaw, sha256: event.ohlc.sha256,
        requestStartedAt: event.ohlc.requestStartedAt,
        receivedAt: event.ohlc.receivedAt,
        data: JSON.parse(ohlcRaw)
      }, event.ohlc.receivedAt);
      if (ohlc.latestClosedAt !== event.ohlc.latestClosedAt) {
        valid = false;
        continue;
      }
      const quote = parseKrakenTicker({
        raw: tickerRaw, sha256: event.ticker.sha256,
        requestStartedAt: event.ticker.requestStartedAt,
        receivedAt: event.ticker.receivedAt,
        data: JSON.parse(tickerRaw)
      }, event.ticker.receivedAt);
      if (!isInteger(event.ohlc.ageMs) || event.ohlc.ageMs < 0 ||
          event.ohlc.ageMs > EXPECTED_MANIFEST.maxCandleAgeMs ||
          !isInteger(event.ticker.acquisitionAgeMs) ||
          event.ticker.acquisitionAgeMs < 0 ||
          event.ticker.acquisitionAgeMs > EXPECTED_MANIFEST.maxQuoteAgeMs) {
        valid = false;
        continue;
      }
      parsedQuotes.set(event.id, quote);
      if (event.type === "observation") acceptedObservations++;
    } catch {
      valid = false;
    }
  }
  return { valid, acceptedObservations, parsedQuotes };
}

function verifyLedger(events, checkpoint, report, parsedQuotes) {
  if (!Array.isArray(events) || !checkpoint?.ledger || !report ||
      !(parsedQuotes instanceof Map)) return false;
  const fills = [];
  let cash = EXPECTED_MANIFEST.initialCashCents;
  let fees = 0;
  let realized = 0;
  let position = null;
  try {
    for (const event of events) {
      if (!event.fills?.length) continue;
      const quote = parsedQuotes.get(event.id);
      if (!quote || !event.ohlc || !event.ticker) return false;
      const eventSignals = Array.isArray(event.signals) ? event.signals : [];
      for (const fill of event.fills ?? []) {
        if (!isInteger(fill.quantitySat) || fill.quantitySat <= 0 ||
            !/^\d{1,17}$/.test(fill.priceNano ?? "") ||
            !isInteger(fill.grossCents) || fill.grossCents < 0 ||
            !isInteger(fill.feeCents) || fill.feeCents < 0 ||
            fill.feeCents !== Number(roundHalfUp(
              BigInt(fill.grossCents) * BigInt(EXPECTED_MANIFEST.feeBpsPerSide), 10_000n)) ||
            fill.quoteReceivedAt !== event.ticker.receivedAt) return false;
        const notional = Number(roundHalfUp(
          BigInt(fill.quantitySat) * BigInt(fill.priceNano), NOTIONAL_DIVISOR));
        if (notional !== fill.grossCents) return false;
        const quotePrice = fill.side === "BUY" ? quote.askNano : quote.bidNano;
        const slippageBps = fill.side === "BUY" ?
          EXPECTED_MANIFEST.slippageBpsPerSide :
          -EXPECTED_MANIFEST.slippageBpsPerSide;
        const expectedPrice = roundHalfUp(
          BigInt(quotePrice) * BigInt(10_000 + slippageBps), 10_000n);
        if (BigInt(fill.priceNano) !== expectedPrice ||
            (fill.side === "BUY" &&
              quote.spreadBps > EXPECTED_MANIFEST.maxEntrySpreadBps)) return false;
        const causalSignal = fill.side !== "SELL" ||
          fill.reason !== "SAMPLED_2PCT_BID_STOP" ? eventSignals.find(signal =>
          fill.id === `${fill.side === "BUY" ? "entry" : "exit"}:${signal.id}` &&
          fill.signalAt === signal.candleAt &&
          signal.direction === (fill.side === "BUY" ? "ENTRY" : "EXIT")) : null;
        if (fill.side === "BUY") {
          if (!causalSignal || position) return false;
          const cost = fill.grossCents + fill.feeCents;
          if (cost > EXPECTED_MANIFEST.maxExposureCents || cost > cash) return false;
          cash -= cost;
          const stopPriceNano = roundHalfUp(
            BigInt(fill.priceNano) *
              BigInt(10_000 - EXPECTED_MANIFEST.stopLossBps), 10_000n);
          position = {
            quantitySat: fill.quantitySat, entryPriceNano: fill.priceNano,
            entryGrossCents: fill.grossCents, entryFeeCents: fill.feeCents,
            entryCostCents: cost, entrySignalId: causalSignal.id,
            stopPriceNano: String(stopPriceNano)
          };
        } else if (fill.side === "SELL") {
          const isStop = fill.reason === "SAMPLED_2PCT_BID_STOP";
          if ((!causalSignal && !isStop) || !position ||
              position.quantitySat !== fill.quantitySat) return false;
          if (isStop && (BigInt(quote.bidNano) > BigInt(position.stopPriceNano) ||
              fill.signalAt < event.ticker.receivedAt)) return false;
          const proceeds = fill.grossCents - fill.feeCents;
          cash += proceeds;
          realized += proceeds - position.entryCostCents;
          position = null;
        } else {
          return false;
        }
        fees += fill.feeCents;
        fills.push(fill);
      }
    }
  } catch {
    return false;
  }

  const ledger = checkpoint.ledger;
  if (ledger.initialCashCents !== EXPECTED_MANIFEST.initialCashCents ||
      !same(fills, report.fills) || !same(ledger.fills, report.fills) ||
      cash !== report.cashCents || fees !== report.feesCents ||
      realized !== report.realizedPnlCents ||
      ledger.cashCents !== report.cashCents || ledger.feesCents !== report.feesCents ||
      ledger.realizedPnlCents !== report.realizedPnlCents ||
      !same(ledger.position, report.position) ||
      !same(position, report.position && {
        quantitySat: report.position.quantitySat,
        entryPriceNano: report.position.entryPriceNano,
        entryGrossCents: report.position.entryGrossCents,
        entryFeeCents: report.position.entryFeeCents,
        entryCostCents: report.position.entryCostCents,
        entrySignalId: report.position.entrySignalId,
        stopPriceNano: report.position.stopPriceNano
      })) return false;
  const unrealized = report.position ?
    report.lastMark?.netExitCents - report.position.entryCostCents : 0;
  const expectedEquity = cash + (report.position ? report.lastMark?.netExitCents : 0);
  const latestObservation = events.filter(event => event.type === "observation" ||
    event.dataGap === "MISSED_DECISION_WINDOW").at(-1);
  const lastQuote = latestObservation && parsedQuotes.get(latestObservation.id);
  const markValid = !report.position || Boolean(lastQuote && report.lastMark &&
    report.lastMark.bidNano === lastQuote.bidNano &&
    report.lastMark.receivedAt === lastQuote.receivedAt &&
    report.lastMark.exitPriceNano === String(roundHalfUp(
      BigInt(lastQuote.bidNano) *
        BigInt(10_000 - EXPECTED_MANIFEST.slippageBpsPerSide), 10_000n)) &&
    report.lastMark.netExitCents === Number(roundHalfUp(
      BigInt(report.position.quantitySat) *
        BigInt(report.lastMark.exitPriceNano), NOTIONAL_DIVISOR)) -
      Number(roundHalfUp(
        BigInt(Number(roundHalfUp(BigInt(report.position.quantitySat) *
          BigInt(report.lastMark.exitPriceNano), NOTIONAL_DIVISOR))) *
          BigInt(EXPECTED_MANIFEST.feeBpsPerSide), 10_000n)) &&
    report.lastMark.unrealizedPnlCents === unrealized &&
    report.lastMark.ageMs === report.endedAt - report.lastMark.receivedAt);
  return markValid && isInteger(unrealized) && unrealized === report.unrealizedPnlCents &&
    isInteger(expectedEquity) && expectedEquity === report.equityCents &&
    EXPECTED_MANIFEST.initialCashCents + report.realizedPnlCents +
      report.unrealizedPnlCents === report.equityCents &&
    EXPECTED_MANIFEST.initialCashCents + report.realizedPnlCents -
    (report.position?.entryCostCents ?? 0) === report.cashCents &&
    (report.position ?
      report.positionStatus === "OPEN_UNRESOLVED_AT_TERMINAL" &&
        report.lastMark && isInteger(report.lastMark.ageMs) && report.lastMark.ageMs >= 0 :
      report.positionStatus === "FLAT" && report.lastMark === null &&
        report.unrealizedPnlCents === 0);
}

export function assessPaperEvidence({
  paperExitCode, paperReport, readback, provenance, responseBodies,
  profileId = DEFAULT_PAPER_EVIDENCE_PROFILE_ID, expectedDispatch,
  expectedHostContext, hostManifest, hostManifestSha256, hostState
}) {
  const isHostProfile = profileId === HOST_EIGHT_HOUR_PROFILE_ID;
  const expected = getPaperEvidenceProfile(profileId, { hostManifest });
  const report = readback?.report;
  const events = readback?.events;
  const terminal = Array.isArray(events) ? events.at(-1) : null;
  const terminalVerified = readback?.reconciliation === "TERMINAL_REPORT_AVAILABLE" &&
    readback.resumed === false && readback.executionImpact === false &&
    readback.runId === report?.runId && readback.eventCount === events?.length &&
    terminal?.id === "run-terminal" && same(terminal.report, report) &&
    same(paperReport, report) && report?.schemaVersion === "SPOT_PAPER_PILOT_REPORT_V1";
  const failures = [];
  const hostContextVerification = isHostProfile ? verifyExpectedHostContext({
    expectedHostContext, hostManifest, hostManifestSha256, hostState, readback
  }) : null;
  const dispatchIdentity = profileId === FOUR_HOUR_DISPATCH_PROFILE_ID ?
    verifyFourHourDispatchIdentity({
      expectedDispatch, provenance,
      runIds: [readback?.runId, report?.runId].filter(value => value !== undefined)
    }) : isHostProfile ? "NOT_APPLICABLE" : "PASS";
  const contextStatus = isHostProfile ? hostContextVerification.status : dispatchIdentity;
  let marketEvidence = { valid: false, acceptedObservations: 0, parsedQuotes: new Map() };

  if (terminalVerified) {
    if (dispatchIdentity === "FAILED") failures.push("TRUSTED_DISPATCH_IDENTITY_MISMATCH");
    if (isHostProfile) {
      if (hostContextVerification.status === "FAILED") {
        failures.push(hostContextVerification.reason);
      }
      if (hostState?.schemaVersion !== "SPOT_PAPER_HOST_STATE_V1" ||
          hostState.status !== "CHILD_EXITED" || hostState.childExitCode !== 0 ||
          hostState.childSignal !== null || hostState.interruptedBy !== null) {
        failures.push("HOST_CHILD_TERMINATION_UNVERIFIED");
      }
    } else if (!verifyProvenance(provenance, report.runId, expected) ||
        provenance.runId !== report.runId) {
      failures.push("SOURCE_OR_FRESH_RUN_BINDING_FAILED");
    }
    const manifest = readback.manifest;
    if (!manifest || manifest.schemaVersion !== "SPOT_PAPER_PILOT_MANIFEST_V1" ||
        manifest.mode !== expected.mode || manifest.model !== expected.model ||
        manifest.pair !== expected.pair || manifest.startedAt !== report.startedAt ||
        manifest.limits?.maxCycles !== expected.maxCycles ||
        manifest.limits?.maxRequests !== expected.maxRequests ||
        manifest.limits?.maxDurationMs !== expected.maxDurationMs ||
        manifest.limits?.pollIntervalMs !== expected.pollIntervalMs ||
        manifest.limits?.requestTimeoutMs !== expected.requestTimeoutMs ||
        manifest.limits?.maxBytes !== expected.maxBytes ||
        manifest.limits?.maxResponseBytes !== expected.maxResponseBytes) {
      failures.push("ENGINE_MANIFEST_MISMATCH");
    }
    const elapsedMs = report.endedAt - report.startedAt;
    if (!isInteger(report.startedAt) || !isInteger(report.endedAt) ||
        report.startedAt !== manifest?.startedAt || report.endedAt < report.startedAt ||
        elapsedMs > expected.maxDurationMs + TERMINAL_WRITE_GRACE_MS ||
        terminal.at !== report.endedAt) {
      failures.push("RUNTIME_BOUND_OR_TIMESTAMP_INVALID");
    }
    if (report.model !== expected.model || report.mode !== expected.mode ||
        report.pair !== expected.pair ||
        report.executionImpact !== false || report.liveTrading !== false ||
        report.autoPromotion !== false || report.profitability !== "NOT_ASSESSED" ||
        !engineBoundsMatch()) {
      failures.push("REPORT_SAFETY_OR_IDENTITY_MISMATCH");
    }
    const observations = events.filter(event => event.type === "observation").length;
    const dataGaps = events.filter(event => event.type === "data_gap").length;
    marketEvidence = verifyMarketEvidence(events, responseBodies);
    if (!marketEvidence.valid) failures.push("REQUIRED_RAW_MARKET_EVIDENCE_INVALID");
    const signals = [...new Map(events.flatMap(event => event.signals ?? [])
      .map(signal => [signal.id, signal])).values()];
    const checkpoint = readback.checkpoint;
    if (!isInteger(report.observations) || report.observations !== observations ||
        !isInteger(report.dataGaps) || report.dataGaps !== dataGaps ||
        !isInteger(report.requests) || report.requests < observations * 2 ||
        report.requests > expected.maxRequests ||
        !isInteger(report.deliveredBytes) || report.deliveredBytes < 0 ||
        report.deliveredBytes > expected.maxBytes ||
        !same(report.signals, signals) ||
        checkpoint?.counters?.requests !== report.requests ||
        checkpoint?.counters?.bytes !== report.deliveredBytes ||
        checkpoint?.stopReason !== report.stopReason ||
        !isInteger(checkpoint?.cycle) || checkpoint.cycle < 0 ||
        checkpoint.cycle > expected.maxCycles ||
        checkpoint.cycle !== observations + dataGaps ||
        events.length !== checkpoint.cycle + 2 ||
        (report.stopReason === "CYCLE_LIMIT" &&
         checkpoint.cycle !== expected.maxCycles) ||
        report.requests > checkpoint.cycle * 2) {
      failures.push("COUNTER_OR_SIGNAL_RECONCILIATION_FAILED");
    }
    if (!verifyLedger(events, checkpoint, report, marketEvidence.parsedQuotes)) {
      failures.push("INTEGER_LEDGER_OR_CAUSAL_FILL_RECONCILIATION_FAILED");
    }
  }

  const bounded = terminalVerified && failures.length === 0 &&
    contextStatus === "PASS" &&
    paperExitCode === 0 && report.operationalStatus === "COMPLETED_BOUNDED" &&
    ["CYCLE_LIMIT", "DURATION_LIMIT"].includes(report.stopReason);
  const completed = bounded && marketEvidence.valid &&
    marketEvidence.acceptedObservations > 0;
  const outcome = contextStatus === "FAILED" ? "FAILED" :
    !terminalVerified || contextStatus === "UNKNOWN" ?
      "UNKNOWN" : completed ? "COMPLETED" : "FAILED";
  const reasons = Array.isArray(events) ? events
    .filter(event => event.type === "data_gap" && (event.reason || event.dataGap))
    .map(event => event.reason ?? event.dataGap) : [];
  if (!terminalVerified) reasons.push("UNVERIFIED_TERMINAL_READBACK");
  if (report?.stopReason) reasons.push(report.stopReason);
  if (paperExitCode !== 0) reasons.push("PAPER_PROCESS_EXIT_NONZERO_OR_UNKNOWN");
  if (failures.length) reasons.push(...failures);
  const markAgeMs = report?.lastMark?.ageMs ?? null;
  const elapsedMs = isInteger(report?.startedAt) && isInteger(report?.endedAt) &&
    report.endedAt >= report.startedAt ? report.endedAt - report.startedAt : null;
  const cycles = isInteger(readback?.checkpoint?.cycle) ? readback.checkpoint.cycle : null;
  const durationCoverage = elapsedMs === null ? null :
    elapsedMs / expected.maxDurationMs;
  const riskStop = ["SAMPLED_2PCT_BID_STOP", "SESSION_LOSS_LIMIT"]
    .includes(report?.stopReason);
  const runClassification = contextStatus === "FAILED" ? "FAILED_EVIDENCE" :
    !terminalVerified || contextStatus === "UNKNOWN" ? "UNKNOWN" :
    riskStop ? "RISK_STOP" : failures.length || paperExitCode !== 0 ?
      "FAILED_EVIDENCE" : completed && report.stopReason === "DURATION_LIMIT" &&
        elapsedMs >= expected.maxDurationMs ?
        expected.maxDurationMs === 3_600_000 ? "COMPLETED_HOUR" :
          expected.maxDurationMs === 14_400_000 ? "COMPLETED_FOUR_HOURS" :
            "COMPLETED_EIGHT_HOURS" : completed ? "PARTIAL_BOUNDED_RUN" :
          bounded ? "FAILED_DATA_ACCEPTANCE" : "STOPPED_OR_LIMITED";
  const fills = Array.isArray(report?.fills) ? report.fills : [];
  const fillRows = fills.map(fill => ({
    id: fill?.id ?? null,
    side: fill?.side ?? null,
    turnoverCents: isInteger(fill?.grossCents) && fill.grossCents >= 0 ?
      fill.grossCents : null,
    feeCents: isInteger(fill?.feeCents) && fill.feeCents >= 0 ?
      fill.feeCents : null
  }));
  const validFillAccounting = fillRows.every(fill =>
    fill.turnoverCents !== null && fill.feeCents !== null);
  const fillCostReport = {
    turnoverDefinition: "Sum of gross simulated notional on each fill; both sides of a round trip count.",
    fills: fillRows,
    grossTurnoverCents: validFillAccounting ?
      fillRows.reduce((total, fill) => total + fill.turnoverCents, 0) : null,
    feesCents: validFillAccounting ?
      fillRows.reduce((total, fill) => total + fill.feeCents, 0) : null
  };
  const fullDuration = elapsedMs !== null && elapsedMs >= expected.maxDurationMs;

  return {
    outcome,
    profileId: expected.profileId,
    dispatchIdentity,
    expectedHostContext: hostContextVerification?.status ?? "NOT_APPLICABLE",
    hostContextBinding: hostContextVerification?.binding ?? "NOT_APPLICABLE",
    imageIdentity: hostContextVerification?.imageIdentity ?? "NOT_APPLICABLE",
    hostIdentity: hostContextVerification?.hostIdentity ?? "NOT_APPLICABLE",
    sourceAuthenticity: isHostProfile ? "UNATTESTED" : "NOT_APPLICABLE",
    clockAuthenticity: isHostProfile ? "UNATTESTED" : "NOT_ASSESSED",
    providerAuthenticity: isHostProfile ? "UNATTESTED" : "NOT_ASSESSED",
    launchReadiness: "NOT_ASSESSED",
    runClassification,
    terminalVerified,
    boundedTermination: bounded,
    startedAt: report?.startedAt ?? null,
    endedAt: report?.endedAt ?? null,
    elapsedMs,
    cycleCount: cycles,
    cycleCoverage: cycles === null ? null : cycles / expected.maxCycles,
    acceptedObservationCoverage: cycles ? marketEvidence.acceptedObservations / cycles : null,
    gapCoverage: cycles && isInteger(report?.dataGaps) ? report.dataGaps / cycles : null,
    durationCoverage,
    durationStatus: elapsedMs === null ? "UNKNOWN" :
      fullDuration ? "FULL_REQUESTED_DURATION" : "PARTIAL_BOUNDED_DURATION",
    acceptedObservations: marketEvidence.acceptedObservations,
    executionImpact: false,
    dataAcceptance: bounded && failures.length === 0 &&
      marketEvidence.acceptedObservations > 0 ?
      "DATA_ACCEPTED" : bounded && failures.length === 0 ?
        "FAILED_DATA_ACCEPTANCE" : "NOT_ASSESSED",
    quoteAccountingReconciled: terminalVerified && failures.length === 0 &&
      marketEvidence.valid && marketEvidence.acceptedObservations > 0,
    signalReplay: "NOT_PERFORMED",
    profitability: "NOT_ASSESSED",
    runId: readback?.runId ?? report?.runId ?? null,
    sourceSha: isHostProfile ? hostManifest?.runtimeSourceSha256 ?? null :
      provenance?.acceptedSourceSha ?? null,
    observations: report?.observations ?? null,
    dataGaps: report?.dataGaps ?? null,
    requests: report?.requests ?? null,
    deliveredBytes: report?.deliveredBytes ?? null,
    signals: report?.signals ?? [],
    fills: report?.fills ?? [],
    fillCostReport,
    feesCents: report?.feesCents ?? null,
    cashCents: report?.cashCents ?? null,
    equityCents: report?.equityCents ?? null,
    realizedPnlCents: report?.realizedPnlCents ?? null,
    unrealizedPnlCents: report?.unrealizedPnlCents ?? null,
    position: report?.position ?? null,
    positionStatus: report?.positionStatus ?? "UNKNOWN",
    lastMark: report?.lastMark ?? null,
    openPositionAssessment: !report ? "UNKNOWN" : !report.position ? "FLAT" :
      markAgeMs === null ? "OPEN_MARK_MISSING" :
        markAgeMs > EXPECTED_MANIFEST.maxQuoteAgeMs ? "OPEN_MARK_STALE" :
          "OPEN_MARK_FRESH",
    markAgeMs,
    stopReason: report?.stopReason ?? null,
    reasons: [...new Set(reasons)],
    limitations: [
      "No SMA signal replay is performed; quote and accounting reconciliation does not validate strategy signals or fill-path behavior.",
      "No trades are forced; zero fills are valid but do not validate the strategy fill path.",
      "Profitability is not assessed, regardless of fills, PnL, or terminal equity."
    ],
    validationCriteria: {
      pinnedSourceAndFreshRun: terminalVerified &&
        contextStatus === "PASS" &&
        (isHostProfile ?
          hostContextVerification.binding === "CONTENT_BOUND" :
          !failures.includes("SOURCE_OR_FRESH_RUN_BINDING_FAILED")),
      requestedModeAndBounds: terminalVerified &&
        !failures.includes("ENGINE_MANIFEST_MISMATCH") &&
        !failures.includes("REPORT_SAFETY_OR_IDENTITY_MISMATCH") &&
        !failures.includes("RUNTIME_BOUND_OR_TIMESTAMP_INVALID") &&
        !failures.includes("COUNTER_OR_SIGNAL_RECONCILIATION_FAILED"),
      retainedEvidenceAndAccounting: terminalVerified && failures.length === 0 &&
        marketEvidence.valid && Boolean(terminalVerified),
      acceptedPublicObservations: completed && marketEvidence.acceptedObservations > 0,
      fullRequestedDuration: fullDuration,
      strategyPerformance: "NOT_ASSESSED"
    }
  };
}

async function main(argv, environment = process.env) {
  const [
    paperPath, readbackPath, exitCodeText, provenancePath, runDirectory, outputPath,
    profileId = DEFAULT_PAPER_EVIDENCE_PROFILE_ID
  ] = argv;
  if (!paperPath || !readbackPath || exitCodeText === undefined ||
      !provenancePath || !runDirectory || !outputPath) {
    throw new Error("Usage: paper-evidence-assessment.mjs <paper.json> <readback.json> <exit-code> <manifest.json> <run-directory> <assessment.json> [profile-id]");
  }
  const readJson = async path => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return null;
    }
  };
  const paperReport = await readJson(paperPath);
  const readback = await readJson(readbackPath);
  const provenance = await readJson(provenancePath);
  const responseBodies = {};
  for (const event of readback?.events ?? []) {
    for (const response of [event.ohlc, event.ticker]) {
      if (!rawReferenceValid(response) || responseBodies[response.sha256] !== undefined) continue;
      try {
        responseBodies[response.sha256] =
          await readFile(join(runDirectory, response.path), "utf8");
      } catch {
        responseBodies[response.sha256] = null;
      }
    }
  }
  const paperExitCode = /^\d+$/.test(exitCodeText) ? Number(exitCodeText) : null;
  const assessment = assessPaperEvidence({
    paperExitCode, paperReport, readback, provenance, responseBodies, profileId,
    expectedDispatch: expectedDispatchFromEnvironment(environment)
  });
  await writeFile(outputPath, `${JSON.stringify(assessment, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(assessment)}\n`);
  if (assessment.outcome !== "COMPLETED" ||
      assessment.dataAcceptance !== "DATA_ACCEPTED") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
