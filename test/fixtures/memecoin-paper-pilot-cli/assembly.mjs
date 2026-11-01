import {appendFile} from "node:fs/promises";
import {createFakeAssembly} from "../memecoin-paper-pilot-online/generate.mjs";

const mode = process.env.PILOT_ONLINE_CLI_FIXTURE_MODE ?? "success";
const importMarker = process.env.PILOT_ONLINE_CLI_IMPORT_MARKER;
if (importMarker) await appendFile(importMarker, "loaded\n");

const fixture = createFakeAssembly({
  maxCycles: mode === "stop" || mode === "signal" ? 4 : 1,
  waitForStop: mode === "stop" || mode === "signal"
});
const originalAcquire = fixture.assembly.acquireProviderEvidence;
fixture.assembly.acquireProviderEvidence = async options => {
  const counter = process.env.PILOT_ONLINE_CLI_PROVIDER_COUNTER;
  if (counter) await appendFile(counter, "acquired\n");
  return originalAcquire(options);
};

if (mode === "unknown" || mode === "reject-start") {
  const originalCreateControl = fixture.assembly.createPilotRunControl;
  fixture.assembly.createPilotRunControl = options => {
    const control = originalCreateControl(options);
    return {
      ...control,
      async start() {
        if (mode === "reject-start") throw new Error("synthetic controller start rejection");
        return {
          status: "UNKNOWN",
          state: "UNKNOWN",
          reason: "SYNTHETIC_UNKNOWN",
          counts: {requests: 0, events: 0, cycles: 0, completedSteps: 0},
          checkpointAcknowledgement: {status: "NOT_ATTEMPTED"}
        };
      }
    };
  };
}

export const createPinnedAssembly = async () => fixture.assembly;
