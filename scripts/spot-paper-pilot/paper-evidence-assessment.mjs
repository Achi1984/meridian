import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseKrakenOhlc, parseKrakenTicker, sha256, SPOT_PAPER_PILOT_LIMITS
} from "./core.mjs";

export const ACCEPTED_PAPER_SOURCE_SHA = "81edf0b5dc3d455c2c1e1906791d56c731bea0c9";

const EXPECTED_MANIFEST = Object.freeze({
  schemaVersion: "SPOT_PAPER_PILOT_DISPATCH_MANIFEST_V1",
  model: "BTC_EUR_SMA5_SMA20_V1",
  mode: "paper",
  pair: "BTC/EUR",
  maxCycles: 60,
  maxRequests: 120,
  maxDurationMs: 3_600_000,
  pollIntervalMs: 60_000,
  requestTimeoutMs: 5_000,
  maxBytes: 67_108_864,
  maxResponseBytes: 262_144,
  maxOpenPositions: 1,
  maxQuoteAgeMs: 10_000,
  maxCandleAgeMs: 120_000,
  initialCashCents: 100_000,
  maxExposureCents: 10_000,
  maxSessionLossCents: 2_000,
  stopLossBps: 200,
  maxEntrySpreadBps: 50,
  feeBpsPerSide: 50,
  slippageBpsPerSide: 10,
  smaFast: 5,
  smaSlow: 20,
  warmupCandles: 21
});
const NOTIONAL_DIVISOR = 100_000_000_000_000n;
const TERMINAL_WRITE_GRACE_MS = 5_000;

