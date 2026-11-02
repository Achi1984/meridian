import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {
  collectLpProtectionSource,
  LP_PROTECTION_DECODER_VERSION,
  LP_PROTECTION_SOURCE_VERSION,
  RAYDIUM_CPMM_PROGRAM_ID
} from "../scripts/memecoin-paper/lp-protection-source.mjs";
import {
  IDENTITY,
  LP_MINT,
  NOW,
  PDA_AUTHORITY,
  TOKEN_PROGRAM_ID,
  WALLET_AUTHORITY,
  poolProof,
  tokenAccount,
  transportFor
} from "./fixtures/memecoin-paper-lp-protection-source/generate.mjs";

const HOLD_UNTIL = NOW + 60_000;

async function collect({
  proof = poolProof(),
  identity = proof.identity,
  accounts = [],
  supplyAtoms = proof.pool.lpMint.supplyAtoms,
  supplySlot = proof.slot,
  accountSlot = proof.slot,
  transport,
  lockClaims,
  burnClaims,
  holdUntil = HOLD_UNTIL,
  signal
} = {}) {
  const built = transportFor({
    proof,
    supplyAtoms,
    supplySlot,
    accountSlot,
    accounts
  });
  const result = await collectLpProtectionSource({
    identity,
    poolProof: proof,
    enabled: true,
    transport: transport ?? built.transport,
    clock: () => NOW,
    holdUntil,
    lockClaims,
    burnClaims,
    signal
  });
  return {...built, result};
}

test("disabled by default performs no requests or clock reads", async () => {
  let calls = 0;
  const result = await collectLpProtectionSource({
    transport: () => { calls += 1; },
    clock: () => { calls += 1; return NOW; }
  });
  assert.equal(result.status, "DISABLED");
  assert.equal(result.networkAccessed, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.realDataEntryEligible, false);
  assert.equal(calls, 0);
});

test("same-slot finalized census binds pool proof and hashes both exact RPC responses", async () => {
  const account = tokenAccount({amountAtoms: "1000"});
  const {result, requests, responseBodies} = await collect({
    accounts: [account],
    supplyAtoms: "1000"
  });

  assert.equal(result.status, "MEASURED_UNVERIFIED");
  assert.equal(result.networkAccessed, true);
  assert.equal(result.identity.pool, IDENTITY.pool);
  assert.equal(result.sourceVersion, LP_PROTECTION_SOURCE_VERSION);
  assert.equal(result.decoderVersion, LP_PROTECTION_DECODER_VERSION);
  assert.equal(result.lpProtection.poolProof.sourceVersion, poolProof().sourceVersion);
  assert.equal(result.slot, 1_000);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map(event => event.method), [
    "getTokenSupply",
    "getProgramAccounts"
  ]);
  assert.ok(result.events.every(event =>
    /^[a-f0-9]{64}$/.test(event.responseSha256) && event.slot === 1_000));
  assert.deepEqual(result.events.map(event => event.responseSha256), responseBodies.map(body =>
    createHash("sha256").update(body).digest("hex")));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({request, options}) =>
    request.url === "https://api.mainnet-beta.solana.com" &&
    request.method === "POST" && request.redirect === "error" &&
    request.credentials === "omit" && options.redirect === "error" &&
    options.credentials === "omit"));
  assert.ok(requests.every(({request}) =>
    JSON.parse(request.body).params.at(-1).commitment === "finalized"));
  assert.equal(result.measurement.denominatorAtoms, "1100");
  assert.equal(result.measurement.currentMintSupplyAtoms, "1000");
  assert.equal(result.measurement.accountBalancesAtoms, "1000");
  assert.equal(result.measurement.signerAddressAtoms, "1000");
  assert.equal(result.measurement.poolCounterMinusMintSupplyAtoms, "100");
  assert.equal(result.measurement.actualBurnAtoms, null);
  assert.equal(result.measurement.actualBurnEvidenceStatus,
    "UNAVAILABLE; no transaction-bound burn proof is consumed");
  assert.equal(result.measurement.protectedAtoms, null);
  assert.equal(result.measurement.protectedPct, null);
  assert.equal(result.lpProtection.verified, false);
  assert.equal(result.lpProtection.review, null);
  assert.equal(result.executionAuthorized, false);
});

test("a zero-supply synthetic snapshot measures the full pool-counter gap but not a protection pass", async () => {
  const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "100"});
  const {result} = await collect({proof});

  assert.equal(result.status, "MEASURED_UNVERIFIED");
  assert.equal(result.measurement.denominatorAtoms, "100");
  assert.equal(result.measurement.accountBalancesAtoms, "0");
  assert.equal(result.measurement.poolCounterMinusMintSupplyAtoms, "100");
  assert.equal(result.measurement.coverage.complete, true);
  assert.equal(result.measurement.protectedAtoms, null);
  assert.equal(result.lpProtection.status, "UNKNOWN");
  assert.equal(result.adapterEvidence.verified, false);
});

