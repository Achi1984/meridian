import assert from "node:assert/strict";
import test from "node:test";
import {decodeMintSafetyEvidence} from "../scripts/memecoin-paper-token-safety/decode.mjs";
import {
  createSyntheticEvidence,
  createSyntheticMintBytes,
  LEGACY_TOKEN_PROGRAM,
  SYNTHETIC_FIXTURE_LABEL,
  SYNTHETIC_MINT,
  syntheticTlv,
  syntheticTransferFeeConfig,
  TOKEN_2022_PROGRAM
} from "./fixtures/memecoin-paper-token-safety/generate.mjs";

const decode = evidence => decodeMintSafetyEvidence(evidence);

function replaceAccountData(evidence, data) {
  return {
    ...evidence,
    rpcResult: {
      ...evidence.rpcResult,
      value: {...evidence.rpcResult.value, data: [data, "base64"]}
    }
  };
}

test("legacy mint decode binds identity, owner program, slot, and observation time", () => {
  const evidence = createSyntheticEvidence();
  const result = decode(evidence);
  assert.equal(evidence.fixtureLabel, SYNTHETIC_FIXTURE_LABEL);
  assert.equal(result.status, "DECODED_UNVERIFIED");
  assert.deepEqual(result.reasonCodes, []);
  assert.deepEqual(result.binding, {
    chainId: "solana",
    expectedMint: SYNTHETIC_MINT,
    requestedMint: SYNTHETIC_MINT,
    accountPubkey: SYNTHETIC_MINT,
    ownerProgram: LEGACY_TOKEN_PROGRAM,
    slot: "123456",
    observedAt: 1_800_000_000_000
  });
  assert.deepEqual(result.mint, {supplyAtoms: "10000", decimals: 6, initialized: true});
  assert.equal(result.authorities.mint.state, "ABSENT");
  assert.equal(result.authorities.mint.revoked, true);
  assert.equal(result.authorities.freeze.state, "ABSENT");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.hardGateEligible, false);
  assert.notEqual(result.status, "PASS");
});

