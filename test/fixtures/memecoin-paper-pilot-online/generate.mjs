import {PILOT_DEPENDENCY_PINS, READ_ONLY_PAPER} from "../../../scripts/memecoin-paper/pilot-online.mjs";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

export const FIXTURE_START = 1_800_000_000_000;
export const FIXTURE_RUN_ID = "pilot-online-fixture-001";
export const FIXTURE_IDENTITIES = Object.freeze([
  {
    chainId: "solana",
    mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
  }
]);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createRunConfig(overrides = {}) {
  const startAt = overrides.startAt ?? FIXTURE_START;
  const candidates = overrides.candidates ?? FIXTURE_IDENTITIES;
  const manifest = {
    enabled: true,
    mode: READ_ONLY_PAPER,
    execution: "SIMULATED_ONLY",
    runId: FIXTURE_RUN_ID,
    startAt,
    endAt: startAt + EIGHT_HOURS_MS,
    durationMs: EIGHT_HOURS_MS,
    stopSwitch: {engaged: false},
    http: {
      credentials: false,
      redirects: "error",
      arbitraryUrls: false,
      tokenProvidedUrls: false
    },
    providers: [
      {name: "DexScreener public API", host: "api.dexscreener.com", enabled: true},
      {name: "Solana mainnet public JSON-RPC", host: "api.mainnet-beta.solana.com", enabled: true}
    ],
    allowedMints: [...new Set(candidates.map(item => item.mint))].sort(),
    allowedPools: [...new Set(candidates.map(item => item.pool))].sort(),
    pollBudget: {
      maxRequestsPerRun: 8,
      maxRequestsPerProvider: 6,
      maxBytesPerResponse: 64,
      maxBytesPerRun: 1_024,
      maxEvents: 8,
      maxCandidates: 2
    }
  };
  const budgets = {
    requests: 8,
    dexRequests: 2,
    rpcRequests: 6,
    bytes: 1_024,
    providerEvents: 8,
    candidates: 2,
    events: 2,
    cycles: 4,
    pollIntervalMs: 60_000,
    callbackSettlementMs: 35_000,
    requestTimeoutMs: 5_000,
    ...overrides.budgets
  };
  return {
    version: 1,
    mode: READ_ONLY_PAPER,
    runId: FIXTURE_RUN_ID,
    startAt,
    endAt: startAt + EIGHT_HOURS_MS,
    dependencyPins: {...PILOT_DEPENDENCY_PINS},
    manifest,
    candidates: [...candidates],
    budgets
  };
}

