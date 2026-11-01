import assert from "node:assert/strict";
import test from "node:test";
import {
  projectOperatorReport,
  renderOperatorReport
} from "../scripts/memecoin-paper/operator-report.mjs";
import {reportFixtures} from "./fixtures/memecoin-paper-operator-report/scenarios.mjs";

test("projects exact fixed-point totals and stable positive, negative, and zero-trade reports", () => {
  const positiveInput = reportFixtures.positiveReplay();
  const positive = projectOperatorReport(positiveInput);
  assert.equal(positive.trading.paperEntryFills, 1);
  assert.equal(positive.candidates.considered, 2);
  assert.equal(positive.candidates.accepted, 1);
  assert.equal(positive.candidates.rejected, 1);
  assert.equal(positive.valuation.realizedNetPnlCents, "30");
  assert.equal(positive.valuation.unrealizedNetPnlCents, "-20");
  assert.equal(positive.costs.totalCents, "29");
  assert.equal(positive.valuation.cashCents, "92000");
  assert.equal(projectOperatorReport(positiveInput).costs.totalCents, "29");
  assert.equal(positive.experiment.evidenceKind, "SYNTHETIC_FIXTURE");
  assert.equal(positive.experiment.sourceReadiness, "BLOCKED");
  assert.equal(positive.experiment.operationalStatus, "NOT_EVIDENCED");
  assert.equal(positive.controls.stops.filter(item => item.kind === "RUN_WINDOW").length, 1);
  assert.deepEqual(Object.keys(positive), [
    "schema", "experiment", "evidence", "candidates", "trading", "controls",
    "valuation", "costs", "unresolvedFills", "unresolvedFillsCoverage",
    "provenance", "provenanceCoverage"
  ]);
  assert.equal(JSON.stringify(positive), JSON.stringify(projectOperatorReport(positiveInput)));

  const negative = projectOperatorReport(reportFixtures.negativeReplay());
  assert.equal(negative.valuation.realizedGrossPnlCents, "-123");
  assert.equal(negative.valuation.realizedNetPnlCents, "-145");
  assert.equal(negative.valuation.unrealizedGrossPnlCents, "-480");
  assert.equal(negative.valuation.unrealizedNetPnlCents, "-520");

  const zeroTrade = projectOperatorReport(reportFixtures.zeroTradeReplay());
  assert.equal(zeroTrade.trading.status, "ZERO_TRADES");
  assert.equal(zeroTrade.trading.paperEntryFills, 0);
  assert.equal(zeroTrade.valuation.realizedNetPnlCents, "0");
  assert.equal(zeroTrade.valuation.unrealizedNetPnlCents, "0");
  assert.equal(zeroTrade.costs.totalCents, "0");
  assert.ok(zeroTrade.trading.noTradeReasons.some(item => item.reason.includes("liquidity")));
});

test("missing end marks remain unknown and do not reuse an earlier summary valuation", () => {
  const report = projectOperatorReport(reportFixtures.missingMarksReplay());
  assert.equal(report.valuation.status, "UNRESOLVED");
  assert.equal(report.valuation.unrealizedGrossPnlCents, null);
  assert.equal(report.valuation.unrealizedNetPnlCents, null);
  assert.equal(report.valuation.unresolvedPositions, 1);
  assert.equal(report.controls.openPositionCount, 1);
  assert.equal(report.controls.openPositions[0].markStatus, "VALUATION_UNAVAILABLE");

  const missingSummaryPositions = reportFixtures.missingMarksReplay();
  delete missingSummaryPositions.ledger.openPositions;
  const fallback = projectOperatorReport(missingSummaryPositions);
  assert.equal(fallback.controls.openPositionCount, 1);
  assert.equal(fallback.valuation.unresolvedPositions, 1);
});

