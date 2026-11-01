import {pathToFileURL} from "node:url";
import {UNSUPPORTED_REQUIRED_EVIDENCE} from "./adapters.mjs";
import {AuditLogger, PIPELINE_ROLES, processCandidate, scout} from "./stages.mjs";
import {PaperLedger} from "./ledger.mjs";
import {
  SYNTHETIC_SMART_WALLET_ALLOWLIST,
  SYNTHETIC_SOURCE,
  syntheticCandidate
} from "./synthetic-fixtures.mjs";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const ZERO_COSTS = Object.freeze({
  feeCents: 0,
  spreadCents: 0,
  slippageCents: 0,
  priceImpactCents: 0,
  networkCents: 0
});

export function runSyntheticReplay({now = Date.now()} = {}) {
  const candidate = syntheticCandidate(now);
  const discoveries = scout([candidate], {now, source: SYNTHETIC_SOURCE, maxCandidates: 1});
  const selected = discoveries.selected[0];
  const logger = new AuditLogger({maxEvents: 100});
  const {filters, analysis, auditTruncated} = processCandidate(selected, {
    now,
    holdUntil: now + EIGHT_HOURS_MS,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST,
    logger
  });
  const ledger = new PaperLedger({now, runId: "synthetic-replay"});
  const timeline = [
    {stage: "Scout", status: discoveries.selected.length ? "SELECTED" : "NO_CANDIDATE"},
    {stage: "Filter", status: filters.status},
    {stage: "Analyst", status: analysis.status, score: analysis.score}
  ];
  let authorization;
  let fill;
  if (filters.accepted && analysis.status === "PASS") {
    authorization = ledger.authorizeEntry({
      authorizationId: "synthetic-auth-1",
      candidate: selected,
      filterResult: filters,
      scoreResult: analysis,
      tickId: "synthetic-tick-1",
      now: now + 1000
    });
    timeline.push({stage: "Risk authorization", status: authorization.status});
    if (authorization.status === "AUTHORIZED") {
      fill = ledger.executeEntry(authorization, {
        eventId: "synthetic-entry-1",
        mint: selected.mint,
        chainId: selected.chainId,
        pool: selected.pool,
        quote: selected.quote,
        source: SYNTHETIC_SOURCE,
        observedAt: now + 2000,
        priceMicros: 10_000,
        decimals: selected.decimals,
        mode: "HYPOTHETICAL",
        executable: true,
        costs: ZERO_COSTS
      }, {now: now + 2000});
      timeline.push({stage: "Executor (simulated only)", status: fill.status});
    }
  }
  const report = ledger.finishRun({
    startedAt: now,
    now: now + EIGHT_HOURS_MS,
    marks: []
  });
  timeline.push({stage: "Logger", status: "REPORTED"});
  return {
    reportType: "SYNTHETIC_FIXTURE_REPLAY_ONLY",
    source: SYNTHETIC_SOURCE,
    networkAccessed: false,
    liveCandidateEvidence: false,
    roles: PIPELINE_ROLES,
    discovery: discoveries.discovery,
    realDataPreparation: {
      status: "BLOCKED",
      networkAccessed: false,
      executableAdapterAvailable: false,
      missingEvidence: UNSUPPORTED_REQUIRED_EVIDENCE
    },
    pipeline: timeline,
    filters,
    analysis,
    authorization: authorization ? {status: authorization.status, maxSpendCents: authorization.maxSpendCents?.toString()} : null,
    simulatedFill: fill ?? null,
    runEnd: report,
    ledger: ledger.summary(),
    audit: [...discoveries.audit, ...logger.report(), ...ledger.auditEvents()],
    auditTruncated,
    caveat: "Synthetic fixture outputs test plumbing only; they are not market observations, alpha evidence, or execution-realistic fills."
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(runSyntheticReplay(), null, 2)}\n`);
}