test("valid active authorities remain explicitly present, not inferred from other fields", () => {
  const result = decode(createSyntheticEvidence({
    mintAuthority: "present",
    freezeAuthority: "present"
  }));
  assert.equal(result.status, "DECODED_UNVERIFIED");
  assert.equal(result.authorities.mint.state, "PRESENT");
  assert.equal(result.authorities.mint.revoked, false);
  assert.equal(result.authorities.freeze.state, "PRESENT");
  assert.equal(result.authorities.freeze.revoked, false);
  assert.match(result.authorities.mint.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test("supported Token-2022 extensions expose their narrowly decoded semantics", () => {
  const hook = Buffer.alloc(64);
  hook.fill(8, 0, 32);
  hook.fill(9, 32, 64);
  const result = decode(createSyntheticEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [
      syntheticTlv(1, syntheticTransferFeeConfig()),
      syntheticTlv(14, hook),
      syntheticTlv(12, Buffer.alloc(32, 6)),
      syntheticTlv(6, Buffer.from([2]))
    ]
  }));
  assert.equal(result.status, "DECODED_UNVERIFIED");
  assert.deepEqual(result.extensions.types, [
    "TransferFeeConfig", "TransferHook", "PermanentDelegate", "DefaultAccountState"
  ]);
  assert.equal(result.extensions.restrictions.transferFeeConfig.state, "PRESENT");
  assert.equal(result.extensions.restrictions.transferFeeConfig.olderFee.basisPoints, 250);
  assert.equal(result.extensions.restrictions.transferFeeConfig.newerFee.maximumFeeAtoms, "500");
  assert.equal(result.extensions.restrictions.transferFeeConfig.configuredNonzeroFee, true);
  assert.equal(result.extensions.restrictions.transferHook.hookProgramConfigured, true);
  assert.equal(result.extensions.restrictions.permanentDelegate.delegateState, "PRESENT");
  assert.equal(result.extensions.restrictions.defaultAccountState.defaultState, "FROZEN");
  assert.equal(result.extensions.restrictions.defaultAccountState.newAccountsDefaultFrozen, true);
});

test("Token-2022 mint with no TLV extensions has explicit complete absence", () => {
  const result = decode(createSyntheticEvidence({ownerProgram: TOKEN_2022_PROGRAM}));
  assert.equal(result.status, "DECODED_UNVERIFIED");
  assert.equal(result.extensions.state, "ABSENT");
  assert.deepEqual(result.extensions.types, []);
  assert.equal(result.extensions.restrictions.transferHook.state, "ABSENT");
});

test("forged requested mint and account address do not bind to the expected mint", () => {
  const forgedMint = "YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf";
  const evidence = createSyntheticEvidence({requestedMint: forgedMint});
  const result = decode(evidence);
  assert.equal(result.status, "UNAVAILABLE");
  assert.ok(result.reasonCodes.includes("REQUESTED_MINT_MISMATCH"));
  assert.equal(result.authorities.mint.state, "UNAVAILABLE");
  assert.equal(result.authorities.mint.revoked, null);

  const forgedAccount = decode(createSyntheticEvidence({
    accountPubkey: forgedMint
  }));
  assert.ok(forgedAccount.reasonCodes.includes("ACCOUNT_PUBKEY_MISMATCH"));
});

test("unsupported or forged token owner program fails closed", () => {
  const result = decode(createSyntheticEvidence({ownerProgram: SYNTHETIC_MINT}));
  assert.equal(result.status, "UNAVAILABLE");
  assert.ok(result.reasonCodes.includes("MINT_OWNER_PROGRAM_UNSUPPORTED"));
  assert.equal(result.extensions.state, "UNAVAILABLE");
});

test("evidence declared for a different chain does not decode as Solana", () => {
  const result = decode(createSyntheticEvidence({chainId: "other-chain"}));
  assert.equal(result.status, "UNAVAILABLE");
  assert.ok(result.reasonCodes.includes("CHAIN_ID_NOT_SOLANA"));
});

test("missing RPC slot and observation time remain unavailable", () => {
  const missingSlot = decode(createSyntheticEvidence({slot: null}));
  assert.ok(missingSlot.reasonCodes.includes("RPC_CONTEXT_SLOT_MISSING"));
  assert.equal(missingSlot.authorities.freeze.state, "UNAVAILABLE");

  const missingTime = decode(createSyntheticEvidence({observedAt: null}));
  assert.ok(missingTime.reasonCodes.includes("OBSERVED_AT_MISSING"));
  assert.equal(missingTime.authorities.mint.revoked, null);
});

test("truncated, oversized, and noncanonical base64 account data are rejected", () => {
  const truncated = createSyntheticMintBytes().subarray(0, 81).toString("base64");
  assert.ok(decode(replaceAccountData(createSyntheticEvidence(), truncated))
    .reasonCodes.includes("MINT_ACCOUNT_DATA_TRUNCATED"));

  const oversized = Buffer.alloc(10_241).toString("base64");
  assert.ok(decode(replaceAccountData(createSyntheticEvidence(), oversized))
    .reasonCodes.includes("ACCOUNT_DATA_OVERSIZED"));

  const canonical = createSyntheticMintBytes().toString("base64");
  const noncanonical = canonical.slice(0, -1);
  const invalid = decode(replaceAccountData(createSyntheticEvidence(), noncanonical));
  assert.ok(invalid.reasonCodes.includes("ACCOUNT_DATA_BASE64_NONCANONICAL"));
  assert.equal(invalid.authorities.mint.state, "UNAVAILABLE");
});

test("unsupported encodings and invalid authority option tags are unavailable", () => {
  const wrongEncoding = createSyntheticEvidence();
  wrongEncoding.rpcResult.value.data[1] = "base64+zstd";
  assert.ok(decode(wrongEncoding).reasonCodes.includes("RPC_ACCOUNT_DATA_NOT_BASE64_TUPLE"));

  const invalidOption = createSyntheticMintBytes({mintAuthority: 2}).toString("base64");
  assert.ok(decode(replaceAccountData(createSyntheticEvidence(), invalidOption))
    .reasonCodes.includes("INVALID_AUTHORITY_OPTION:mint"));
});

test("noncanonical absent-authority payload and uninitialized mint do not imply renunciation", () => {
  const noncanonical = createSyntheticMintBytes();
  noncanonical[4] = 1;
  const invalidAuthority = decode(replaceAccountData(
    createSyntheticEvidence(),
    noncanonical.toString("base64")
  ));
  assert.ok(invalidAuthority.reasonCodes.includes("NONCANONICAL_NONE_AUTHORITY:mint"));
  assert.equal(invalidAuthority.authorities.mint.revoked, null);

  const uninitialized = decode(createSyntheticEvidence({initialized: 0}));
  assert.ok(uninitialized.reasonCodes.includes("MINT_NOT_INITIALIZED"));
  assert.equal(uninitialized.authorities.mint.state, "UNAVAILABLE");
});

test("duplicate, unknown, and malformed Token-2022 TLV entries fail closed", () => {
  const feeConfig = syntheticTlv(1, syntheticTransferFeeConfig());
  const duplicate = decode(createSyntheticEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [feeConfig, feeConfig]
  }));
  assert.ok(duplicate.reasonCodes.includes("TOKEN_2022_TLV_DUPLICATE_TYPE:1"));

  const unknown = decode(createSyntheticEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(99, Buffer.from([1]))]
  }));
  assert.ok(unknown.reasonCodes.includes("TOKEN_2022_EXTENSION_UNSUPPORTED:99"));

  const malformed = decode(createSyntheticEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(1, Buffer.from([1, 2]), {declaredLength: 108})]
  }));
  assert.ok(malformed.reasonCodes.includes("TOKEN_2022_TLV_VALUE_TRUNCATED:1"));
  assert.equal(malformed.extensions.state, "UNAVAILABLE");
});

