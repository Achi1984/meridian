export const SYNTHETIC_FIXTURE_LABEL = "SYNTHETIC_ONLY_NOT_CHAIN_DATA";
export const SYNTHETIC_MINT = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
export const LEGACY_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export function syntheticTlv(type, value, {declaredLength = value.length} = {}) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(declaredLength, 2);
  return Buffer.concat([header, value]);
}

function authorityOption(state, fill) {
  const option = Buffer.alloc(36);
  if (state === "present") {
    option.writeUInt32LE(1, 0);
    option.fill(fill, 4);
  } else if (state === "absent-retaining-key") {
    option.writeUInt32LE(1, 0);
    option.fill(fill, 4);
    option.writeUInt32LE(0, 0);
  } else if (state !== "absent") {
    option.writeUInt32LE(state, 0);
  }
  return option;
}

export function createSyntheticMintBytes({
  ownerProgram = LEGACY_TOKEN_PROGRAM,
  mintAuthority = "absent",
  freezeAuthority = "absent",
  initialized = 1,
  decimals = 6,
  supplyAtoms = 10_000n,
  extensions = []
} = {}) {
  const base = Buffer.alloc(82);
  authorityOption(mintAuthority, 7).copy(base, 0);
  base.writeBigUInt64LE(BigInt(supplyAtoms), 36);
  base[44] = decimals;
  base[45] = initialized;
  authorityOption(freezeAuthority, 9).copy(base, 46);
  if (ownerProgram !== TOKEN_2022_PROGRAM || extensions.length === 0) return base;
  return Buffer.concat([
    base,
    Buffer.alloc(83),
    Buffer.from([1]),
    ...extensions
  ]);
}

export function createSyntheticEvidence({
  chainId = "solana",
  expectedMint = SYNTHETIC_MINT,
  requestedMint = expectedMint,
  accountPubkey = requestedMint,
  ownerProgram = LEGACY_TOKEN_PROGRAM,
  mintAuthority = "absent",
  freezeAuthority = "absent",
  initialized = 1,
  decimals = 6,
  supplyAtoms = 10_000n,
  extensions = [],
  slot = 123_456,
  observedAt = 1_800_000_000_000,
  accountData
} = {}) {
  const data = accountData ?? createSyntheticMintBytes({
    ownerProgram,
    mintAuthority,
    freezeAuthority,
    initialized,
    decimals,
    supplyAtoms,
    extensions
  });
  return {
    fixtureLabel: SYNTHETIC_FIXTURE_LABEL,
    chainId,
    expectedMint,
    requestedMint,
    accountPubkey,
    observedAt,
    rpcResult: {
      context: slot === undefined ? {} : {slot},
      value: {
        owner: ownerProgram,
        data: [data.toString("base64"), "base64"]
      }
    }
  };
}

export function syntheticTransferFeeConfig({
  olderEpoch = 0n,
  olderMaxFee = 100n,
  olderBasisPoints = 250,
  newerEpoch = 10n,
  newerMaxFee = 500n,
  newerBasisPoints = 500
} = {}) {
  const value = Buffer.alloc(108);
  value.fill(3, 0, 32);
  value.fill(4, 32, 64);
  value.writeBigUInt64LE(5n, 64);
  value.writeBigUInt64LE(BigInt(olderEpoch), 72);
  value.writeBigUInt64LE(BigInt(olderMaxFee), 80);
  value.writeUInt16LE(olderBasisPoints, 88);
  value.writeBigUInt64LE(BigInt(newerEpoch), 90);
  value.writeBigUInt64LE(BigInt(newerMaxFee), 98);
  value.writeUInt16LE(newerBasisPoints, 106);
  return value;
}
