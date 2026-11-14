import assert from "node:assert/strict";
import test from "node:test";
import receipt from "../docs/operations/receipts/btc-eur-paired-diag-20261110-001.identity.json" with { type: "json" };
import { validatePairedPreflight } from "../scripts/spot-paper-paired-acceptance/preflight.mjs";

test("offline preflight is bounded and reports the current digest blocker", () => {
  const result = validatePairedPreflight(receipt, { expectedSourceSha: receipt.acceptedImage.sourceSha });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.blockers, ["registry-digest", "registry-digest-evidence", "host-global-exclusivity"]);
  assert.equal(result.claims.hostUniqueness, "SOURCE_BOUND_IDENTITY_ONLY");
  assert.equal(result.claims.hostGlobalExclusivity, "MISSING_EXTERNAL_PROOF");
  assert.equal(result.claims.activation, false);
  assert.equal(result.checks.find(check => check.name === "host-uniqueness-source-bound").status, "PASS");
});

test("preflight accepts only a repository-qualified immutable digest", () => {
  const candidate = structuredClone(receipt);
  candidate.acceptedImage.registryDigest = "registry.example/meridian/pair@sha256:" + "a".repeat(64);
  candidate.externalEvidence = validExternalEvidence(candidate);
  const result = validatePairedPreflight(candidate);
  assert.equal(result.status, "SOURCE_ONLY_READY_FOR_INDEPENDENT_REVIEW");
  assert.deepEqual(result.blockers, []);
  candidate.acceptedImage.registryDigest = candidate.acceptedImage.immutableImageId;
  assert.equal(validatePairedPreflight(candidate).status, "BLOCKED");
});

test("preflight rejects account identity collisions and never enables activation", () => {
  const candidate = structuredClone(receipt);
  candidate.acceptedImage.registryDigest = "registry.example/meridian/pair@sha256:" + "b".repeat(64);
  candidate.externalEvidence = validExternalEvidence(candidate);
  candidate.identity.models[1].accountId = candidate.identity.models[0].accountId;
  const result = validatePairedPreflight(candidate);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("host-uniqueness-source-bound"));
  assert.equal(result.claims.activation, false);
});

test("claims never report evidence unless the corresponding gate passes", () => {
  const candidate = structuredClone(receipt);
  candidate.acceptedImage.registryDigest = "registry.example/meridian/pair@sha256:" + "c".repeat(64);
  candidate.externalEvidence = validExternalEvidence(candidate);
  candidate.externalEvidence.registryDigest.repositoryDigest = "registry.example/meridian/pair@sha256:" + "d".repeat(64);
  const result = validatePairedPreflight(candidate);
  assert.equal(result.checks.find(check => check.name === "registry-digest-evidence").status, "BLOCKED");
  assert.equal(result.claims.registryImmutability, "MISSING_EXTERNAL_PROOF");
  assert.equal(result.claims.hostGlobalExclusivity, "EVIDENCE_REPORTED_NOT_RECHECKED");
});

test("run binding, timestamps, and evidence identity fields are strict", () => {
  const candidate = structuredClone(receipt);
  candidate.acceptedImage.registryDigest = "registry.example/meridian/pair@sha256:" + "e".repeat(64);
  candidate.externalEvidence = validExternalEvidence(candidate);
  candidate.externalEvidence.registryDigest.observedAt = "2026-11-14 00:00:00Z";
  candidate.externalEvidence.hostGlobalExclusivity.verifier = new String("reviewer");
  candidate.externalEvidence.hostGlobalExclusivity.candidateRunId = "other-run";
  const result = validatePairedPreflight(candidate);
  assert.equal(result.checks.find(check => check.name === "registry-digest-evidence").status, "BLOCKED");
  assert.equal(result.checks.find(check => check.name === "host-global-exclusivity").status, "BLOCKED");
  assert.equal(result.claims.registryImmutability, "MISSING_EXTERNAL_PROOF");
  assert.equal(result.claims.hostGlobalExclusivity, "MISSING_EXTERNAL_PROOF");
});

test("timestamps reject impossible calendar dates and clock ranges", () => {
  for (const observedAt of ["2026-02-30T00:00:00Z", "2026-11-14T24:00:00Z", "2026-11-14T00:60:00Z"]) {
    const candidate = structuredClone(receipt);
    candidate.acceptedImage.registryDigest = "registry.example/meridian/pair@sha256:" + "f".repeat(64);
    candidate.externalEvidence = validExternalEvidence(candidate);
    candidate.externalEvidence.registryDigest.observedAt = observedAt;
    const result = validatePairedPreflight(candidate);
    assert.equal(result.checks.find(check => check.name === "registry-digest-evidence").status, "BLOCKED");
  }
});

function validExternalEvidence(candidate) {
  return {
    registryDigest: {
      repositoryDigest: candidate.acceptedImage.registryDigest,
      evidenceRef: "registry-attestation://pending-review",
      verifier: "independent-reviewer",
      observedAt: "2026-11-14T00:00:00Z"
    },
    hostGlobalExclusivity: {
      scope: "global",
      candidateRunId: candidate.candidateRunId,
      result: "CLEAR",
      evidenceRef: "host-check://pending-review",
      verifier: "independent-reviewer",
      observedAt: "2026-11-14T00:00:00Z"
    }
  };
}