test("Token-2022 type marker, padding, and extension payload semantics are checked", () => {
  const wrongMarker = createSyntheticMintBytes({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(12, Buffer.alloc(32))]
  });
  wrongMarker[165] = 2;
  assert.ok(decode(replaceAccountData(
    createSyntheticEvidence({ownerProgram: TOKEN_2022_PROGRAM}),
    wrongMarker.toString("base64")
  )).reasonCodes.includes("TOKEN_2022_ACCOUNT_TYPE_NOT_MINT"));

  const invalidDefaultState = decode(createSyntheticEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(6, Buffer.from([0]))]
  }));
  assert.ok(invalidDefaultState.reasonCodes.includes("INVALID_DEFAULT_ACCOUNT_STATE_VALUE"));

  const invalidFee = syntheticTransferFeeConfig({olderBasisPoints: 10_001});
  const invalidBasisPoints = decode(createSyntheticEvidence({
    ownerProgram: TOKEN_2022_PROGRAM,
    extensions: [syntheticTlv(1, invalidFee)]
  }));
  assert.ok(invalidBasisPoints.reasonCodes.includes("INVALID_TRANSFER_FEE_BASIS_POINTS:older"));
});

test("mint decoding leaves LP, ownership, developer, bundle, and wallet facts unknown", () => {
  const facts = decode(createSyntheticEvidence()).otherSafetyFacts;
  assert.equal(facts.lpLock.state, "UNKNOWN");
  assert.equal(facts.ownerConcentration.state, "UNKNOWN");
  assert.equal(facts.developerAttribution.state, "UNKNOWN");
  assert.equal(facts.bundleAnalysis.state, "UNKNOWN");
  assert.equal(facts.smartWalletProvenance.state, "UNKNOWN");
  assert.match(facts.top20AccountsNote, /not unique owners/);
});