export function createFakeAssembly({
  resultFactory,
  onStep,
  onReportInput,
  waitForStop = false,
  maxCycles = 1
} = {}) {
  const calls = {provider: 0, steps: 0, checkpoint: 0, reports: 0, error: null};
  let releaseStop;
  let releaseStopReady;
  let releaseControlReady;
  let signalControlStop;
  const stopped = new Promise(resolve => { releaseStop = resolve; });
  const stopReady = new Promise(resolve => { releaseStopReady = resolve; });
  const controlReady = new Promise(resolve => { releaseControlReady = resolve; });
  const assembly = {
    pins: {...PILOT_DEPENDENCY_PINS},
    freshnessPolicy: {
      maxAcquisitionDurationMs: 30_000,
      maxPairAgeMs: 7 * 24 * 60 * 60 * 1000,
      maxFutureSkewMs: 0
    },
    async transport() {
      throw new Error("online fixture transport must never be used");
    },
    async acquireProviderEvidence({candidates}) {
      calls.provider += 1;
      if (resultFactory) return resultFactory(candidates, calls.provider);
      return {
        status: "ACQUISITION_FINISHED",
        networkAccessed: true,
        events: [
          {type: "provider-request", audit: "not a controller event"},
          {type: "provider-request", audit: "not a controller event"},
          {type: "provider-request", audit: "not a controller event"},
          {type: "provider-request", audit: "not a controller event"}
        ],
        candidates: candidates.map(identity => ({
          candidate: {
            ...identity,
            source: "DexScreener public API",
            sampledAt: FIXTURE_START + 1_000,
            evidence: {}
          },
          identityStatus: "BOUND_TO_REQUEST",
          coverage: {pair: "UNKNOWN", tokenSupply: "UNKNOWN"}
        })),
        counters: {
          requests: 4,
          bytes: 50,
          events: 4,
          reservedBytes: 0,
          byProvider: {dex: 1, rpc: 3}
        }
      };
    },
    createPilotRunControl({callbacks, budgets, mode}) {
      assertControlContract({callbacks, budgets, mode});
      let stoppedControl = false;
      let activeSignal;
      const control = {
        stop() {
          if (stoppedControl) return false;
          stoppedControl = true;
          signalControlStop?.();
          releaseStop();
          activeSignal?.abort("OPERATOR_STOP");
          return true;
        },
        async start() {
          let reason = "SOURCE_COMPLETE";
          let status = "FINISHED";
          let acknowledgement = {status: "NOT_ATTEMPTED"};
          const abortController = new AbortController();
          activeSignal = abortController;
          let requests = 0;
          let events = 0;
          for (let cycleIndex = 0; cycleIndex < maxCycles; cycleIndex += 1) {
            try {
              const acquisition = await callbacks.acquire({
                cycleIndex,
                remainingRequests: budgets.requests - requests,
                remainingEvents: budgets.events - events,
                deadlineAtMonotonicMs: 10_000,
                signal: abortController.signal
              });
              for (let eventIndex = 0; eventIndex < acquisition.events.length; eventIndex += 1) {
                calls.steps += 1;
                events += 1;
                const event = acquisition.events[eventIndex];
                const stepResult = await callbacks.step({
                  cycleIndex,
                  eventIndex,
                  event,
                  signal: abortController.signal
                });
                onStep?.(event, stepResult);
              }
              requests += acquisition.requestsUsed;
              calls.checkpoint += 1;
              acknowledgement = await callbacks.checkpoint({
                cycleIndex,
                eventCount: events,
                completedSteps: calls.steps,
                unresolvedPositions: [],
                positionEvidenceStatus: "SUPPLIED",
                lastKnownPositionEvidence: null,
                signal: abortController.signal
              });
              if (acknowledgement.status !== "ACKNOWLEDGED") status = "UNKNOWN";
              reason = acquisition.done ? "SOURCE_COMPLETE" : "CONTROL_COMPLETE";
              if (waitForStop && !acquisition.done) {
                releaseStopReady();
                await stopped;
                reason = "OPERATOR_STOP";
                break;
              }
              if (acquisition.done) break;
            } catch (error) {
              status = "UNKNOWN";
              reason = "CALLBACK_FAILED";
              calls.error = error.message;
              break;
            }
          }
          const summary = {
            status,
            state: status,
            mode,
            reason,
            counts: {requests, events, cycles: calls.checkpoint, completedSteps: calls.steps},
            checkpointAcknowledgement: acknowledgement
          };
          await callbacks.report({
            summary,
            mode,
            evidenceSource: "READ_ONLY_PROVIDER_CALLBACK",
            signal: abortController.signal
          });
          return summary;
        }
      };
      signalControlStop = () => { stoppedControl = true; };
      releaseControlReady();
      return control;
    },
    projectOperatorReport(input) {
      calls.reports += 1;
      onReportInput?.(input);
      return {
        schema: "READ_ONLY_PAPER_FIXTURE_REPORT",
        experiment: {
          source: input.source,
          evidenceKind: "READ_ONLY_PAPER_CHECKPOINT_RECEIPTS",
          sourceProvenance: "CALLER_LABEL_ONLY_NOT_AUTHENTICATED"
        },
        trading: {status: "NO_ENTRY_OBSERVED", paperEntryFills: 0},
        receiptCount: input.results.length
      };
    },
    renderOperatorReport(dto) {
      return `Observation only: ${dto.trading.status}; fills=${dto.trading.paperEntryFills}`;
    }
  };
  return {assembly, calls, controlReady, stopReady};
}

function assertControlContract({callbacks, budgets, mode}) {
  if (mode !== READ_ONLY_PAPER || budgets.durationMs <= 0 ||
      typeof callbacks.acquire !== "function" || typeof callbacks.step !== "function" ||
      typeof callbacks.checkpoint !== "function" || typeof callbacks.report !== "function") {
    throw new Error("fake controller received an unsupported lifecycle contract");
  }
}
