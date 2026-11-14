import assert from "node:assert/strict";
import test from "node:test";
import receipt from "../docs/operations/receipts/btc-eur-paired-diag-20261110-001.identity.json" with { type: "json" };
import { validatePairedPreflight } from "../scripts/spot-paper-paired-acceptance/preflight.mjs";

test("offline preflight is bounded and reports the current digest blocker", () => {
  const result = validatePairedPreflight(receipt, { expectedSourceSha: receipt.acceptedImage.sourceSha });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.blockers, ["registry-digest"]);
  assert.equal(result.claims.hostUniqueness, "SOURCE_BOUND_IDENTITY_ONLY");
  assert.equal(result.claims.activation, false);
  assert.equal(result.checks.find(check => check.name === "host-uniqueness-source-bound").status, "PASS");
});

test("preflight accepts only a repository-qualified immutable digest", () => {
  const candidate = structuredClone(receipt);
  candidate.acceptedImage.registryDigest = "registry.example/meridian/pair@sha256:" + "a".repeat(64);
  const result = validatePairedPreflight(candidate);
  assert.equal(result.status, "SOURCE_ONLY_READY_FOR_INDEPENDENT_REVIEW");
  assert.deepEqual(result.blockers, []);
  candidate.acceptedImage.registryDigest = candidate.acceptedImage.immutableImageId;
  assert.equal(validatePairedPreflight(candidate).status, "BLOCKED");
});

test("preflight rejects account identity collisions and never enables activation", () => {
  const candidate = structuredClone(receipt);
  candidate.acceptedImage.registryDigest = "registry.example/meridian/pair@sha256:" + "b".repeat(64);
  candidate.identity.models[1].accountId = candidate.identity.models[0].accountId;
  const result = validatePairedPreflight(candidate);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("host-uniqueness-source-bound"));
  assert.equal(result.claims.activation, false);
});
