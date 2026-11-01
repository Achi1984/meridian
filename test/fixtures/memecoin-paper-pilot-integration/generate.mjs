export const SYNTHETIC_RUN_ID = "synthetic-integration-run";
export const SYNTHETIC_START = 1_800_000_000_000;
export const SYNTHETIC_HASH = "a".repeat(64);
export const SYNTHETIC_DIGEST = "b".repeat(64);

export function createPilotFixture({candidateCount = 1, status = "ACQUISITION_FINISHED"} = {}) {
  const candidates = Array.from({length: candidateCount}, (_, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    const candidate = {
      chainId: "solana",
      mint: `synthetic-mint-${suffix}`,
      pool: `synthetic-pool-${suffix}`,
      quote: "synthetic-quote",
      source: "SYNTHETIC_TEST_ONLY",
      sampledAt: SYNTHETIC_START + 1_000,
      evidence: {}
    };
    return {candidate, identityStatus: "BOUND_TO_REQUEST", coverage: {synthetic: true}};
  });
  const requested = candidates.map(({candidate}) => ({
    chainId: candidate.chainId,
    mint: candidate.mint,
    pool: candidate.pool,
    quote: candidate.quote
  }));
  const manifest = {
    manifestVersion: "memecoin-paper-one-shot-v1",
    enabled: false,
    durationMs: 28_800_000,
    stopSwitch: {engaged: true},
    providers: [
      {name: "DexScreener public API", enabled: false},
      {name: "Solana mainnet public JSON-RPC", enabled: false}
    ],
    allowedMints: [],
    allowedPools: [],
    pollBudget: {
      intervalMs: 30_000,
      maxRequestsPerRun: 3,
      maxRequestsPerProvider: 2,
      maxBytesPerResponse: 100,
      maxBytesPerRun: 300,
      maxEvents: 10,
      maxCandidates: 10
    }
  };
  return {
    candidates,
    requested,
    manifest,
    providerResult: {
      status,
      networkAccessed: false,
      stoppedReason: null,
      events: [{
        eventId: "synthetic-provider-audit-1",
        provider: "dex",
        kind: "SYNTHETIC_REQUEST_AUDIT_ONLY"
      }],
      candidates,
      counters: {
        requests: 1,
        bytes: 42,
        events: 1,
        reservedBytes: 0,
        byProvider: {dex: 1, rpc: 0}
      }
    }
  };
}

export function createReportInput({
  runId = SYNTHETIC_RUN_ID,
  sequence = 1,
  hash = SYNTHETIC_HASH,
  receipt = {
    runId: SYNTHETIC_RUN_ID,
    sequence: 1,
    commandId: "synthetic-command-1",
    method: "executeEntry",
    resultDigest: SYNTHETIC_DIGEST
  }
} = {}) {
  return {
    reportType: "SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY",
    source: "SYNTHETIC_TEST_ONLY",
    liveCandidateEvidence: false,
    metadata: {
      runId,
      startedAt: SYNTHETIC_START,
      deadlineAt: SYNTHETIC_START + 28_800_000,
      sequence,
      hash
    },
    results: sequence === 0 ? [] : [{
      commandId: receipt.commandId,
      method: receipt.method,
      resultDigest: receipt.resultDigest,
      result: {runId, status: "SYNTHETIC_RESULT"}
    }],
    snapshot: {
      summary: {runId},
      auditEvents: []
    }
  };
}

export function createCheckpoint({
  runId = SYNTHETIC_RUN_ID,
  sequence = 1,
  hash = SYNTHETIC_HASH,
  receipt = {
    runId: SYNTHETIC_RUN_ID,
    sequence: 1,
    commandId: "synthetic-command-1",
    method: "executeEntry",
    resultDigest: SYNTHETIC_DIGEST
  }
} = {}) {
  const header = {
    sequence: 0,
    runId,
    commandId: "__header__",
    method: "constructor",
    resultDigest: SYNTHETIC_DIGEST
  };
  const records = sequence === 0 ? [header] : [
    header,
    {
      sequence,
      runId,
      commandId: receipt.commandId,
      method: receipt.method,
      resultDigest: receipt.resultDigest
    }
  ];
  const checkpoint = {
    runHeader: {runId},
    sequence,
    records
  };
  return {
    metadata: {
      runId,
      startedAt: SYNTHETIC_START,
      deadlineAt: SYNTHETIC_START + 28_800_000,
      sequence,
      hash
    },
    readback: {
      status: "OK",
      sequence,
      hash,
      bytes: new TextEncoder().encode(JSON.stringify(checkpoint))
    }
  };
}
