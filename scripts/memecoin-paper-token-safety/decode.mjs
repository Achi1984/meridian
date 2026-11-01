const LEGACY_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_ACCOUNT_DATA_BYTES = 10_240;
const MAX_ACCOUNT_DATA_BASE64_CHARS = 4 * Math.ceil(MAX_ACCOUNT_DATA_BYTES / 3);
const MAX_TLV_EXTENSIONS = 64;
const U64_MAX = (1n << 64n) - 1n;
const EXTENSIONS = Object.freeze({
  transferFeeConfig: 1,
  defaultAccountState: 6,
  permanentDelegate: 12,
  transferHook: 14
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeBase58(value) {
  if (typeof value !== "string" || !BASE58_PATTERN.test(value)) return null;
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_VALUES.get(character);
    if (digit === undefined) return null;
    decoded = decoded * 58n + BigInt(digit);
  }
  const bytes = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  bytes.reverse();
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") leadingZeroes += 1;
  const result = new Uint8Array(leadingZeroes + bytes.length);
  result.set(bytes, leadingZeroes);
  return result.length === 32 ? result : null;
}

function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return "1".repeat(leadingZeroes) + encoded;
}

function parseSlot(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value).toString();
  }
  if (typeof value === "string" && /^(0|[1-9]\d{0,19})$/.test(value)) {
    const slot = BigInt(value);
    if (slot <= U64_MAX) return slot.toString();
  }
  return null;
}

function parseObservedAt(value) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && value.length <= 64 ? Date.parse(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 &&
    Number.isFinite(new Date(parsed).getTime()) ? parsed : null;
}

function unavailable(reasonCodes) {
  const reasons = [...new Set(reasonCodes)];
  const authorityReason = reasons[0] ?? "MINT_ACCOUNT_EVIDENCE_UNAVAILABLE";
  const unavailableAuthority = () => ({
    state: "UNAVAILABLE",
    revoked: null,
    address: null,
    reason: authorityReason
  });
  const unavailableRestriction = () => ({
    state: "UNAVAILABLE",
    reason: "MINT_ACCOUNT_DECODE_UNAVAILABLE"
  });
  return {
    status: "UNAVAILABLE",
    reasonCodes: reasons,
    binding: null,
    mint: null,
    authorities: {
      mint: unavailableAuthority(),
      freeze: unavailableAuthority()
    },
    extensions: {
      state: "UNAVAILABLE",
      types: null,
      restrictions: {
        transferFeeConfig: unavailableRestriction(),
        transferHook: unavailableRestriction(),
        permanentDelegate: unavailableRestriction(),
        defaultAccountState: unavailableRestriction()
      },
      reason: "MINT_ACCOUNT_DECODE_UNAVAILABLE"
    },
    otherSafetyFacts: unknownSafetyFacts(),
    authorizationEligible: false,
    hardGateEligible: false
  };
}

function unknownSafetyFacts() {
  return {
    lpLock: {state: "UNKNOWN", reason: "LP_LOCK_NOT_IN_MINT_ACCOUNT_DATA"},
    ownerConcentration: {state: "UNKNOWN", reason: "MINT_ACCOUNT_DATA_DOES_NOT_AGGREGATE_TOKEN_ACCOUNT_OWNERS"},
    developerAttribution: {state: "UNKNOWN", reason: "DEVELOPER_ATTRIBUTION_NOT_IN_MINT_ACCOUNT_DATA"},
    bundleAnalysis: {state: "UNKNOWN", reason: "BUNDLE_ANALYSIS_NOT_IN_MINT_ACCOUNT_DATA"},
    smartWalletProvenance: {state: "UNKNOWN", reason: "WALLET_PROVENANCE_NOT_IN_MINT_ACCOUNT_DATA"},
    top20AccountsNote: "Top-20 token accounts are not unique owners and are not a complete owner distribution."
  };
}