const isInteger = value => Number.isSafeInteger(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const roundHalfUp = (numerator, denominator) =>
  (numerator * 2n + denominator) / (2n * denominator);
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

function verifyProvenance(provenance, runId) {
  if (!provenance || provenance.schemaVersion !== EXPECTED_MANIFEST.schemaVersion ||
      provenance.acceptedSourceSha !== ACCEPTED_PAPER_SOURCE_SHA ||
      !/^[a-f0-9]{40}$/.test(provenance.workflowSha ?? "") ||
      !/^\d+$/.test(String(provenance.workflowRunId ?? "")) ||
      provenance.workflowRunNumber !== 1 || provenance.workflowRunAttempt !== 1 ||
      runId !== `spot-paper-${provenance.workflowRunId}-${provenance.workflowRunAttempt}`) {
    return false;
  }
  return Object.entries(EXPECTED_MANIFEST).every(([key, value]) =>
    provenance[key] === value);
}

function verifyLedger(events, checkpoint, report, responseBodies) {
  if (!Array.isArray(events) || !checkpoint?.ledger || !report ||
      !responseBodies || typeof responseBodies !== "object") return false;
  const fills = [];
  let cash = EXPECTED_MANIFEST.initialCashCents;
  let fees = 0;
  let realized = 0;
  let position = null;
  const parsedQuotes = new Map();
  try {
    for (const event of events) {
      const needsMarketEvidence = event.type === "observation" ||
        (event.type === "data_gap" && event.dataGap === "MISSED_DECISION_WINDOW");
      if (needsMarketEvidence && (!event.ohlc || !event.ticker)) return false;
      if (!event.ohlc || !event.ticker) continue;
      if (!rawReferenceValid(event.ohlc) || !rawReferenceValid(event.ticker) ||
          !isInteger(event.signalKnownAt) ||
          event.ticker.requestStartedAt < event.signalKnownAt) return false;
      const ohlcRaw = responseBodies[event.ohlc.sha256];
      const tickerRaw = responseBodies[event.ticker.sha256];
      if (typeof ohlcRaw !== "string" || typeof tickerRaw !== "string" ||
          Buffer.byteLength(ohlcRaw, "utf8") !== event.ohlc.bytes ||
          Buffer.byteLength(tickerRaw, "utf8") !== event.ticker.bytes ||
          sha256(Buffer.from(ohlcRaw, "utf8")) !== event.ohlc.sha256 ||
          sha256(Buffer.from(tickerRaw, "utf8")) !== event.ticker.sha256) return false;
      const ohlc = parseKrakenOhlc({
        raw: ohlcRaw, sha256: event.ohlc.sha256,
        requestStartedAt: event.ohlc.requestStartedAt,
        receivedAt: event.ohlc.receivedAt,
        data: JSON.parse(ohlcRaw)
      }, event.ohlc.receivedAt);
      if (ohlc.latestClosedAt !== event.ohlc.latestClosedAt) return false;
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
          event.ticker.acquisitionAgeMs > EXPECTED_MANIFEST.maxQuoteAgeMs) return false;
      parsedQuotes.set(event.id, quote);
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
        const causalSignal = eventSignals.find(signal =>
          fill.id === `${fill.side === "BUY" ? "entry" : "exit"}:${signal.id}` &&
          fill.signalAt === signal.candleAt &&
          signal.direction === (fill.side === "BUY" ? "ENTRY" : "EXIT"));
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
  if (!same(fills, report.fills) || !same(ledger.fills, report.fills) ||
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
  const openEntryCost = report.position?.entryCostCents ?? 0;
  const expectedCash = EXPECTED_MANIFEST.initialCashCents +
    report.realizedPnlCents - openEntryCost;
  const expectedEquity = EXPECTED_MANIFEST.initialCashCents +
    report.realizedPnlCents + report.unrealizedPnlCents;
  const latestObservation = events.filter(event => event.ohlc && event.ticker).at(-1);
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
  return markValid && isInteger(openEntryCost) && isInteger(expectedCash) &&
    expectedCash === report.cashCents &&
    isInteger(unrealized) && unrealized === report.unrealizedPnlCents &&
    isInteger(expectedEquity) && expectedEquity === report.equityCents &&
    (report.position ?
      report.positionStatus === "OPEN_UNRESOLVED_AT_TERMINAL" &&
        report.lastMark && isInteger(report.lastMark.ageMs) && report.lastMark.ageMs >= 0 :
      report.positionStatus === "FLAT" && report.lastMark === null &&
        report.unrealizedPnlCents === 0 &&
        (fills.length > 0 ||
          (report.cashCents === EXPECTED_MANIFEST.initialCashCents &&
            report.equityCents === EXPECTED_MANIFEST.initialCashCents &&
            report.feesCents === 0 && report.realizedPnlCents === 0)));
}

export function assessPaperEvidence({
  paperExitCode, paperReport, readback, provenance, responseBodies
}) {
  const report = readback?.report;
  const events = readback?.events;
  const terminal = Array.isArray(events) ? events.at(-1) : null;
  const terminalVerified = readback?.reconciliation === "TERMINAL_REPORT_AVAILABLE" &&
    readback.resumed === false && readback.executionImpact === false &&
    readback.runId === report?.runId && readback.eventCount === events?.length &&
    terminal?.id === "run-terminal" && same(terminal.report, report) &&
    same(paperReport, report) && report?.schemaVersion === "SPOT_PAPER_PILOT_REPORT_V1";
  const failures = [];

  if (terminalVerified) {
    if (!verifyProvenance(provenance, report.runId) ||
        provenance.runId !== report.runId) {
      failures.push("SOURCE_OR_FRESH_RUN_BINDING_FAILED");
    }
    const manifest = readback.manifest;
    if (!manifest || manifest.schemaVersion !== "SPOT_PAPER_PILOT_MANIFEST_V1" ||
        manifest.mode !== "paper" || manifest.model !== EXPECTED_MANIFEST.model ||
        manifest.pair !== EXPECTED_MANIFEST.pair || manifest.startedAt !== report.startedAt ||
        manifest.limits?.maxCycles !== EXPECTED_MANIFEST.maxCycles ||
        manifest.limits?.maxRequests !== EXPECTED_MANIFEST.maxRequests ||
        manifest.limits?.maxDurationMs !== EXPECTED_MANIFEST.maxDurationMs ||
        manifest.limits?.pollIntervalMs !== EXPECTED_MANIFEST.pollIntervalMs ||
        manifest.limits?.requestTimeoutMs !== EXPECTED_MANIFEST.requestTimeoutMs ||
        manifest.limits?.maxBytes !== EXPECTED_MANIFEST.maxBytes ||
        manifest.limits?.maxResponseBytes !== EXPECTED_MANIFEST.maxResponseBytes) {
      failures.push("ENGINE_MANIFEST_MISMATCH");
    }
    if (report.mode !== "paper" || report.pair !== EXPECTED_MANIFEST.pair ||
        report.executionImpact !== false || report.liveTrading !== false ||
        report.autoPromotion !== false || report.profitability !== "NOT_ASSESSED" ||
        !engineBoundsMatch()) {
      failures.push("REPORT_SAFETY_OR_IDENTITY_MISMATCH");
    }
    const observations = events.filter(event => event.type === "observation").length;
    const dataGaps = events.filter(event => event.type === "data_gap").length;
    const signals = [...new Map(events.flatMap(event => event.signals ?? [])
      .map(signal => [signal.id, signal])).values()];
    const checkpoint = readback.checkpoint;
    const acceptedObservations = observations;
    const elapsedValid = isInteger(report.startedAt) && isInteger(report.endedAt) &&
      report.endedAt >= report.startedAt &&
      report.endedAt - report.startedAt <=
        EXPECTED_MANIFEST.maxDurationMs + TERMINAL_WRITE_GRACE_MS;
    const elapsedMs = elapsedValid ? report.endedAt - report.startedAt : null;
    if (!isInteger(report.observations) || report.observations !== observations ||
        !isInteger(report.dataGaps) || report.dataGaps !== dataGaps ||
        !isInteger(report.requests) || report.requests < observations * 2 ||
        report.requests > EXPECTED_MANIFEST.maxRequests ||
        !isInteger(report.deliveredBytes) || report.deliveredBytes < 0 ||
        report.deliveredBytes > EXPECTED_MANIFEST.maxBytes ||
        !same(report.signals, signals) ||
        checkpoint?.counters?.requests !== report.requests ||
        checkpoint?.counters?.bytes !== report.deliveredBytes ||
        checkpoint?.stopReason !== report.stopReason ||
        !isInteger(checkpoint?.cycle) || checkpoint.cycle < 0 ||
        checkpoint.cycle > EXPECTED_MANIFEST.maxCycles ||
        checkpoint.cycle !== observations + dataGaps ||
        events.length !== checkpoint.cycle + 2 ||
        (report.stopReason === "CYCLE_LIMIT" &&
          checkpoint.cycle !== EXPECTED_MANIFEST.maxCycles) ||
        report.requests > checkpoint.cycle * 2 ||
        !elapsedValid) {
      failures.push("COUNTER_OR_SIGNAL_RECONCILIATION_FAILED");
    }
    if (!verifyLedger(events, checkpoint, report, responseBodies)) {
      failures.push("INTEGER_LEDGER_OR_CAUSAL_FILL_RECONCILIATION_FAILED");
    }
  }

  const acceptedObservations = Array.isArray(events) ?
    events.filter(event => event.type === "observation").length : null;
  const elapsedMs = isInteger(report?.startedAt) && isInteger(report?.endedAt) &&
    report.endedAt >= report.startedAt ? report.endedAt - report.startedAt : null;
  const evidenceAccepted = terminalVerified && failures.length === 0 &&
    paperExitCode === 0 && acceptedObservations > 0;
  const fullDuration = evidenceAccepted &&
    report.operationalStatus === "COMPLETED_BOUNDED" &&
    report.stopReason === "DURATION_LIMIT" &&
    elapsedMs >= EXPECTED_MANIFEST.maxDurationMs &&
    elapsedMs <= EXPECTED_MANIFEST.maxDurationMs + TERMINAL_WRITE_GRACE_MS;
  const boundedStop = ["CYCLE_LIMIT", "DURATION_LIMIT"].includes(report?.stopReason);
  const riskStop = ["SAMPLED_2PCT_BID_STOP", "SESSION_LOSS_LIMIT", "SIGNAL"]
    .includes(report?.stopReason);
  const outcome = !terminalVerified ? "UNKNOWN" :
    !evidenceAccepted ? "FAILED" : fullDuration ? "COMPLETED" :
      boundedStop || riskStop ? "PARTIAL" : "FAILED";
  const durationStatus = !terminalVerified ? "UNKNOWN" :
    !evidenceAccepted ? "FAILED_DATA_ACCEPTANCE" :
      fullDuration ? "FULL_DURATION" :
        report?.stopReason === "CYCLE_LIMIT" ? "PARTIAL_CYCLE_LIMIT" :
          report?.stopReason === "DURATION_LIMIT" ? "PARTIAL_DURATION" :
            riskStop ? "PARTIAL_RISK_STOP" : "PARTIAL_STOP";
  const cycles = isInteger(readback?.checkpoint?.cycle) ?
    readback.checkpoint.cycle : null;
  const reasons = Array.isArray(events) ? events
    .filter(event => event.type === "data_gap" && (event.reason || event.dataGap))
    .map(event => event.reason ?? event.dataGap) : [];
  if (!terminalVerified) reasons.push("UNVERIFIED_TERMINAL_READBACK");
  if (report?.stopReason) reasons.push(report.stopReason);
  if (paperExitCode !== 0) reasons.push("PAPER_PROCESS_EXIT_NONZERO_OR_UNKNOWN");
  if (failures.length) reasons.push(...failures);
  const markAgeMs = report?.lastMark?.ageMs ?? null;

  return {
    outcome,
    durationStatus,
    terminalVerified,
    boundedTermination: evidenceAccepted && boundedStop,
    executionImpact: false,
    dataAcceptance: evidenceAccepted ? "DATA_ACCEPTED" :
      terminalVerified ? "FAILED_DATA_ACCEPTANCE" : "NOT_ASSESSED",
    quoteAccountingReconciliation: terminalVerified && failures.length === 0 &&
      acceptedObservations > 0,
    signalReplay: "NOT_PERFORMED",
    profitability: "NOT_ASSESSED",
    runId: readback?.runId ?? report?.runId ?? null,
    sourceSha: provenance?.acceptedSourceSha ?? null,
    startedAt: report?.startedAt ?? null,
    endedAt: report?.endedAt ?? null,
    elapsedMs,
    durationCoverage: elapsedMs === null ? null :
      Math.min(1, elapsedMs / EXPECTED_MANIFEST.maxDurationMs),
    cycles,
    cycleCoverage: cycles === null ? null : cycles / EXPECTED_MANIFEST.maxCycles,
    acceptedObservations,
    observationCoverage: cycles === null || cycles === 0 ? null :
      acceptedObservations / cycles,
    observations: acceptedObservations,
    dataGaps: report?.dataGaps ?? null,
    requests: report?.requests ?? null,
    deliveredBytes: report?.deliveredBytes ?? null,
    signals: report?.signals ?? [],
    fills: report?.fills ?? [],
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
      "No trades are forced; zero fills are valid.",
      "Strategy signal replay is not performed; recorded fills do not validate the strategy fill path.",
      "A bounded cycle, risk, or early duration stop is a partial run, not a completed one-hour trial.",
      "Profitability is not assessed, regardless of fills, PnL, or terminal equity."
    ]
  };
}

async function main(argv) {
  const [paperPath, readbackPath, exitCodeText, provenancePath, runDirectory, outputPath] = argv;
  if (!paperPath || !readbackPath || exitCodeText === undefined ||
      !provenancePath || !runDirectory || !outputPath) {
    throw new Error("Usage: paper-evidence-assessment.mjs <paper.json> <readback.json> <exit-code> <manifest.json> <run-directory> <assessment.json>");
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
    paperExitCode, paperReport, readback, provenance, responseBodies
  });
  await writeFile(outputPath, `${JSON.stringify(assessment, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(assessment)}\n`);
  if (assessment.outcome !== "COMPLETED" &&
      assessment.outcome !== "PARTIAL") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
