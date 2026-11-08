export const FOUR_HOUR_DISPATCH_PROFILE_ID = "BTC_EUR_PAPER_4H_V1";

export const FOUR_HOUR_DISPATCH_POLICY = Object.freeze({
  repository: "Achi1984/meridian",
  workflowPath: ".github/workflows/spot-paper-pilot-four-hour-once.yml",
  ref: "refs/heads/main",
  workflowRunNumber: 1,
  workflowRunAttempt: 1
});

const ENV_FIELDS = Object.freeze({
  repository: "MERIDIAN_EXPECTED_DISPATCH_REPOSITORY",
  workflowPath: "MERIDIAN_EXPECTED_DISPATCH_WORKFLOW_PATH",
  ref: "MERIDIAN_EXPECTED_DISPATCH_REF",
  workflowSha: "MERIDIAN_EXPECTED_DISPATCH_WORKFLOW_SHA",
  workflowRunId: "MERIDIAN_EXPECTED_DISPATCH_RUN_ID",
  workflowRunNumber: "MERIDIAN_EXPECTED_DISPATCH_RUN_NUMBER",
  workflowRunAttempt: "MERIDIAN_EXPECTED_DISPATCH_RUN_ATTEMPT"
});

export function expectedDispatchFromEnvironment(environment = process.env) {
  const values = Object.fromEntries(Object.entries(ENV_FIELDS).map(([field, key]) =>
    [field, environment[key]]));
  if (Object.values(values).some(value => value === undefined || value === "")) {
    return null;
  }
  values.workflowRunNumber = Number(values.workflowRunNumber);
  values.workflowRunAttempt = Number(values.workflowRunAttempt);
  return values;
}

export function verifyFourHourDispatchIdentity({
  expectedDispatch, provenance, runIds = []
} = {}) {
  if (!expectedDispatch) return "UNKNOWN";
  if (!provenance) return "UNKNOWN";
  const expected = expectedDispatch;
  const fieldsValid = expected.repository === FOUR_HOUR_DISPATCH_POLICY.repository &&
    expected.workflowPath === FOUR_HOUR_DISPATCH_POLICY.workflowPath &&
    expected.ref === FOUR_HOUR_DISPATCH_POLICY.ref &&
    /^[a-f0-9]{40}$/.test(expected.workflowSha ?? "") &&
    /^[1-9]\d{0,15}$/.test(String(expected.workflowRunId ?? "")) &&
    expected.workflowRunNumber === FOUR_HOUR_DISPATCH_POLICY.workflowRunNumber &&
    expected.workflowRunAttempt === FOUR_HOUR_DISPATCH_POLICY.workflowRunAttempt;
  if (!fieldsValid) return "FAILED";

  const matchingProvenance = provenance.repository === expected.repository &&
    provenance.workflowPath === expected.workflowPath &&
    provenance.ref === expected.ref &&
    provenance.workflowSha === expected.workflowSha &&
    String(provenance.workflowRunId) === String(expected.workflowRunId) &&
    provenance.workflowRunNumber === expected.workflowRunNumber &&
    provenance.workflowRunAttempt === expected.workflowRunAttempt &&
    provenance.runId === `spot-paper-${expected.workflowRunId}-${expected.workflowRunAttempt}`;
  if (!matchingProvenance ||
      runIds.some(runId => runId !== provenance.runId)) return "FAILED";
  return "PASS";
}