function parseCOptionAddress(bytes, offset, field) {
  const tag = bytes.readUInt32LE(offset);
  const addressBytes = bytes.subarray(offset + 4, offset + 36);
  if (tag === 0) {
    return {state: "ABSENT", revoked: true, address: null, reason: "NONE_AUTHORITY_OPTION_TAG"};
  }
  if (tag !== 1) throw new Error(`INVALID_AUTHORITY_OPTION:${field}`);
  return {
    state: "PRESENT",
    revoked: false,
    address: encodeBase58(addressBytes),
    reason: "AUTHORITY_PUBLIC_KEY_PRESENT"
  };
}

function parseNullableAddress(bytes, field) {
  if (bytes.every(byte => byte === 0)) return null;
  if (bytes.length !== 32) throw new Error(`INVALID_EXTENSION_ADDRESS:${field}`);
  return encodeBase58(bytes);
}

function parseTransferFeeConfig(value) {
  if (value.length !== 108) throw new Error("INVALID_TRANSFER_FEE_CONFIG_LENGTH");
  const feeSchedule = (offset, name) => {
    const epoch = value.readBigUInt64LE(offset);
    const maximumFee = value.readBigUInt64LE(offset + 8);
    const basisPoints = value.readUInt16LE(offset + 16);
    if (basisPoints > 10_000) throw new Error(`INVALID_TRANSFER_FEE_BASIS_POINTS:${name}`);
    return {
      epoch: epoch.toString(),
      maximumFeeAtoms: maximumFee.toString(),
      basisPoints
    };
  };
  const olderFee = feeSchedule(72, "older");
  const newerFee = feeSchedule(90, "newer");
  return {
    state: "PRESENT",
    reason: "TOKEN_2022_TRANSFER_FEE_CONFIG_PRESENT",
    configAuthority: parseNullableAddress(value.subarray(0, 32), "transferFeeConfigAuthority"),
    withdrawWithheldAuthority: parseNullableAddress(value.subarray(32, 64), "withdrawWithheldAuthority"),
    withheldAmountAtoms: value.readBigUInt64LE(64).toString(),
    olderFee,
    newerFee,
    configuredNonzeroFee: [olderFee, newerFee].some(fee =>
      fee.basisPoints > 0 && BigInt(fee.maximumFeeAtoms) > 0n)
  };
}

function parseTransferHook(value) {
  if (value.length !== 64) throw new Error("INVALID_TRANSFER_HOOK_LENGTH");
  const authority = parseNullableAddress(value.subarray(0, 32), "transferHookAuthority");
  const programId = parseNullableAddress(value.subarray(32, 64), "transferHookProgramId");
  return {
    state: "PRESENT",
    reason: "TOKEN_2022_TRANSFER_HOOK_EXTENSION_PRESENT",
    authority,
    programId,
    hookProgramConfigured: programId !== null
  };
}

function parsePermanentDelegate(value) {
  if (value.length !== 32) throw new Error("INVALID_PERMANENT_DELEGATE_LENGTH");
  const address = parseNullableAddress(value, "permanentDelegate");
  return {
    state: "PRESENT",
    reason: "TOKEN_2022_PERMANENT_DELEGATE_EXTENSION_PRESENT",
    delegateState: address === null ? "ABSENT" : "PRESENT",
    address
  };
}

function parseDefaultAccountState(value) {
  if (value.length !== 1) throw new Error("INVALID_DEFAULT_ACCOUNT_STATE_LENGTH");
  const state = value[0];
  if (state !== 1 && state !== 2) throw new Error("INVALID_DEFAULT_ACCOUNT_STATE_VALUE");
  return {
    state: "PRESENT",
    reason: "TOKEN_2022_DEFAULT_ACCOUNT_STATE_EXTENSION_PRESENT",
    defaultState: state === 1 ? "INITIALIZED" : "FROZEN",
    newAccountsDefaultFrozen: state === 2
  };
}