test("incomplete reports preserve unknown accounting instead of implying zero", () => {
  const report = projectOperatorReport(reportFixtures.incompleteReplay());
  assert.equal(report.experiment.reportStatus, "INCOMPLETE");
  assert.equal(report.experiment.endAt, null);
  assert.equal(report.trading.status, "UNKNOWN");
  assert.equal(report.trading.paperEntryFills, null);
  assert.equal(report.valuation.cashCents, "92000");
  assert.equal(report.valuation.unrealizedNetPnlCents, null);
  assert.equal(report.controls.openPositionCount, 1);

  const contradictory = reportFixtures.positiveReplay();
  contradictory.simulatedFill = null;
  contradictory.ledger.eventCount = 1;
  assert.throws(() => projectOperatorReport(contradictory), /zero-fill evidence conflicts/);

  const missingAccounting = reportFixtures.zeroTradeReplay();
  delete missingAccounting.ledger;
  const missingEvidence = projectOperatorReport(missingAccounting);
  assert.equal(missingEvidence.trading.status, "UNKNOWN");
  assert.equal(missingEvidence.trading.paperEntryFills, null);

  for (const type of ["PAPER_FILL", "STOP_ARMED", "PAPER_EXIT"]) {
    const conflictingAudit = reportFixtures.zeroTradeReplay();
    conflictingAudit.audit.push({type});
    assert.throws(() => projectOperatorReport(conflictingAudit), /recorded paper fill/);
  }
});

test("checkpoint receipts expose evidenced unresolved exits, clock faults, and restart stops", () => {
  const exitReport = projectOperatorReport(reportFixtures.unresolvedExit());
  assert.equal(exitReport.experiment.reportStatus, "FINISHED");
  assert.equal(exitReport.trading.paperEntryFills, 1);
  assert.equal(exitReport.unresolvedFills.length, 1);
  assert.equal(exitReport.unresolvedFills[0].kind, "EXIT_UNRESOLVED");
  assert.equal(exitReport.valuation.unrealizedNetPnlCents, null);
  assert.equal(exitReport.valuation.unresolvedPositions, 1);

  const fault = projectOperatorReport(reportFixtures.clockFault());
  assert.ok(fault.controls.stops.some(item => item.kind === "CLOCK_STOP"));
  assert.equal(fault.experiment.reportStatus, "INCOMPLETE");

  const restart = projectOperatorReport(reportFixtures.restartStop());
  assert.ok(restart.controls.stops.some(item => item.kind === "RESTART_STOP"));
  assert.equal(projectOperatorReport(reportFixtures.clockFault()).controls.reservations, 1);

  const stopped = reportFixtures.positiveReplay();
  stopped.audit.push({
    type: "PAPER_EXIT", status: "CLOSED_PAPER", reason: "STOP",
    mint: "So11111111111111111111111111111111111111112"
  });
  assert.ok(projectOperatorReport(stopped).controls.stops.some(item => item.kind === "POSITION_STOP"));

  const noEntry = reportFixtures.checkpoint({
    results: [
      reportFixtures.receipt("entry:missing", "executeEntry", {
        status: "UNFILLED", reason: "fresh complete marks are required"
      }),
      reportFixtures.receipt("finish:empty", "finishRun", {
        status: "FINISHED", elapsedMs: 1000, openPositions: [], accounting: {
          cashCents: "100000",
          grossOpenValueCents: "0",
          estimatedExitCostsCents: "0",
          grossUnrealizedPnlCents: "0",
          netUnrealizedPnlCents: "0",
          realizedGrossPnlCents: "0",
          realizedNetPnlCents: "0",
          reconciliation: "fixture supplied totals"
        }
      })
    ]
  });
  noEntry.snapshot.summary.pnl.unrealizedGrossCents = "0";
  noEntry.snapshot.summary.pnl.unrealizedNetCents = "0";
  noEntry.snapshot.summary.lastKnownEquityCents = "100000";
  const noEntryReport = projectOperatorReport(noEntry);
  assert.equal(noEntryReport.trading.status, "ZERO_TRADES");
  assert.ok(noEntryReport.trading.noTradeReasons.some(item => item.gate === "entry-fill"));
});

