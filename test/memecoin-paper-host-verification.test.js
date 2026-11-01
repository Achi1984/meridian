import assert from "node:assert/strict";
import test from "node:test";
import {runSyntheticHostVerification} from "../scripts/memecoin-paper/host-verification.mjs";

test("host verification harness is explicit, offline, bounded, and non-authorizing", async () => {
  await assert.rejects(runSyntheticHostVerification(), /explicit SYNTHETIC_TEST_ONLY mode/);
  const result = await runSyntheticHostVerification({mode: "SYNTHETIC_TEST_ONLY"});

  assert.equal(result.status, "PASS");
  assert.equal(result.scope, "SYNTHETIC_ONLY");
  assert.equal(result.runtimeAuthorization, false);
  assert.equal(result.hostDurability, "NOT_VERIFIED");
  assert.equal(result.hostClockProvenance, "UNVERIFIED");
  assert.equal(result.hostEvidence.status, "NOT_PROVIDED");
  assert.deepEqual(result.hostEvidence.records, []);
  assert.ok(result.sourceIdentities.length >= 4);
  for (const source of result.sourceIdentities) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  assert.match(result.configIdentity.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.runFixtureIdentity.identitySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.syntheticEvidence.checks.map(({name}) => name), [
    "acknowledgement-receipt-and-restart",
    "ambiguous-write-retains-unknown",
    "interruption-before-publication",
    "interruption-after-publication-before-ack",
    "process-exit-after-acknowledgement",
    "torn-checkpoint-fails-closed",
    "fixed-stop-deadline-and-clock-provenance"
  ]);
  assert.ok(result.syntheticEvidence.checks.every(check => check.status === "PASS"));
  assert.equal(
    result.syntheticEvidence.checks.find(check => check.name === "ambiguous-write-retains-unknown")
      .evidence.automaticReplay,
    false
  );
  assert.equal(
    result.syntheticEvidence.checks.find(check => check.name === "fixed-stop-deadline-and-clock-provenance")
      .evidence.hostClockUsed,
    false
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024);
});