function decodeExtensions(bytes, token2022) {
  const absentRestriction = name => ({
    state: "ABSENT",
    reason: `TOKEN_2022_EXTENSION_NOT_PRESENT:${name}`
  });
  const empty = {
    transferFeeConfig: absentRestriction("TransferFeeConfig"),
    transferHook: absentRestriction("TransferHook"),
    permanentDelegate: absentRestriction("PermanentDelegate"),
    defaultAccountState: absentRestriction("DefaultAccountState")
  };
  if (!token2022 || bytes.length === 82) {
    return {state: "ABSENT", types: [], restrictions: empty};
  }
  if (bytes.length < 166) throw new Error("TOKEN_2022_MINT_EXTENSION_HEADER_TRUNCATED");
  if (bytes.subarray(82, 165).some(byte => byte !== 0)) {
    throw new Error("TOKEN_2022_MINT_PADDING_NONZERO");
  }
  if (bytes[165] !== 1) throw new Error("TOKEN_2022_ACCOUNT_TYPE_NOT_MINT");

  const supported = new Map([
    [EXTENSIONS.transferFeeConfig, ["TransferFeeConfig", "transferFeeConfig", parseTransferFeeConfig]],
    [EXTENSIONS.defaultAccountState, ["DefaultAccountState", "defaultAccountState", parseDefaultAccountState]],
    [EXTENSIONS.permanentDelegate, ["PermanentDelegate", "permanentDelegate", parsePermanentDelegate]],
    [EXTENSIONS.transferHook, ["TransferHook", "transferHook", parseTransferHook]]
  ]);
  const types = [];
  const seen = new Set();
  const restrictions = {...empty};
  let offset = 166;
  while (offset < bytes.length) {
    if (types.length >= MAX_TLV_EXTENSIONS) throw new Error("TOKEN_2022_TLV_ITERATION_LIMIT");
    if (bytes.length - offset < 4) throw new Error("TOKEN_2022_TLV_HEADER_TRUNCATED");
    const type = bytes.readUInt16LE(offset);
    const length = bytes.readUInt16LE(offset + 2);
    if (type === 0) throw new Error("TOKEN_2022_TLV_UNINITIALIZED_OR_PADDING");
    if (seen.has(type)) throw new Error(`TOKEN_2022_TLV_DUPLICATE_TYPE:${type}`);
    seen.add(type);
    const valueStart = offset + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > bytes.length) throw new Error(`TOKEN_2022_TLV_VALUE_TRUNCATED:${type}`);
    const definition = supported.get(type);
    if (!definition) throw new Error(`TOKEN_2022_EXTENSION_UNSUPPORTED:${type}`);
    const [name, key, parser] = definition;
    restrictions[key] = parser(bytes.subarray(valueStart, valueEnd));
    types.push(name);
    offset = valueEnd;
  }
  return {state: types.length > 0 ? "PRESENT" : "ABSENT", types, restrictions};
}

function decodeBase64AccountData(data) {
  if (!Array.isArray(data) || data.length !== 2 || data[1] !== "base64" ||
      typeof data[0] !== "string") {
    throw new Error("RPC_ACCOUNT_DATA_NOT_BASE64_TUPLE");
  }
  const encoded = data[0];
  if (encoded.length > MAX_ACCOUNT_DATA_BASE64_CHARS) throw new Error("ACCOUNT_DATA_OVERSIZED");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("ACCOUNT_DATA_BASE64_NONCANONICAL");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new Error("ACCOUNT_DATA_BASE64_NONCANONICAL");
  if (bytes.length > MAX_ACCOUNT_DATA_BYTES) throw new Error("ACCOUNT_DATA_OVERSIZED");
  if (bytes.length < 82) throw new Error("MINT_ACCOUNT_DATA_TRUNCATED");
  return bytes;
}

