import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {
  collectLpProtectionSource,
  LP_PROTECTION_DECODER_VERSION,
  LP_PROTECTION_SOURCE_VERSION,
  LP_BURN_FIXTURE_TRUST_POLICY,
  RAYDIUM_CPMM_PROGRAM_ID
} from "../scripts/memecoin-paper/lp-protection-source.mjs";
import {
  encodeBase58,
  IDENTITY,
  LP_MINT,
  NOW,
  PDA_AUTHORITY,
  TOKEN_PROGRAM_ID,
  WALLET_AUTHORITY,
  finalizedBurnEvidence,
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
  burnTransactions,
  fixtureTrustPolicy,
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
    burnTransactions,
    fixtureTrustPolicy,
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

test("finalized SPL burns support exact fixture-only protection without operational PASS", async t => {
  await t.test("full burn reconciles exact denominator under explicit fixture policy", async () => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    const evidence = finalizedBurnEvidence({holdUntil: HOLD_UNTIL});
    const {result} = await collect({
      proof,
      accounts: [],
      burnTransactions: [evidence],
      fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.measurement.actualBurnAtoms, "1000");
    assert.equal(result.measurement.protectionDenominatorAtoms, "1000");
    assert.equal(result.measurement.protectedAtoms, "1000");
    assert.equal(result.measurement.coverage.actualBurnEvidenceStatus.startsWith("RECONCILED"), true);
    assert.equal(result.measurement.burnAssessment.status, "PASS");
    assert.equal(result.measurement.burnAssessment.trustPolicy, LP_BURN_FIXTURE_TRUST_POLICY);
    assert.equal(result.measurement.burnAssessment.holdUntil, HOLD_UNTIL);
    assert.match(result.measurement.burnAssessment.releasePath, /NONE/);
    assert.match(result.measurement.burnAssessment.administrativePath, /mint authority/);
    assert.equal(result.measurement.burnAssessment.decodedTransactions[0].claimedBurnAtoms, "1000");
    assert.match(
      result.measurement.burnAssessment.decodedTransactions[0].responseSha256,
      /^[a-f0-9]{64}$/
    );
    assert.equal(
      result.measurement.burnAssessment.decodedTransactions[0]
        .transactionEvidence.transaction.signatures[0],
      evidence.signature
    );
    assert.equal(
      result.measurement.burnAssessment.decodedTransactions[0]
        .decodedInstructions[0].parsed.type,
      "burnChecked"
    );
    assert.equal(result.measurement.burnAssessment.decodedInstructions[0].amountAtoms, "1000");
    assert.equal(result.lpProtection.status, "UNKNOWN");
    assert.equal(result.lpProtection.verified, false);
    assert.equal(result.adapterEvidence.verified, false);
  });

  await t.test("partial exact burn is measured but never passes", async () => {
    const proof = poolProof({supplyAtoms: "500", poolSupplyAtoms: "1100"});
    const {result} = await collect({
      proof,
      accounts: [tokenAccount({amountAtoms: "500"})],
      burnTransactions: [finalizedBurnEvidence({amountAtoms: "500", holdUntil: HOLD_UNTIL})],
      fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.measurement.protectedAtoms, "500");
    assert.equal(result.measurement.protectionDenominatorAtoms, "1000");
    assert.equal(result.measurement.burnAssessment.status, "UNKNOWN");
    assert.match(result.measurement.burnAssessment.reason, /partial/);
    assert.equal(result.lpProtection.status, "UNKNOWN");
  });

  await t.test("missing burn history cannot be inferred from zero current supply", async () => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    const {result} = await collect({
      proof,
      accounts: [],
      burnTransactions: [],
      fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.measurement.protectedAtoms, null);
    assert.equal(result.measurement.burnAssessment.status, "UNKNOWN");
    assert.match(result.measurement.burnAssessment.reason, /does not reconcile/);
    assert.equal(result.lpProtection.status, "UNKNOWN");
  });

  await t.test("an exact full burn is not a fixture PASS without explicit trust policy", async () => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    const {result} = await collect({
      proof,
      accounts: [],
      burnTransactions: [finalizedBurnEvidence({holdUntil: HOLD_UNTIL})],
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.measurement.protectedAtoms, "1000");
    assert.equal(result.measurement.burnAssessment.status, "UNKNOWN");
    assert.equal(result.measurement.burnAssessment.trustPolicy, "NONE");
  });

  await t.test("CPMM withdrawal/release path in same transaction is rejected", async () => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    const evidence = finalizedBurnEvidence({
      holdUntil: HOLD_UNTIL,
      includesCpmmInstruction: true
    });
    const {result} = await collect({
      proof,
      accounts: [],
      burnTransactions: [evidence],
      fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.reasonCode, "BURN_RELEASE_PATH_PRESENT");
    assert.equal(result.lpProtection.status, "UNKNOWN");
  });

  await t.test("wrong LP mint in the burn instruction is rejected", async () => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    const {result} = await collect({
      proof,
      accounts: [],
      burnTransactions: [finalizedBurnEvidence({
        holdUntil: HOLD_UNTIL,
        instructionMint: IDENTITY.quote
      })],
      fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.reasonCode, "BURN_MINT_MISMATCH");
  });

  await t.test("wrong burn program and out-of-snapshot slot are rejected", async t => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    await t.test("instruction is not from the pinned SPL Token program", async () => {
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [finalizedBurnEvidence({
          holdUntil: HOLD_UNTIL,
          instructionProgramId: IDENTITY.quote
        })],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_INSTRUCTION_MISSING");
    });
    await t.test("transaction is later than the pinned pool snapshot", async () => {
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [finalizedBurnEvidence({holdUntil: HOLD_UNTIL, slot: proof.slot + 1})],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_EVIDENCE_INVALID");
    });
    await t.test("transaction slot differs from supplied source slot", async () => {
      const evidence = finalizedBurnEvidence({holdUntil: HOLD_UNTIL});
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [{...evidence, slot: evidence.slot - 1}],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_TRANSACTION_NOT_FINALIZED_OR_INCOMPLETE");
    });
  });

  await t.test("pool, amount, and denominator claims are bound to decoded evidence", async t => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    await t.test("wrong pool", async () => {
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [finalizedBurnEvidence({pool: IDENTITY.quote, holdUntil: HOLD_UNTIL})],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_EVIDENCE_INVALID");
    });
    await t.test("claimed amount differs from decoded instructions", async () => {
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [{
          ...finalizedBurnEvidence({holdUntil: HOLD_UNTIL}),
          claimedBurnAtoms: "999"
        }],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_CLAIM_AMOUNT_MISMATCH");
    });
    await t.test("claimed denominator differs from pool-bound denominator", async () => {
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [{
          ...finalizedBurnEvidence({holdUntil: HOLD_UNTIL}),
          denominatorAtoms: "999"
        }],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_EVIDENCE_INVALID");
    });
  });

  await t.test("duplicate, failed, and digest-changed transactions fail closed", async t => {
    const proof = poolProof({supplyAtoms: "0", poolSupplyAtoms: "1100"});
    const evidence = finalizedBurnEvidence({holdUntil: HOLD_UNTIL});
    await t.test("duplicate transaction signature", async () => {
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [evidence, evidence],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "DUPLICATE_BURN_EVIDENCE");
    });
    await t.test("multisigner alias cannot count one canonical transaction twice", async () => {
      const canonicalSignature = encodeBase58(Buffer.alloc(64, 2));
      const aliasSignature = encodeBase58(Buffer.alloc(64, 3));
      const canonical = finalizedBurnEvidence({
        holdUntil: HOLD_UNTIL,
        signature: canonicalSignature,
        transactionSignatures: [canonicalSignature, aliasSignature]
      });
      const alias = {...canonical, signature: aliasSignature};
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [canonical, alias],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_TRANSACTION_SIGNATURE_NOT_CANONICAL");
      assert.equal(result.lpProtection.status, "UNKNOWN");
    });
    await t.test("failed transaction", async () => {
      const failed = finalizedBurnEvidence({
        holdUntil: HOLD_UNTIL,
        transactionError: {InstructionError: [0, "Custom"]}
      });
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [failed],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_TRANSACTION_NOT_FINALIZED_OR_INCOMPLETE");
    });
    await t.test("changed response digest", async () => {
      const changed = {...evidence, responseJson: evidence.responseJson.replace('"amount":"1000"', '"amount":"900"')};
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [changed],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_RESPONSE_DIGEST_MISMATCH");
    });
    await t.test("CPMM invocation in inner instructions is excluded", async () => {
      const inner = finalizedBurnEvidence({
        holdUntil: HOLD_UNTIL,
        innerInstructions: [{
          index: 0,
          instructions: [{programId: RAYDIUM_CPMM_PROGRAM_ID, parsed: {type: "withdraw"}}]
        }]
      });
      const {result} = await collect({
        proof,
        accounts: [],
        burnTransactions: [inner],
        fixtureTrustPolicy: LP_BURN_FIXTURE_TRUST_POLICY,
        holdUntil: HOLD_UNTIL
      });
      assert.equal(result.reasonCode, "BURN_RELEASE_PATH_PRESENT");
    });
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

test("reader cleanup never blocks cancellation or timeout", async t => {
  for (const behavior of ["never settles", "rejects", "throws"]) {
    await t.test(`reader cancel ${behavior}`, async () => {
      const controller = new AbortController();
      let cancelCalls = 0;
      const response = {
        status: 200,
        headers: {get: name => name === "content-type" ? "application/json" : null},
        body: {
          getReader: () => ({
            read: () => new Promise(() => {}),
            cancel: () => {
              cancelCalls += 1;
              if (behavior === "never settles") return new Promise(() => {});
              if (behavior === "rejects") return Promise.reject(new Error("cancel failed"));
              throw new Error("cancel failed");
            },
            releaseLock() {}
          })
        }
      };
      const pending = collectLpProtectionSource({
        identity: IDENTITY,
        poolProof: poolProof(),
        enabled: true,
        transport: async () => response,
        clock: () => NOW,
        holdUntil: HOLD_UNTIL,
        signal: controller.signal
      });
      const abortTimer = setTimeout(() => controller.abort(), 10);
      try {
        const result = await Promise.race([
          pending,
          new Promise((_, reject) => setTimeout(
            () => reject(new Error("reader cleanup exceeded abort deadline")),
            300
          ))
        ]);
        assert.equal(result.reasonCode, "CANCELLED");
        assert.equal(cancelCalls, 1);
      } finally {
        clearTimeout(abortTimer);
      }
    });
  }

  await t.test("request timeout is not extended by a never-settling cancel", async () => {
    let cancelCalls = 0;
    const response = {
      status: 200,
      headers: {get: name => name === "content-type" ? "application/json" : null},
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: () => {
            cancelCalls += 1;
            return new Promise(() => {});
          },
          releaseLock() {}
        })
      }
    };
    const result = await Promise.race([
      collectLpProtectionSource({
        identity: IDENTITY,
        poolProof: poolProof(),
        enabled: true,
        transport: async () => response,
        clock: () => NOW,
        holdUntil: HOLD_UNTIL
      }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("request timeout was extended by stream cleanup")),
        5_500
      ))
    ]);
    assert.equal(result.reasonCode, "TIMEOUT");
    assert.equal(cancelCalls, 1);
  });
});

