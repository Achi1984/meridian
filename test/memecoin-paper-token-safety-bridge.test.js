import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {acquireProviderEvidence} from "../scripts/memecoin-paper/provider-evidence.mjs";
import {bridgeMintSafetyEvidence} from "../scripts/memecoin-paper-token-safety/evidence-bridge.mjs";
import {filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {
  createSyntheticEvidence,
  createSyntheticMintBytes,
  LEGACY_TOKEN_PROGRAM,
  SYNTHETIC_MINT,
  syntheticTlv,
  syntheticTransferFeeConfig,
  TOKEN_2022_PROGRAM
} from "./fixtures/memecoin-paper-token-safety/generate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "test/fixtures/memecoin-paper-provider-evidence");
const NOW = Date.parse("2026-11-01T16:00:00Z");
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: SYNTHETIC_MINT,
  pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
});
const DURATION = 30_000;
const FRESHNESS_POLICY = Object.freeze({
  maxAcquisitionDurationMs: DURATION,
  maxPairAgeMs: 72 * 60 * 60 * 1000,
  maxFutureSkewMs: 0
});

function request(kind, identity, id) {
  return {
    provider: "rpc",
    kind,
    id,
    url: "https://api.mainnet-beta.solana.com",
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: kind,
      params: kind === "getAccountInfo"
        ? [identity.mint, {encoding: "base64", commitment: "finalized"}]
        : [identity.mint, {commitment: "finalized"}]
    }),
    requested: identity
  };
}

function makeBridgeInput({
  identity = {chainId: "solana", mint: SYNTHETIC_MINT, pool: IDENTITY.pool, quote: IDENTITY.quote},
  mintAuthority = "absent",
  freezeAuthority = "absent",
  ownerProgram = LEGACY_TOKEN_PROGRAM,
  extensions = [],
  supplyAtoms = 10_000n,
  decimals = 6,
  supplyAmount = String(supplyAtoms),
  supplyDecimals = decimals,
  accountSlot = 123_456,
  supplySlot = accountSlot,
  accountAt = NOW,
  supplyAt = NOW,
  sampledAt = NOW,
  accountData
} = {}) {
  const generated = createSyntheticEvidence({
    ownerProgram,
    mintAuthority,
    freezeAuthority,
    supplyAtoms,
    decimals,
    extensions
  });
  const accountBytes = accountData ?? Buffer.from(generated.rpcResult.value.data[0], "base64");
  return {
    identity,
    sampledAt,
    maxAcquisitionDurationMs: DURATION,
    accountInfo: {
      request: request("getAccountInfo", identity, 2),
      value: {
        result: {
          context: {slot: accountSlot},
          value: {
            owner: ownerProgram,
            data: [accountBytes.toString("base64"), "base64"]
          }
        }
      },
      slot: accountSlot,
      receivedAt: accountAt
    },
    supply: {
      request: request("getTokenSupply", identity, 4),
      value: {
        result: {
          context: {slot: supplySlot},
          value: {amount: supplyAmount, decimals: supplyDecimals}
        }
      },
      slot: supplySlot,
      receivedAt: supplyAt
    }
  };
}

function bridge(overrides) {
  return bridgeMintSafetyEvidence(makeBridgeInput(overrides));
}

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));
}

async function providerEvidence({ownerProgram = LEGACY_TOKEN_PROGRAM, extensions = [],
  mintAuthority = "absent", freezeAuthority = "absent", accountData,
  supplyAmount = "10000", supplyDecimals = 6, accountSlot = 123_456,
  supplySlot = accountSlot, transport: transportOverride} = {}) {
  const manifest = JSON.parse(await readFile(
    path.join(root, "scripts/memecoin-paper/run-manifest.json"), "utf8"));
  manifest.enabled = true;
  manifest.runId = "mint-safety-generated-test";
  manifest.startAt = NOW;
  manifest.endAt = NOW + manifest.durationMs;
  manifest.stopSwitch.engaged = false;
  manifest.providers.forEach(provider => { provider.enabled = true; });
  manifest.allowedMints = [IDENTITY.mint];
  manifest.allowedPools = [IDENTITY.pool];

  const transport = transportOverride ?? (async request => {
    let payload;
    if (request.provider === "dex") {
      payload = await fixture("dex-pair.json");
      payload.pairs[0].baseToken.address = request.requested.mint;
      payload.pairs[0].pairAddress = request.requested.pool;
      payload.pairs[0].quoteToken.address = request.requested.quote;
    } else {
      const file = {
        getAccountInfo: "get-account-info.json",
        getTokenLargestAccounts: "get-largest-accounts.json",
        getTokenSupply: "get-token-supply.json"
      }[request.kind];
      payload = await fixture(file);
      payload.id = request.id;
      if (request.kind === "getAccountInfo") {
        const bytes = accountData ?? createSyntheticMintBytes({
          ownerProgram, mintAuthority, freezeAuthority, extensions, supplyAtoms: BigInt(supplyAmount),
          decimals: supplyDecimals
        });
        payload.result.context.slot = accountSlot;
        payload.result.value.owner = ownerProgram;
        payload.result.value.data = [bytes.toString("base64"), "base64"];
      } else if (request.kind === "getTokenSupply") {
        payload.result.context.slot = supplySlot;
        payload.result.value.amount = supplyAmount;
        payload.result.value.decimals = supplyDecimals;
      }
    }
    return new Response(JSON.stringify(payload), {status: 200, headers: {"content-type": "application/json"}});
  });

  return acquireProviderEvidence({
    manifest,
    candidates: [IDENTITY],
    enabled: true,
    transport,
    clock: () => NOW,
    freshnessPolicy: FRESHNESS_POLICY
  });
}