function bindingReasons(input) {
  const reasons = [];
  if (input.chainId !== "solana") reasons.push("CHAIN_ID_NOT_SOLANA");
  if (typeof input.expectedMint !== "string" || !decodeBase58(input.expectedMint)) {
    reasons.push("EXPECTED_MINT_INVALID");
  }
  if (typeof input.requestedMint !== "string" || !decodeBase58(input.requestedMint)) {
    reasons.push("REQUESTED_MINT_INVALID");
  }
  if (typeof input.accountPubkey !== "string" || !decodeBase58(input.accountPubkey)) {
    reasons.push("ACCOUNT_PUBKEY_INVALID");
  }
  if (typeof input.expectedMint === "string" && input.requestedMint !== input.expectedMint) {
    reasons.push("REQUESTED_MINT_MISMATCH");
  }
  if (typeof input.expectedMint === "string" && input.accountPubkey !== input.expectedMint) {
    reasons.push("ACCOUNT_PUBKEY_MISMATCH");
  }
  const slot = input.rpcResult?.context?.slot;
  if (slot === undefined || slot === null) reasons.push("RPC_CONTEXT_SLOT_MISSING");
  else if (parseSlot(slot) === null) reasons.push("RPC_CONTEXT_SLOT_INVALID");
  if (input.observedAt === undefined || input.observedAt === null) reasons.push("OBSERVED_AT_MISSING");
  else if (parseObservedAt(input.observedAt) === null) reasons.push("OBSERVED_AT_INVALID");
  const account = input.rpcResult?.value;
  if (!isRecord(account)) reasons.push("RPC_MINT_ACCOUNT_MISSING");
  else if (typeof account.owner !== "string" ||
      ![LEGACY_TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account.owner)) {
    reasons.push("MINT_OWNER_PROGRAM_UNSUPPORTED");
  }
  return reasons;
}

function decodeMint(bytes, token2022) {
  if (!token2022 && bytes.length !== 82) throw new Error("LEGACY_MINT_ACCOUNT_LENGTH_INVALID");
  const mintAuthority = parseCOptionAddress(bytes, 0, "mint");
  const freezeAuthority = parseCOptionAddress(bytes, 46, "freeze");
  if (bytes[45] !== 1) throw new Error("MINT_NOT_INITIALIZED");
  return {
    authorities: {mint: mintAuthority, freeze: freezeAuthority},
    mint: {
      supplyAtoms: bytes.readBigUInt64LE(36).toString(),
      decimals: bytes[44],
      initialized: true
    },
    extensions: decodeExtensions(bytes, token2022)
  };
}

export function decodeMintSafetyEvidence(input) {
  if (!isRecord(input)) return unavailable(["MINT_EVIDENCE_INPUT_INVALID"]);
  const reasons = bindingReasons(input);
  if (reasons.length > 0) return unavailable(reasons);

  let bytes;
  let decoded;
  try {
    bytes = decodeBase64AccountData(input.rpcResult.value.data);
    decoded = decodeMint(bytes, input.rpcResult.value.owner === TOKEN_2022_PROGRAM);
  } catch (error) {
    const reason = typeof error?.message === "string" ? error.message : "MINT_ACCOUNT_DECODE_FAILED";
    return unavailable([reason]);
  }
  const slot = parseSlot(input.rpcResult.context.slot);
  return {
    status: "DECODED_UNVERIFIED",
    reasonCodes: [],
    binding: {
      chainId: input.chainId,
      expectedMint: input.expectedMint,
      requestedMint: input.requestedMint,
      accountPubkey: input.accountPubkey,
      ownerProgram: input.rpcResult.value.owner,
      slot,
      observedAt: parseObservedAt(input.observedAt)
    },
    mint: decoded.mint,
    authorities: decoded.authorities,
    extensions: {
      ...decoded.extensions,
      reason: decoded.extensions.state === "ABSENT"
        ? "NO_SUPPORTED_TOKEN_2022_MINT_EXTENSIONS_DECODED"
        : "SUPPORTED_TOKEN_2022_MINT_EXTENSIONS_DECODED"
    },
    otherSafetyFacts: unknownSafetyFacts(),
    sourceStatus: "CALLER_INJECTED_RPC_DATA_NOT_AUTHENTICATED",
    accountDataBytes: bytes.length,
    authorizationEligible: false,
    hardGateEligible: false
  };
}