test("partial signer and program-custody balances are counted once and stay UNKNOWN", async () => {
  const proof = poolProof({supplyAtoms: "1000", poolSupplyAtoms: "1100"});
  const {result} = await collect({
    proof,
    accounts: [
      tokenAccount({address: IDENTITY.mint, authority: WALLET_AUTHORITY, amountAtoms: "600"}),
      tokenAccount({address: IDENTITY.quote, authority: PDA_AUTHORITY, amountAtoms: "400"})
    ]
  });

  assert.equal(result.status, "MEASURED_UNVERIFIED");
  assert.equal(result.accounts.length, 2);
  assert.equal(result.measurement.accountBalancesAtoms, "1000");
  assert.equal(result.measurement.signerAddressAtoms, "600");
  assert.equal(result.measurement.potentiallyUnprotectedAtoms, "600");
  assert.equal(result.measurement.unknownProtectionAtoms, "500");
  assert.equal(result.measurement.programCustodyUnknownAtoms, "400");
  assert.equal(result.measurement.frozenAccountAtoms, "0");
  assert.equal(result.measurement.protectedAtoms, null);
  assert.equal(result.lpProtection.status, "UNKNOWN");
});

test("source-shaped measurement reaches the existing filter but cannot be mistaken for reviewed evidence", async () => {
  const {result} = await collect({
    accounts: [tokenAccount({amountAtoms: "1000"})],
    supplyAtoms: "1000"
  });
  const candidate = {
    chainId: IDENTITY.chainId,
    mint: IDENTITY.mint,
    pool: IDENTITY.pool,
    quote: IDENTITY.quote,
    sampledAt: NOW,
    source: "DexScreener public API",
    evidence: {lpProtection: result.adapterEvidence}
  };
  const filtered = filterCandidate(candidate, {now: NOW, holdUntil: HOLD_UNTIL});
  assert.equal(filtered.checks.lpProtection.status, "UNKNOWN");
  assert.equal(filtered.accepted, false);
});

test("early unlock claim is not counted as protected", async () => {
  const proof = poolProof({supplyAtoms: "1000", poolSupplyAtoms: "1100"});
  const custodyAccount = tokenAccount({
    address: IDENTITY.quote,
    authority: PDA_AUTHORITY,
    amountAtoms: "1000"
  });
  const {result} = await collect({
    proof,
    accounts: [custodyAccount],
    lockClaims: [{tokenAccount: custodyAccount.pubkey, lockedUntil: NOW + 30_000}]
  });

  assert.equal(result.claims.locks[0].status, "EARLY_UNLOCK");
  assert.equal(result.claims.locks[0].countedProtectedAtoms, "0");
  assert.equal(result.measurement.protectedAtoms, null);
  assert.equal(result.lpProtection.status, "UNKNOWN");
});

test("duplicate lock and burn evidence is rejected instead of double-counted", async t => {
  await t.test("duplicate lock claim", async () => {
    const proof = poolProof({supplyAtoms: "1000", poolSupplyAtoms: "1100"});
    const custodyAccount = tokenAccount({
      address: IDENTITY.quote,
      authority: PDA_AUTHORITY,
      amountAtoms: "1000"
    });
    const {result} = await collect({
      proof,
      accounts: [custodyAccount],
      lockClaims: [
        {tokenAccount: custodyAccount.pubkey, lockedUntil: HOLD_UNTIL},
        {tokenAccount: custodyAccount.pubkey, lockedUntil: HOLD_UNTIL}
      ]
    });
    assert.equal(result.reasonCode, "DUPLICATE_LOCK_CLAIM");
    assert.equal(result.lpProtection.status, "UNKNOWN");
  });

  await t.test("duplicate historical burn claim", async () => {
    const proof = poolProof({supplyAtoms: "1000", poolSupplyAtoms: "1100"});
    const burn = {
      signature: "1".repeat(64),
      amountAtoms: "100",
      mint: LP_MINT,
      slot: proof.slot
    };
    const {result} = await collect({proof, accounts: [tokenAccount()], burnClaims: [burn, burn]});
    assert.equal(result.reasonCode, "DUPLICATE_BURN_EVIDENCE");
    assert.equal(result.lpProtection.status, "UNKNOWN");
  });

  await t.test("a unique historical burn is diagnostic only", async () => {
    const proof = poolProof({supplyAtoms: "1000", poolSupplyAtoms: "1100"});
    const {result} = await collect({
      proof,
      accounts: [tokenAccount()],
      burnClaims: [{
        signature: "1".repeat(64),
        amountAtoms: "100",
        mint: LP_MINT,
        slot: proof.slot
      }]
    });
    assert.equal(result.claims.burns[0].countedProtectedAtoms, "0");
    assert.equal(result.measurement.coverage.historicalBurnClaimsCountedAtoms, "0");
    assert.equal(result.measurement.currentMintSupplyAtoms, "1000");
  });
});