test("exact duplicate receipts are idempotent while conflicts and mixed identities fail closed", () => {
  const duplicate = reportFixtures.checkpoint({
    results: [reportFixtures.receipt("same-command", "riskSnapshot", {status: "PASS"})]
  });
  duplicate.results.push(structuredClone(duplicate.results[0]));
  assert.equal(projectOperatorReport(duplicate).experiment.reportStatus, "INCOMPLETE");

  const conflict = structuredClone(duplicate);
  conflict.results[1].result = {status: "REJECT"};
  assert.throws(() => projectOperatorReport(conflict), /conflicting duplicate/);

  const badCount = reportFixtures.checkpoint({
    results: [reportFixtures.receipt("one-command", "riskSnapshot", {status: "PASS"})]
  });
  badCount.metadata.sequence += 1;
  assert.throws(() => projectOperatorReport(badCount), /receipt count/);

  const mixedExperiment = reportFixtures.checkpoint();
  mixedExperiment.snapshot.summary.runId = "different-experiment";
  assert.throws(() => projectOperatorReport(mixedExperiment), /mixed experiment identity/);

  const mixedWindow = reportFixtures.checkpoint();
  mixedWindow.metadata.deadlineAt += 1;
  assert.throws(() => projectOperatorReport(mixedWindow), /time bounds/);

  const start = Date.parse("2026-01-01T10:00:00.000Z");
  const mixedPool = reportFixtures.checkpoint({
    results: [
      reportFixtures.receipt("auth:first", "authorizeEntry", {
        status: "AUTHORIZED", chainId: "solana", mint: "So11111111111111111111111111111111111111112",
        pool: "11111111111111111111111111111112", quote: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        sampledAt: new Date(start).toISOString()
      }),
      reportFixtures.receipt("auth:second", "authorizeEntry", {
        status: "AUTHORIZED", chainId: "solana", mint: "So11111111111111111111111111111111111111112",
        pool: "11111111111111111111111111111113", quote: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        sampledAt: new Date(start + 1000).toISOString()
      })
    ]
  });
  assert.throws(() => projectOperatorReport(mixedPool), /mixed pool identity/);

  const mixedTime = reportFixtures.checkpoint({
    results: [reportFixtures.receipt("auth:late", "authorizeEntry", {
      status: "AUTHORIZED", chainId: "solana", mint: "So11111111111111111111111111111111111111112",
      pool: "11111111111111111111111111111112", quote: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      sampledAt: new Date(start + 8 * 60 * 60 * 1000 + 1).toISOString()
    })]
  });
  assert.throws(() => projectOperatorReport(mixedTime), /mixed time identity/);

  const mixedPositions = reportFixtures.positiveReplay();
  mixedPositions.runEnd.openPositions[0].mint = "11111111111111111111111111111113";
  assert.throws(() => projectOperatorReport(mixedPositions), /mixed identity/);
});

test("untrusted metadata is bounded and safely escaped in readable text", () => {
  const input = reportFixtures.blockedScan();
  input.filters.checks.liquidity.reason =
    "line one\n\u001b[31mred\u001b[0m https://unsafe.example/path\u0000";
  const report = projectOperatorReport(input);
  const text = renderOperatorReport(report);
  assert.match(text, /Evidence freshness: UNKNOWN/);
  assert.match(text, /operationally running: NOT EVIDENCED/);
  assert.match(text, /\[url\]/);
  assert.match(text, /\[escape\]/);
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /\u001b|\u0000/);
  assert.ok(text.indexOf("PAPER OPERATOR REPORT") < text.indexOf("mint="));
  assert.doesNotMatch(text.slice(0, text.indexOf("Details (")), /So111|EPjFW|111111/);
  assert.ok(Buffer.byteLength(text) < 262_144);

  const alteredDto = structuredClone(report);
  alteredDto.valuation.cashCents = "1\nFORGED";
  alteredDto.candidates.considered = "2\u001b[31m";
  alteredDto.costs.totalCents = "https://unsafe.example/";
  alteredDto.trading.paperEntryFills = "5";
  const safeDtoText = renderOperatorReport(alteredDto);
  assert.match(safeDtoText, /Cash: UNKNOWN/);
  assert.match(safeDtoText, /Candidates: considered UNKNOWN/);
  assert.match(safeDtoText, /Paper entry fills: UNKNOWN/);
  assert.match(safeDtoText, /Reported costs: UNKNOWN/);
  assert.doesNotMatch(safeDtoText, /FORGED|https?:\/\/|unsafe\.example/);

  const oscInput = reportFixtures.blockedScan();
  oscInput.filters.checks.liquidity.reason = "\u001b]".repeat(20_000);
  const oscReport = projectOperatorReport(oscInput);
  const sanitizedReason = oscReport.candidates.details
    .find(candidate => candidate.status === "UNKNOWN").reasons[0].reason;
  assert.ok(sanitizedReason.length <= 240);
  assert.doesNotMatch(sanitizedReason, /\u001b/);
});

