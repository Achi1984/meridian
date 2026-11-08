const COMMON = Object.freeze({
  schemaVersion: "SPOT_PAPER_PILOT_DISPATCH_MANIFEST_V1",
  acceptedSourceSha: "81edf0b5dc3d455c2c1e1906791d56c731bea0c9",
  model: "BTC_EUR_SMA5_SMA20_V1",
  mode: "paper",
  pair: "BTC/EUR",
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

export const DEFAULT_PAPER_EVIDENCE_PROFILE_ID = "BTC_EUR_PAPER_1H_V1";
export const DEFAULT_SIGNAL_REPLAY_PROFILE_ID = "BTC_EUR_RUN_42395522899_V1";
export const HOST_EIGHT_HOUR_PROFILE_ID = "BTC_EUR_PAPER_HOST_8H_V1";

function hostProfile(hostManifest) {
  if (!hostManifest || hostManifest.schemaVersion !== "SPOT_PAPER_HOST_LAUNCH_V1") {
    throw new Error("VERIFIED_HOST_LAUNCH_MANIFEST_REQUIRED");
  }
  return Object.freeze({
    ...COMMON,
    profileId: HOST_EIGHT_HOUR_PROFILE_ID,
    runId: hostManifest.runId,
    runtimeSourceSha256: hostManifest.runtimeSourceSha256,
    model: hostManifest.model,
    mode: hostManifest.mode,
    pair: hostManifest.pair,
    maxCycles: hostManifest.maxCycles,
    maxRequests: hostManifest.maxRequests,
    maxDurationMs: hostManifest.maxDurationMs,
    pollIntervalMs: hostManifest.pollIntervalMs,
    maxBytes: hostManifest.maxBytes,
    maxResponseBytes: hostManifest.maxResponseBytes,
    requestTimeoutMs: hostManifest.requestTimeoutMs
  });
}

export const PAPER_EVIDENCE_PROFILES = Object.freeze({
  [DEFAULT_PAPER_EVIDENCE_PROFILE_ID]: Object.freeze({
    ...COMMON,
    profileId: DEFAULT_PAPER_EVIDENCE_PROFILE_ID,
    maxCycles: 60,
    maxRequests: 120,
    maxDurationMs: 3_600_000,
    pollIntervalMs: 60_000
  }),
  BTC_EUR_PAPER_4H_V1: Object.freeze({
    ...COMMON,
    profileId: "BTC_EUR_PAPER_4H_V1",
    maxCycles: 240,
    maxRequests: 480,
    maxDurationMs: 14_400_000,
    pollIntervalMs: 60_000
  })
});

export const SIGNAL_REPLAY_PROFILES = Object.freeze({
  [DEFAULT_SIGNAL_REPLAY_PROFILE_ID]: Object.freeze({
    ...PAPER_EVIDENCE_PROFILES[DEFAULT_PAPER_EVIDENCE_PROFILE_ID],
    profileId: DEFAULT_SIGNAL_REPLAY_PROFILE_ID,
    identity: Object.freeze({
      kind: "fixed",
      workflowSha: "ddae14f01583196dfc9e9da906dcd03d41d58369",
      workflowRunId: "42395522899",
      workflowRunNumber: 1,
      workflowRunAttempt: 1,
      runId: "spot-paper-42395522899-1"
    })
  }),
  BTC_EUR_PAPER_4H_V1: Object.freeze({
    ...PAPER_EVIDENCE_PROFILES.BTC_EUR_PAPER_4H_V1,
    identity: Object.freeze({ kind: "first-dispatch" })
  })
});

export function getPaperEvidenceProfile(profileId = DEFAULT_PAPER_EVIDENCE_PROFILE_ID,
  { hostManifest } = {}) {
  if (profileId === HOST_EIGHT_HOUR_PROFILE_ID) return hostProfile(hostManifest);
  if (!Object.hasOwn(PAPER_EVIDENCE_PROFILES, profileId)) {
    throw new Error("UNKNOWN_PAPER_EVIDENCE_PROFILE");
  }
  const profile = PAPER_EVIDENCE_PROFILES[profileId];
  return profile;
}

export function getSignalReplayProfile(profileId = DEFAULT_SIGNAL_REPLAY_PROFILE_ID,
  { hostManifest } = {}) {
  if (profileId === HOST_EIGHT_HOUR_PROFILE_ID) return hostProfile(hostManifest);
  if (!Object.hasOwn(SIGNAL_REPLAY_PROFILES, profileId)) {
    throw new Error("UNKNOWN_SIGNAL_REPLAY_PROFILE");
  }
  const profile = SIGNAL_REPLAY_PROFILES[profileId];
  return profile;
}
