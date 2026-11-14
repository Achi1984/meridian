#!/usr/bin/env node
/**
 * Offline, bounded preflight for the disabled BTC/EUR paired candidate.
 *
 * This deliberately cannot prove that a host is unused or that a registry
 * reference was published. It only checks locally supplied claims and
 * fail-closes unless each external claim has a separately identified evidence
 * record. No registry/provider/host query is performed here.
 */
import { readFile } from "node:fs/promises";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const REGISTRY_DIGEST = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value) {
  return nonEmptyString(value) && RFC3339.test(value) && Number.isFinite(Date.parse(value));
}

function check(name, ok, detail) {
  return { name, status: ok ? "PASS" : "BLOCKED", detail };
}

export function validatePairedPreflight(receipt, { expectedSourceSha } = {}) {
  const checks = [];
  const accepted = receipt?.acceptedImage ?? {};
  const identity = receipt?.identity ?? {};
  const guardrails = receipt?.guardrails ?? {};
  const evidence = receipt?.externalEvidence ?? {};
  const models = identity.models;

  checks.push(check("source-commit", SOURCE_SHA.test(accepted.sourceSha ?? "") &&
    (!expectedSourceSha || accepted.sourceSha === expectedSourceSha),
    "accepted source commit is present and matches the optional expected pin"));
  checks.push(check("local-image-id", SHA256.test(accepted.immutableImageId ?? ""),
    "local image ID is syntactically immutable (not a registry proof)"));
  checks.push(check("registry-digest", REGISTRY_DIGEST.test(accepted.registryDigest ?? ""),
    "registry reference is repository@sha256:<digest>; null/local IDs remain blocked"));

  const registryEvidence = evidence.registryDigest;
  checks.push(check("registry-digest-evidence",
    REGISTRY_DIGEST.test(accepted.registryDigest ?? "") &&
    registryEvidence?.repositoryDigest === accepted.registryDigest &&
    nonEmptyString(registryEvidence?.evidenceRef) &&
    nonEmptyString(registryEvidence?.verifier) &&
    validTimestamp(registryEvidence?.observedAt),
    "external evidence must bind the exact repository digest and identify verifier, reference, and observation time"));

  const runId = identity.runId;
  const candidateRunId = receipt?.candidateRunId;
  const validRunBinding = nonEmptyString(runId) && nonEmptyString(candidateRunId) && runId === candidateRunId;
  const accountIds = Array.isArray(models) ? models.map(model => model?.accountId) : [];
  const expectedIds = ["baseline", "challenger", "cash"].map(role => `${runId}-${role}`);
  const unique = accountIds.length === 3 && new Set(accountIds).size === accountIds.length;
  checks.push(check("host-uniqueness-source-bound", validRunBinding && unique &&
    accountIds.every((id, index) => id === expectedIds[index]) &&
    identity.runId === receipt?.candidateRunId,
    "all three account identities are deterministic, unique, and bound to candidateRunId"));

  const hostEvidence = evidence.hostGlobalExclusivity;
  checks.push(check("host-global-exclusivity",
    hostEvidence?.scope === "global" &&
    hostEvidence?.candidateRunId === candidateRunId &&
    hostEvidence?.result === "CLEAR" &&
    validRunBinding &&
    nonEmptyString(hostEvidence?.evidenceRef) &&
    nonEmptyString(hostEvidence?.verifier) &&
    validTimestamp(hostEvidence?.observedAt),
    "independent host-side evidence must state a global CLEAR for this run and identify verifier, reference, and observation time"));

  checks.push(check("inactive-guardrails", guardrails.activation === false &&
    guardrails.hostPaperRun === false && guardrails.feedStarted === false &&
    guardrails.registryPush === false && guardrails.promotion === false,
    "feed, host run, registry push, activation, and promotion remain false"));

  const blocked = checks.filter(item => item.status === "BLOCKED");
  const passed = name => checks.find(item => item.name === name)?.status === "PASS";
  return Object.freeze({
    schemaVersion: "MERIDIAN_PAIRED_PAPER_OFFLINE_PREFLIGHT_V1",
    status: blocked.length ? "BLOCKED" : "SOURCE_ONLY_READY_FOR_INDEPENDENT_REVIEW",
    bounded: true,
    claims: {
      hostUniqueness: "SOURCE_BOUND_IDENTITY_ONLY",
      hostGlobalExclusivity: passed("host-global-exclusivity") ? "EVIDENCE_REPORTED_NOT_RECHECKED" : "MISSING_EXTERNAL_PROOF",
      registryImmutability: passed("registry-digest-evidence") ? "EVIDENCE_REPORTED_NOT_RECHECKED" : "MISSING_EXTERNAL_PROOF",
      activation: false
    },
    checks,
    blockers: blocked.map(item => item.name)
  });
}

if (process.argv[1]?.endsWith("/preflight.mjs")) {
  const [receiptPath, expectedSourceSha] = process.argv.slice(2);
  if (!receiptPath) {
    console.error("Usage: preflight.mjs RECEIPT.json [EXPECTED_SOURCE_COMMIT]");
    process.exitCode = 2;
  } else {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    console.log(JSON.stringify(validatePairedPreflight(receipt, { expectedSourceSha }), null, 2));
  }
}