test("input, amount, count, and report-contract limits are enforced", () => {
  const oversized = reportFixtures.positiveReplay();
  oversized.metadata = {hostile: "x".repeat(1_048_577)};
  assert.throws(() => projectOperatorReport(oversized), /1 MiB/);

  const imprecise = reportFixtures.positiveReplay();
  imprecise.ledger.cashCents = 9_007_199_254_740_993;
  assert.throws(() => projectOperatorReport(imprecise), /non-exact/);

  const huge = reportFixtures.positiveReplay();
  huge.ledger.cashCents = "9".repeat(129);
  assert.throws(() => projectOperatorReport(huge), /decimal amount/);

  assert.throws(() => projectOperatorReport({reportType: "UNKNOWN"}), /unsupported/);
  assert.throws(() => renderOperatorReport({schema: "other"}), /strict operator report DTO/);
});

test("zero candidate scan, missing candidate contracts, and non-finite times stay explicit", () => {
  const empty = reportFixtures.blockedScan();
  empty.discovery.observedRecords = 0;
  empty.audit = empty.audit.filter(event => event.stage !== "Scout");
  const emptyReport = projectOperatorReport(empty);
  assert.equal(emptyReport.candidates.considered, 0);
  assert.equal(emptyReport.candidates.unknown, 0);

  const missing = reportFixtures.incompleteReplay();
  delete missing.discovery;
  delete missing.filters;
  delete missing.audit;
  const missingReport = projectOperatorReport(missing);
  assert.equal(missingReport.candidates.considered, null);
  assert.equal(missingReport.evidence.status, "UNKNOWN");

  const inconsistent = reportFixtures.positiveReplay();
  inconsistent.audit.find(event => event.stage === "Scout" && event.status === "SELECTED").sampledAt =
    "2026-01-02T00:00:00.000Z";
  assert.throws(() => projectOperatorReport(inconsistent), /time identity/);
});

test("discovery and Scout audit truncation preserve unaccounted candidate rows", () => {
  const partial = reportFixtures.blockedScan();
  const scoutRows = partial.audit.filter(row => row.stage === "Scout");
  const selected = scoutRows.find(row => row.status === "SELECTED");
  const duplicate = scoutRows.find(row => row.status === "REJECT");
  const otherRows = partial.audit.filter(row => row.stage !== "Scout");
  partial.audit = [selected, ...Array.from({length: 4}, () => structuredClone(duplicate)), ...otherRows];
  partial.discovery.observedRecords = 100;
  partial.discovery.truncated = true;

  const report = projectOperatorReport(partial);
  assert.equal(report.candidates.considered, 100);
  assert.equal(report.candidates.audited, 5);
  assert.equal(report.candidates.accepted, 0);
  assert.equal(report.candidates.rejected, 4);
  assert.equal(report.candidates.unknown, 1);
  assert.equal(report.candidates.unaccountedObserved, 95);
  assert.equal(report.candidates.discoveryTruncated, true);
  assert.equal(report.candidates.scoutAuditTruncated, true);
  assert.equal(report.candidates.detailsCoverage.total, 100);
  assert.equal(report.candidates.detailsCoverage.unaccounted, 95);
  assert.equal(report.evidence.coverage.discovery.scoutAuditRows, 5);
  assert.equal(report.trading.status, "ZERO_TRADES");

  partial.auditTruncated = true;
  const auditTruncated = projectOperatorReport(partial);
  assert.equal(auditTruncated.evidence.coverage.audit.truncated, true);
  assert.equal(auditTruncated.evidence.coverage.audit.totalRows, null);
  assert.equal(auditTruncated.trading.status, "UNKNOWN");

  const missingTotal = reportFixtures.blockedScan();
  delete missingTotal.discovery.observedRecords;
  const unknownTotal = projectOperatorReport(missingTotal);
  assert.equal(unknownTotal.candidates.considered, null);
  assert.equal(unknownTotal.candidates.unaccountedObserved, null);
  assert.equal(unknownTotal.candidates.detailsCoverage.total, null);
});