test("generated RPC responses bind legacy mint facts without granting a global pass", async () => {
  const acquired = await providerEvidence();
  const candidate = acquired.candidates[0].candidate;
  assert.equal(candidate.mintSafetyEvidence.status, "SOURCE_BOUND",
    candidate.mintSafetyEvidence.reasonCodes.join(", "));
  assert.equal(candidate.mintSafetyEvidence.decoded.status, "DECODED_UNVERIFIED");
  assert.equal(candidate.mintSafetyEvidence.hardGateEligible, false);
  assert.equal(candidate.evidence.mintAuthorityRevoked.value, true);
  assert.equal(candidate.evidence.freezeAuthorityRevoked.value, true);
  assert.equal(candidate.evidence.tokenDecimals.value, 6);
  assert.equal(candidate.evidence.tokenDecimals.coverage.amountAtoms, "10000");
  assert.equal(candidate.evidence.tokenExtensions.value.transferFee, false);

  const filters = filterCandidate(candidate, {now: NOW});
  assert.equal(filters.checks.mintAuthority.status, "PASS");
  assert.equal(filters.checks.freezeAuthority.status, "PASS");
  assert.equal(filters.checks.tokenDecimals.status, "PASS");
  assert.equal(filters.checks.tokenExtensions.status, "PASS");
  for (const key of ["lpProtection", "top10Owners", "devHoldings", "priorRug", "bundledLaunch"]) {
    assert.equal(filters.checks[key].status, "UNKNOWN", key);
  }
  assert.equal(filters.status, "UNKNOWN");
  assert.equal(filters.accepted, false);
});

test("active authorities reject and configured Token-2022 restrictions remain visible", () => {
  const active = bridge({mintAuthority: "present", freezeAuthority: "present"});
  assert.equal(active.status, "SOURCE_BOUND");
  assert.equal(active.facts.mintAuthorityRevoked.value, false);
  assert.equal(active.facts.freezeAuthorityRevoked.value, false);

  const transferHook = Buffer.alloc(64);
  transferHook.fill(8, 0, 32);
  transferHook.fill(9, 32, 64);
  const token2022 = bridge({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [
      syntheticTlv(1, syntheticTransferFeeConfig()),
      syntheticTlv(14, transferHook),
      syntheticTlv(12, Buffer.alloc(32, 6)),
      syntheticTlv(6, Buffer.from([2]))
    ]
  });
  assert.equal(token2022.status, "SOURCE_BOUND");
  assert.deepEqual(token2022.facts.tokenExtensions.value, {
    transferFee: true,
    transferHook: true,
    defaultFrozen: true,
    permanentDelegate: true
  });
});

test("the existing filter rejects generated active authorities and risky Token-2022 facts", async () => {
  const active = await providerEvidence({mintAuthority: "present", freezeAuthority: "present"});
  const activeFilters = filterCandidate(active.candidates[0].candidate, {now: NOW});
  assert.equal(activeFilters.checks.mintAuthority.status, "REJECT");
  assert.equal(activeFilters.checks.freezeAuthority.status, "REJECT");

  const risky = await providerEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(1, syntheticTransferFeeConfig())]
  });
  const riskyFilters = filterCandidate(risky.candidates[0].candidate, {now: NOW});
  assert.equal(riskyFilters.checks.tokenExtensions.status, "REJECT");
});

test("mutable Token-2022 fee and hook authorities remain restrictions", async () => {
  const feeConfig = syntheticTransferFeeConfig({
    olderMaxFee: 0n,
    olderBasisPoints: 0,
    newerMaxFee: 0n,
    newerBasisPoints: 0
  });
  const hookConfig = Buffer.alloc(64);
  hookConfig.fill(8, 0, 32);
  const acquired = await providerEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(1, feeConfig), syntheticTlv(14, hookConfig)]
  });
  const candidate = acquired.candidates[0].candidate;

  assert.equal(candidate.mintSafetyEvidence.status, "SOURCE_BOUND");
  assert.equal(candidate.mintSafetyEvidence.decoded.extensions.restrictions
    .transferFeeConfig.configuredNonzeroFee, false);
  assert.equal(candidate.mintSafetyEvidence.decoded.extensions.restrictions
    .transferHook.hookProgramConfigured, false);
  assert.equal(candidate.evidence.tokenExtensions.value.transferFee, true);
  assert.equal(candidate.evidence.tokenExtensions.value.transferHook, true);
  assert.equal(filterCandidate(candidate, {now: NOW}).checks.tokenExtensions.status, "REJECT");
});

