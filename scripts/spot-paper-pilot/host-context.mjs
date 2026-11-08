import { HOST_EIGHT_HOUR_PROFILE_ID } from "./evidence-profiles.mjs";

export const EXPECTED_HOST_CONTEXT_SCHEMA = "SPOT_PAPER_HOST_EXPECTED_CONTEXT_V1";

const isSha256 = value => /^[a-f0-9]{64}$/.test(value ?? "");
const isHostIdentity = value => typeof value === "string" &&
  value.length > 0 && value.length <= 256;

export function verifyExpectedHostContext({
  expectedHostContext, hostManifest, hostManifestSha256, hostState, readback
} = {}) {
  if (expectedHostContext === undefined || expectedHostContext === null) {
    return { status: "UNKNOWN", reason: "EXPECTED_HOST_CONTEXT_MISSING" };
  }
  const expected = expectedHostContext;
  if (!expected || typeof expected !== "object" || Array.isArray(expected) ||
      expected.schemaVersion !== EXPECTED_HOST_CONTEXT_SCHEMA ||
      expected.profileId !== HOST_EIGHT_HOUR_PROFILE_ID ||
      typeof expected.hostRunId !== "string" ||
      !isSha256(expected.launchManifestSha256) ||
      !isSha256(expected.runtimeSourceSha256) ||
      !(expected.imageDigest === null ||
        /^sha256:[a-f0-9]{64}$/.test(expected.imageDigest ?? "")) ||
      !(expected.hostIdentity === null || isHostIdentity(expected.hostIdentity)) ||
      ["workflowSha", "workflowRunId", "workflowRunNumber",
        "workflowRunAttempt", "workflowPath"].some(key => Object.hasOwn(expected, key))) {
    return { status: "FAILED", reason: "EXPECTED_HOST_CONTEXT_MALFORMED" };
  }

  const report = readback?.events?.at(-1)?.report;
  const contentMatches = hostManifest?.schemaVersion === "SPOT_PAPER_HOST_LAUNCH_V1" &&
    isSha256(hostManifestSha256) &&
    expected.hostRunId === hostManifest.runId &&
    expected.hostRunId === hostState?.runId &&
    hostState?.schemaVersion === "SPOT_PAPER_HOST_STATE_V1" &&
    hostState.status === "CHILD_EXITED" && hostState.childExitCode === 0 &&
    hostState.childSignal === null && hostState.interruptedBy === null &&
    expected.hostRunId === readback?.runId &&
    expected.hostRunId === report?.runId &&
    expected.launchManifestSha256 === hostManifestSha256 &&
    expected.runtimeSourceSha256 === hostManifest.runtimeSourceSha256 &&
    expected.runtimeSourceSha256 === hostState?.runtimeSourceSha256;
  if (!contentMatches) {
    return { status: "FAILED", reason: "EXPECTED_HOST_CONTEXT_MISMATCH" };
  }

  const imageAvailable = Object.hasOwn(hostState, "imageDigest");
  const hostIdentityAvailable = Object.hasOwn(hostState, "hostIdentity");
  if ((imageAvailable && expected.imageDigest !== hostState.imageDigest) ||
      (!imageAvailable && expected.imageDigest !== null) ||
      (hostIdentityAvailable && expected.hostIdentity !== hostState.hostIdentity) ||
      (!hostIdentityAvailable && expected.hostIdentity !== null)) {
    return { status: "FAILED", reason: "HOST_IDENTITY_CONTEXT_MISMATCH" };
  }
  return {
    status: "PASS",
    binding: "CONTENT_BOUND",
    imageIdentity: imageAvailable ? "CONTENT_BOUND_UNATTESTED" : "NOT_AVAILABLE",
    hostIdentity: hostIdentityAvailable ? "CONTENT_BOUND_UNATTESTED" : "NOT_AVAILABLE",
    authenticity: "UNATTESTED"
  };
}