test("identity, CPMM program, LP mint and source program must match the pinned model", async t => {
  await t.test("wrong selected pool", async () => {
    const {result} = await collect({
      identity: {...IDENTITY, pool: LP_MINT}
    });
    assert.equal(result.reasonCode, "POOL_PROOF_NOT_BOUND");
  });

  await t.test("wrong Raydium program", async () => {
    const proof = poolProof();
    proof.pool.programId = TOKEN_PROGRAM_ID;
    const {result} = await collect({proof});
    assert.equal(result.reasonCode, "POOL_PROOF_NOT_BOUND");
  });

  await t.test("wrong source revision", async () => {
    const proof = poolProof();
    proof.sourceVersion = "raydium-cp-swap@unreviewed";
    const {result} = await collect({proof});
    assert.equal(result.reasonCode, "POOL_PROOF_NOT_BOUND");
  });

  await t.test("wrong LP token program", async () => {
    const proof = poolProof();
    proof.pool.lpMint.tokenProgram = "11111111111111111111111111111111";
    const {result} = await collect({proof});
    assert.equal(result.reasonCode, "LP_MINT_PROOF_INVALID");
  });
});

test("changed mint supply, context slot, or incomplete account census is UNKNOWN", async t => {
  await t.test("changed supply", async () => {
    const {result} = await collect({
      supplyAtoms: "999",
      accounts: [tokenAccount({amountAtoms: "999"})]
    });
    assert.equal(result.reasonCode, "LP_MINT_SUPPLY_CHANGED");
  });

  await t.test("changed context", async () => {
    const {result} = await collect({supplySlot: 1_001, accounts: [tokenAccount()]});
    assert.equal(result.reasonCode, "SUPPLY_CONTEXT_MISMATCH");
  });

  await t.test("account snapshot at a different slot", async () => {
    const {result} = await collect({accountSlot: 1_001, accounts: [tokenAccount()]});
    assert.equal(result.reasonCode, "ACCOUNT_CENSUS_CONTEXT_INVALID");
  });

  await t.test("account balances do not reconcile", async () => {
    const {result} = await collect({accounts: []});
    assert.equal(result.reasonCode, "LP_ACCOUNT_SUPPLY_MISMATCH");
  });
});

test("duplicate accounts and unsupported lock/admin semantics cannot produce protection", async t => {
  await t.test("duplicate token-account address", async () => {
    const duplicate = tokenAccount({amountAtoms: "500"});
    const {result} = await collect({
      accounts: [duplicate, {...duplicate, account: tokenAccount({
        address: duplicate.pubkey,
        amountAtoms: "500"
      }).account}]
    });
    assert.equal(result.reasonCode, "DUPLICATE_LP_TOKEN_ACCOUNT");
  });

  await t.test("frozen current balance is reported separately, not as protected", async () => {
    const {result} = await collect({
      accounts: [tokenAccount({amountAtoms: "1000", state: 2})],
      supplyAtoms: "1000"
    });
    assert.equal(result.measurement.frozenAccountAtoms, "1000");
    assert.equal(result.measurement.protectedAtoms, null);
    assert.equal(result.lpProtection.status, "UNKNOWN");
  });

  await t.test("admin withdrawal-disable assertion is not a lock proof", async () => {
    const proof = poolProof();
    proof.pool.adminWithdrawalDisabled = true;
    proof.lpProtection = {
      status: "PASS",
      verified: true,
      value: {pool: IDENTITY.pool, model: "lock", lockedUntil: HOLD_UNTIL + 1}
    };
    const {result} = await collect({proof, accounts: [tokenAccount()]});
    assert.equal(result.status, "MEASURED_UNVERIFIED");
    assert.equal(result.lpProtection.status, "UNKNOWN");
    assert.equal(result.lpProtection.verified, false);
  });
});

test("pre-aborted collection sends no request", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await collectLpProtectionSource({
    identity: IDENTITY,
    poolProof: poolProof(),
    enabled: true,
    transport: () => { calls += 1; },
    clock: () => NOW,
    holdUntil: HOLD_UNTIL,
    signal: controller.signal
  });
  assert.equal(result.reasonCode, "CANCELLED");
  assert.equal(calls, 0);
});

test("HTTP errors and foreign response URLs stop without retries", async t => {
  await t.test("HTTP 429", async () => {
    let calls = 0;
    const result = await collectLpProtectionSource({
      identity: IDENTITY,
      poolProof: poolProof(),
      enabled: true,
      transport: async () => {
        calls += 1;
        return new Response("rate limited", {status: 429});
      },
      clock: () => NOW,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.reasonCode, "HTTP_429");
    assert.equal(calls, 1);
  });

  await t.test("foreign response origin", async () => {
    let calls = 0;
    const result = await collectLpProtectionSource({
      identity: IDENTITY,
      poolProof: poolProof(),
      enabled: true,
      transport: async () => {
        calls += 1;
        const response = new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: {}}), {
          status: 200,
          headers: {"content-type": "application/json"}
        });
        Object.defineProperty(response, "url", {value: "https://other.example/"});
        return response;
      },
      clock: () => NOW,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.reasonCode, "RESPONSE_ORIGIN_INVALID");
    assert.equal(calls, 1);
  });
});

test("pinned deployment semantics and authorization remain explicitly unsupported", () => {
  assert.equal(RAYDIUM_CPMM_PROGRAM_ID, "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
  assert.equal(TOKEN_PROGRAM_ID, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
});
