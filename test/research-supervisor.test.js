import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonSuite = path.join(root, "scripts/research-supervisor/test_supervisor.py");
const totalTimeoutMs = 155_000;
const maxBuffer = 2 * 1024 * 1024;
const discoveryCode = [
  "import importlib.util,json,sys,unittest",
  "spec=importlib.util.spec_from_file_location('test_supervisor_discovery',sys.argv[1])",
  "module=importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(module)",
  "suite=unittest.defaultTestLoader.loadTestsFromModule(module)",
  "names=[]",
  "def collect(value):",
  " for item in value:",
  "  if isinstance(item,unittest.TestSuite): collect(item)",
  "  else: names.append(item.id().split('.')[-1])",
  "collect(suite)",
  "print(json.dumps(names))"
].join("\n");

const groups = [
  {
    name: "historical generated outcomes",
    timeoutMs: 45_000,
    methods: [
      "test_generated_completed_historical_insufficient_screen_roundtrips_without_promotion",
      "test_generated_historical_identity_corruption_fails_closed",
      "test_generated_historical_insufficient_evidence_stays_failed_and_labeled"
    ]
  },
  {
    name: "historical full-path and timeout",
    timeoutMs: 45_000,
    methods: [
      "test_generated_historical_profile_runs_all_paths_and_refuses_repeat",
      "test_generated_historical_timeout_keeps_attempt_and_fence_without_retry"
    ]
  },
  {
    name: "historical dormancy and receipt admission",
    timeoutMs: 45_000,
    methods: [
      "test_historical_journal_profile_stays_dormant_without_d2_receipt",
      "test_test_receipt_requires_explicit_mode_and_isolated_profile_location"
    ]
  },
  {
    name: "B1 integration",
    timeoutMs: 90_000,
    methods: [
      "test_b1_child_failure_with_unreadable_journal_returns_unsettled",
      "test_b1_controls_are_bound_to_committed_development_results_once",
      "test_b1_crash_after_committed_boundary_keeps_attempt_and_fence",
      "test_b1_engine_failure_preserves_reason_without_fabricating_controls",
      "test_b1_exclusive_lock_after_child_failure_returns_unsettled_and_reaps_child",
      "test_b1_generated_insufficient_evidence_settles_through_real_adapter_and_journal",
      "test_b1_insufficient_evidence_schema_is_valid_but_never_completed",
      "test_b1_lost_ack_after_durable_boundaries_keeps_fence_and_attempt",
      "test_b1_manifest_claim_and_phase_boundaries_are_fixed",
      "test_b1_parent_ready_orders_result_fd_and_postcommit_child_failure_is_durable",
      "test_b1_persistent_session_matches_direct_generated_fixture_result",
      "test_b1_preparation_path_calibration_and_finalization_share_deadline",
      "test_b1_result_and_summary_schemas_reject_minimal_or_screenless_results",
      "test_b1_result_framing_schema_and_capacity_faults_never_complete",
      "test_b1_source_pin_tampering_fails_before_path_work",
      "test_b1_summary_rejects_coerced_counts_and_substituted_control_identity"
    ]
  },
  {
    name: "core durability, process, and locking",
    timeoutMs: 45_000,
    methods: [
      "test_competing_process_claims_allow_only_one_and_budget_survives_new_ids",
      "test_contract_rejects_unbounded_or_nonzero_model_budget",
      "test_crash_after_claim_before_start_is_unresolved_and_reconcilable",
      "test_enqueue_conflict_is_immutable_and_duplicate_is_idempotent",
      "test_explicit_scheduler_off_and_pinned_policy_rejection_are_durable",
      "test_failed_settlement_rolls_back_and_keeps_active_until_reconciliation",
      "test_missed_and_false_path_events_never_count_as_completed",
      "test_output_flood_and_parent_exit_with_inherited_pipe_are_bounded",
      "test_path_timeout_kills_real_child_and_persists_timed_out_trial",
      "test_result_capacity_failure_does_not_unlock_or_retry",
      "test_sqlite_lock_during_final_settlement_retains_completed_progress_and_fence",
      "test_sqlite_lock_during_path_finish_returns_unsettled_without_retry",
      "test_sqlite_lock_during_path_start_kills_process_group_without_retry",
      "test_synthetic_batch_is_sequential_bounded_and_recovers_without_rerun",
      "test_whole_batch_deadline_is_absolute_across_path_processes",
      "test_whole_batch_deadline_preempts_a_long_path"
    ]
  }
];