test("all capped report lists distinguish exact totals from 40-row display caps", () => {
  const replay = reportFixtures.blockedScan();
  const scoutRows = replay.audit.filter(row => row.stage === "Scout");
  const selected = scoutRows.find(row => row.status === "SELECTED");
  const duplicate = scoutRows.find(row => row.status === "REJECT");
  replay.audit = [
    selected,
    ...Array.from({length: 40}, () => structuredClone(duplicate)),
    ...replay.audit.filter(row => row.stage !== "Scout")
  ];
  replay.discovery.observedRecords = 41;
  const candidateReport = projectOperatorReport(replay);
  assert.equal(candidateReport.candidates.details.length, 40);
  assert.equal(candidateReport.candidates.detailsCoverage.observedTotal, 41);
  assert.equal(candidateReport.candidates.detailsCoverage.total, 41);
  assert.equal(candidateReport.candidates.detailsCoverage.displayed, 40);
  assert.equal(candidateReport.candidates.detailsCoverage.displayTruncated, true);
  assert.equal(candidateReport.provenance.length, 40);
  assert.equal(candidateReport.provenanceCoverage.total, 41);

  const manyReasons = reportFixtures.blockedScan();
  manyReasons.filters.checks = Object.fromEntries(Array.from({length: 41}, (_, index) => [
    `gate-${index}`,
    {status: "UNKNOWN", reason: `missing evidence ${index}`}
  ]));
  manyReasons.analysis.components = {};
  const reasonReport = projectOperatorReport(manyReasons);
  assert.equal(reasonReport.trading.noTradeReasons.length, 40);
  assert.equal(reasonReport.trading.noTradeReasonsCoverage.total, 42);
  assert.equal(reasonReport.trading.noTradeReasonsCoverage.displayTruncated, true);

  const stopResults = Array.from({length: 41}, (_, index) =>
    reportFixtures.receipt(`clock:${index}`, "riskSnapshot", {
      status: "BLOCKED", reason: "CLOCK_FAULT_LATCHED", entriesAllowed: false
    }));
  const stops = projectOperatorReport(reportFixtures.checkpoint({results: stopResults}));
  assert.equal(stops.controls.stops.length, 40);
  assert.equal(stops.controls.stopsCoverage.total, 41);
  assert.equal(stops.controls.stopsCoverage.displayed, 40);
  assert.equal(stops.controls.stopsCoverage.displayTruncated, true);

  const positions = Array.from({length: 41}, (_, index) => ({
    ...reportFixtures.positiveReplay().ledger.openPositions[0],
    mint: `mint-${index}`
  }));
  const positionReport = projectOperatorReport(reportFixtures.checkpoint({positions}));
  assert.equal(positionReport.controls.openPositions.length, 40);
  assert.equal(positionReport.controls.openPositionsCoverage.total, 41);
  assert.equal(positionReport.controls.openPositionsCoverage.displayTruncated, true);

  const unresolvedResults = Array.from({length: 41}, (_, index) =>
    reportFixtures.receipt(`entry:${index}`, "executeEntry", {
      status: "UNFILLED", reason: "fixture entry was not filled"
    }));
  const unresolved = projectOperatorReport(reportFixtures.checkpoint({results: unresolvedResults}));
  assert.equal(unresolved.unresolvedFills.length, 40);
  assert.equal(unresolved.unresolvedFillsCoverage.total, 41);
  assert.equal(unresolved.unresolvedFillsCoverage.displayed, 40);
  assert.equal(renderOperatorReport(unresolved).match(/unresolved fills: 41/)[0], "unresolved fills: 41");
});