test("source-binding failures invalidate decimals before the filter can pass", async () => {
  const acquired = await providerEvidence({supplySlot: 123_457});
  const candidate = acquired.candidates[0].candidate;
  const decimals = candidate.evidence.tokenDecimals;

  assert.equal(candidate.mintSafetyEvidence.status, "UNBOUND");
  assert.ok(decimals.coverage.reason.includes("MINT_ACCOUNT_AND_TOKEN_SUPPLY_SLOT_MISMATCH"));
  assert.equal(decimals.verified, false);
  assert.equal(decimals.source, "Solana JSON-RPC getTokenSupply");
  assert.equal(decimals.observedAt, NOW);
  assert.equal(decimals.slot, 123_457);
  assert.equal(filterCandidate(candidate, {now: NOW}).checks.tokenDecimals.status, "UNKNOWN");
});

test("u64 supply atoms compare exactly beyond JavaScript safe integer precision", () => {
  const amount = 9_007_199_254_740_993n;
  const exact = bridge({supplyAtoms: amount, supplyAmount: amount.toString()});
  assert.equal(exact.status, "SOURCE_BOUND");
  assert.equal(exact.sourceBinding.supplyAmountAtoms, "9007199254740993");

  const rounded = bridge({supplyAtoms: amount, supplyAmount: "9007199254740992"});
  assert.equal(rounded.status, "UNBOUND");
  assert.ok(rounded.reasonCodes.includes("TOKEN_SUPPLY_AMOUNT_MISMATCH"));
});

test("request, owner, supply, slot, and time mismatches leave facts unknown with reasons", () => {
  const wrongMint = makeBridgeInput();
  const forgedMint = "YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf";
  wrongMint.accountInfo.request.requested = {...wrongMint.identity, mint: forgedMint};
  wrongMint.accountInfo.request.body = JSON.stringify({
    jsonrpc: "2.0",
    id: wrongMint.accountInfo.request.id,
    method: "getAccountInfo",
    params: [forgedMint, {encoding: "base64", commitment: "finalized"}]
  });
  const wrongOwner = makeBridgeInput();
  wrongOwner.accountInfo.value.result.value.owner = IDENTITY.mint;
  const missingTime = makeBridgeInput();
  delete missingTime.accountInfo.receivedAt;
  const cases = [
    [wrongMint, "GET_ACCOUNT_INFO_REQUEST_NOT_BOUND_TO_CANDIDATE"],
    [wrongOwner, "MINT_OWNER_PROGRAM_UNSUPPORTED"],
    [makeBridgeInput({supplyAmount: "10001"}), "TOKEN_SUPPLY_AMOUNT_MISMATCH"],
    [makeBridgeInput({supplyDecimals: 7}), "TOKEN_SUPPLY_DECIMALS_MISMATCH"],
    [makeBridgeInput({supplySlot: 123_457}), "MINT_ACCOUNT_AND_TOKEN_SUPPLY_SLOT_MISMATCH"],
    [makeBridgeInput({accountAt: NOW, supplyAt: NOW + DURATION + 1,
      sampledAt: NOW + DURATION + 1}), "MINT_SAFETY_RECEIPT_TIME_OUTSIDE_ACQUISITION_WINDOW"],
    [missingTime, "OBSERVED_AT_MISSING"]
  ];

  for (const [input, reason] of cases) {
    const result = bridgeMintSafetyEvidence(input);
    assert.equal(result.status, "UNBOUND", reason);
    assert.ok(result.reasonCodes.includes(reason), result.reasonCodes.join(", "));
    assert.equal(result.facts.mintAuthorityRevoked.state, "UNKNOWN");
    assert.equal(result.facts.freezeAuthorityRevoked.state, "UNKNOWN");
    assert.equal(result.facts.tokenExtensions.state, "UNKNOWN");
    assert.equal(result.hardGateEligible, false);
  }
});

test("unsupported extensions and malformed or oversized mint bytes never become filter-usable", () => {
  const unsupported = bridge({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(99, Buffer.from([1]))]
  });
  assert.equal(unsupported.status, "UNBOUND");
  assert.ok(unsupported.reasonCodes.includes("TOKEN_2022_EXTENSION_UNSUPPORTED:99"));

  const malformed = bridge({accountData: Buffer.from([1, 2, 3])});
  assert.equal(malformed.status, "UNBOUND");
  assert.ok(malformed.reasonCodes.includes("MINT_ACCOUNT_DATA_TRUNCATED"));

  const oversized = bridge({accountData: Buffer.alloc(10_241)});
  assert.equal(oversized.status, "UNBOUND");
  assert.ok(oversized.reasonCodes.includes("ACCOUNT_DATA_OVERSIZED"));

  const missingSlot = makeBridgeInput();
  delete missingSlot.accountInfo.value.result.context.slot;
  assert.equal(bridgeMintSafetyEvidence(missingSlot).status, "UNBOUND");
});