test("a response body arriving after cancellation is discarded without waiting", async () => {
  const controller = new AbortController();
  let resolveResponse;
  let cancelBody;
  const bodyCancelled = new Promise(resolve => { cancelBody = resolve; });
  const response = new Response(new ReadableStream({
    cancel() {
      cancelBody();
      return new Promise(() => {});
    }
  }), {
    status: 200,
    headers: {"content-type": "application/json"}
  });
  const pending = collectLpProtectionSource({
    identity: IDENTITY,
    poolProof: poolProof(),
    enabled: true,
    transport: (_request, {signal}) => {
      const delayed = new Promise(resolve => { resolveResponse = resolve; });
      signal.addEventListener("abort", () => {
        setTimeout(() => resolveResponse(response), 10);
      }, {once: true});
      return delayed;
    },
    clock: () => NOW,
    holdUntil: HOLD_UNTIL,
    signal: controller.signal
  });
  const abortTimer = setTimeout(() => controller.abort(), 10);
  try {
    const result = await pending;
    assert.equal(result.reasonCode, "CANCELLED");
    await Promise.race([
      bodyCancelled,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("late response body was not discarded")),
        300
      ))
    ]);
  } finally {
    clearTimeout(abortTimer);
  }
});

test("injected clock observations and pool-proof chronology are monotonic", async t => {
  await t.test("backward receipt observation is invalid", async () => {
    const proof = poolProof();
    const built = transportFor({proof, accounts: [tokenAccount()]});
    const observations = [NOW, NOW, NOW, NOW - 1_000];
    const result = await collectLpProtectionSource({
      identity: IDENTITY,
      poolProof: proof,
      enabled: true,
      transport: built.transport,
      clock: () => observations.shift() ?? NOW,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "INVALID_CLOCK");
    assert.equal(result.counters.requests, 1);
  });

  await t.test("pool proof observed after collection start is invalid", async () => {
    const proof = poolProof();
    proof.observedAt = NOW + 1;
    let calls = 0;
    const result = await collectLpProtectionSource({
      identity: IDENTITY,
      poolProof: proof,
      enabled: true,
      transport: () => { calls += 1; },
      clock: () => NOW,
      holdUntil: HOLD_UNTIL
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reasonCode, "INVALID_CLOCK");
    assert.equal(calls, 0);
  });

  await t.test("an earlier pool-proof observation remains valid", async () => {
    const proof = poolProof({observedAt: NOW - 1});
    const {result} = await collect({proof, accounts: [tokenAccount()]});
    assert.equal(result.status, "MEASURED_UNVERIFIED");
  });
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