function tail(text) {
  return String(text || "").slice(-6000);
}

function diagnostic(label, result) {
  const status = result.status === null ? "null" : result.status;
  const details = result.error
    ? `subprocess error code=${result.error.code || "unknown"}`
    : `exit status=${status}`;
  return `${label}: ${details}, signal=${result.signal || "none"}, status=${status}\n` +
    `stdout tail:\n${tail(result.stdout)}\nstderr tail:\n${tail(result.stderr)}`;
}

function runPython(args, timeoutMs, label) {
  const result = spawnSync("python3", ["-B", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer
  });
  assert.equal(result.error, undefined, diagnostic(label, result));
  assert.equal(result.status, 0, diagnostic(label, result));
  return result;
}

test("durable bounded research supervisor synthetic suite", () => {
  const startedAt = performance.now();
  const totalDeadline = startedAt + totalTimeoutMs;
  const discoveryBudget = Math.min(10_000, totalDeadline - performance.now());
  assert.ok(discoveryBudget > 0, "aggregate supervisor test budget expired before discovery");
  const discovery = runPython(["-c", discoveryCode, pythonSuite], discoveryBudget, "unittest discovery");
  let discovered;
  try {
    discovered = JSON.parse(discovery.stdout);
  } catch {
    assert.fail(`unittest discovery returned invalid JSON: ${tail(discovery.stdout)}`);
  }
  assert.ok(Array.isArray(discovered), "unittest discovery must return method names");
  assert.equal(new Set(discovered).size, discovered.length, "unittest discovery returned duplicate methods");

  const assigned = groups.flatMap(group => group.methods);
  assert.equal(new Set(assigned).size, assigned.length, "explicit unittest groups contain duplicates");
  assert.deepEqual([...assigned].sort(), [...discovered].sort(),
    "explicit unittest groups must cover actual unittest discovery exactly");
  assert.deepEqual(groups.map(group => group.methods.length), [3, 2, 2, 16, 16],
    "the discovered suite must retain the reviewed 3/2/2/16/16 partition");

  const timings = [];
  for (const group of groups) {
    const remainingMs = totalDeadline - performance.now();
    assert.ok(remainingMs > 0, `aggregate supervisor test budget expired before ${group.name}`);
    const timeoutMs = Math.max(1, Math.floor(Math.min(group.timeoutMs, remainingMs)));
    const groupStartedAt = performance.now();
    const result = runPython([pythonSuite, "-v",
      ...group.methods.map(method => `ResearchSupervisorTests.${method}`)], timeoutMs, group.name);
    assert.match(result.stderr, new RegExp(`Ran ${group.methods.length} tests? in `),
      `${group.name} must run every assigned test once\n${tail(result.stderr)}`);
    assert.match(result.stderr, /\nOK(?:\n|$)/,
      `${group.name} must pass without skips\n${tail(result.stderr)}`);
    assert.doesNotMatch(result.stderr, /skipped=/, `${group.name} must not skip tests`);
    const durationMs = Math.round(performance.now() - groupStartedAt);
    timings.push({name: group.name, count: group.methods.length, durationMs});
  }

  const totalDurationMs = Math.round(performance.now() - startedAt);
  assert.ok(totalDurationMs <= totalTimeoutMs, "supervisor test partition exceeded its 155s aggregate bound");
  console.log("RESEARCH_SUPERVISOR_GROUP_TIMINGS", JSON.stringify({groups: timings, totalDurationMs}));
});
