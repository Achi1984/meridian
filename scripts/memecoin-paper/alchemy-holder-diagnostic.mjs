import {createHash} from "node:crypto";

export const ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS = Object.freeze({
  maxResponseBytes: 8_388_608,
  maxHolderRows: 10_000,
  maxWorkUnits: 4_000_000
});

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const U64_MAX = (1n << 64n) - 1n;
const AUTHORITY = Object.freeze({
  completeness: "UNKNOWN",
  trust: "UNKNOWN",
  censusEligible: false,
  executionAuthorized: false
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSlot(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d{0,19})$/.test(value)) {
    const slot = BigInt(value);
    if (slot <= U64_MAX) return slot;
  }
  return null;
}

function isPublicKey(value) {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_VALUES.get(character);
    if (digit === undefined) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (decoded > 0n) {
    bytes += 1;
    decoded >>= 8n;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes += 1;
  }
  return bytes === 32;
}

function canonicalAmount(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,19})$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= U64_MAX ? amount : null;
}

function canonicalUiAmount(value) {
  return typeof value === "string" && value.length <= 128 &&
    /^(?:0|[1-9]\d{0,126})(?:\.\d{1,128})?$/.test(value);
}

function output(reason, fields = {}) {
  return {
    status: "DIAGNOSTIC_ONLY",
    reason,
    actualSha256: null,
    expectedSha256Matched: null,
    responseMint: null,
    responseSlot: null,
    sortBy: null,
    holderRowCount: null,
    uniqueTokenAccountCount: null,
    duplicateRowCount: null,
    ownerCount: null,
    observedBalanceRawTotal: null,
    owners: null,
    capSaturated: false,
    workUnits: null,
    supplyComparison: {status: "NOT_CHECKED", reason: "NOT_SUPPLIED"},
    limits: ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS,
    ...fields,
    ...AUTHORITY
  };
}

function exactKeys(value, expected) {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    expected.every(key => Object.hasOwn(value, key)) &&
    keys.every(key => typeof key === "string" && expected.includes(key));
}

function compareSupply(supply, mint, slot, observedTotal) {
  if (supply === undefined || supply === null) {
    return {status: "NOT_CHECKED", reason: "NOT_SUPPLIED"};
  }
  if (!isRecord(supply) || !isPublicKey(supply.mint) || parseSlot(supply.slot) === null ||
      canonicalAmount(supply.supplyRaw) === null) {
    return {status: "NOT_CHECKED", reason: "INVALID_SUPPLY"};
  }
  if (supply.mint !== mint || parseSlot(supply.slot) !== slot) {
    return {status: "NOT_CHECKED", reason: "SUPPLY_IDENTITY_MISMATCH"};
  }
  return {
    status: canonicalAmount(supply.supplyRaw) === observedTotal ? "MATCH" : "MISMATCH",
    reason: null
  };
}

export function diagnoseAlchemyHolderResponse({
  expectedMint,
  expectedSlot,
  rawBytes,
  expectedSha256,
  sameSlotMintSupply,
  ...ignoredCallerClaims
} = {}) {
  void ignoredCallerClaims;
  const limits = ALCHEMY_HOLDER_DIAGNOSTIC_LIMITS;
  if (!isPublicKey(expectedMint)) return output("INVALID_EXPECTED_MINT");
  const parsedExpectedSlot = parseSlot(expectedSlot);
  if (parsedExpectedSlot === null) return output("INVALID_EXPECTED_SLOT");
  if (!(rawBytes instanceof Uint8Array)) return output("INVALID_RAW_BYTES");
  if (rawBytes.byteLength === 0) return output("EMPTY_RAW_BYTES");
  if (rawBytes.byteLength > limits.maxResponseBytes) {
    return output("RESPONSE_BYTE_LIMIT", {capSaturated: false});
  }

  let bytes;
  try {
    bytes = new Uint8Array(rawBytes);
  } catch {
    return output("INVALID_RAW_BYTES");
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  const base = {actualSha256};
  if (expectedSha256 !== undefined) {
    if (typeof expectedSha256 !== "string" || !/^[a-f\d]{64}$/i.test(expectedSha256)) {
      return output("INVALID_EXPECTED_DIGEST", base);
    }
    base.expectedSha256Matched = actualSha256 === expectedSha256.toLowerCase();
    if (!base.expectedSha256Matched) return output("DIGEST_MISMATCH", base);
  }
  if (bytes.byteLength > limits.maxWorkUnits) {
    return output("WORK_LIMIT", {...base, workUnits: bytes.byteLength});
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch {
    return output("INVALID_JSON", {...base, workUnits: bytes.byteLength});
  }
  let workUnits = bytes.byteLength;
  if (!isRecord(payload) || payload.jsonrpc !== "2.0" ||
      !Object.hasOwn(payload, "id") ||
      !(payload.id === null || typeof payload.id === "string" ||
        (typeof payload.id === "number" && Number.isSafeInteger(payload.id))) ||
      Object.hasOwn(payload, "error") || !isRecord(payload.result)) {
    return output(Object.hasOwn(payload ?? {}, "error") ? "RPC_ERROR" : "INVALID_RPC_ENVELOPE",
      {...base, workUnits});
  }

  const result = payload.result;
  if (!isPublicKey(result.mint) || parseSlot(result.slot) === null ||
      !["balance_desc", "balance_asc"].includes(result.sortBy) ||
      !Array.isArray(result.holders)) {
    return output("INVALID_RESULT_SCHEMA", {...base, workUnits});
  }
  const holderRowCount = result.holders.length;
  const capSaturated = holderRowCount >= limits.maxHolderRows;
  if (holderRowCount > limits.maxHolderRows) {
    return output("ROW_LIMIT", {
      ...base,
      responseMint: result.mint,
      responseSlot: String(result.slot),
      sortBy: result.sortBy,
      holderRowCount,
      capSaturated,
      workUnits
    });
  }
  if (result.mint !== expectedMint) {
    return output("MINT_MISMATCH", {
      ...base,
      responseMint: result.mint,
      responseSlot: String(result.slot),
      sortBy: result.sortBy,
      holderRowCount,
      capSaturated,
      workUnits,
      supplyComparison: {
        status: "NOT_CHECKED",
        reason: sameSlotMintSupply == null ? "NOT_SUPPLIED" : "RESPONSE_IDENTITY_MISMATCH"
      }
    });
  }
  const responseSlot = parseSlot(result.slot);
  if (responseSlot !== parsedExpectedSlot) {
    return output("SLOT_MISMATCH", {
      ...base,
      responseMint: result.mint,
      responseSlot: responseSlot.toString(),
      sortBy: result.sortBy,
      holderRowCount,
      capSaturated,
      workUnits,
      supplyComparison: {
        status: "NOT_CHECKED",
        reason: sameSlotMintSupply == null ? "NOT_SUPPLIED" : "RESPONSE_IDENTITY_MISMATCH"
      }
    });
  }

  const seen = new Map();
  const ownerTotals = new Map();
  let observedTotal = 0n;
  let duplicateRowCount = 0;
  for (const row of result.holders) {
    if (!isRecord(row) || !exactKeys(row, ["holder", "owner", "balanceRaw", "balanceUi"]) ||
        !isPublicKey(row.holder) || !isPublicKey(row.owner) ||
        !canonicalUiAmount(row.balanceUi)) {
      return output("INVALID_HOLDER_ROW", {
        ...base, responseMint: result.mint, responseSlot: responseSlot.toString(),
        sortBy: result.sortBy, holderRowCount, capSaturated, workUnits
      });
    }
    const amount = canonicalAmount(row.balanceRaw);
    if (amount === null) {
      return output("INVALID_BALANCE_RAW", {
        ...base, responseMint: result.mint, responseSlot: responseSlot.toString(),
        sortBy: result.sortBy, holderRowCount, capSaturated, workUnits
      });
    }
    workUnits += row.holder.length + row.owner.length +
      row.balanceRaw.length + row.balanceUi.length + 1;
    if (workUnits > limits.maxWorkUnits) {
      return output("WORK_LIMIT", {
        ...base, responseMint: result.mint, responseSlot: responseSlot.toString(),
        sortBy: result.sortBy, holderRowCount, capSaturated, workUnits
      });
    }
    const previous = seen.get(row.holder);
    if (previous) {
      if (previous.owner !== row.owner || previous.balanceRaw !== row.balanceRaw ||
          !Object.is(previous.balanceUi, row.balanceUi)) {
        return output("CONFLICTING_DUPLICATE", {
          ...base, responseMint: result.mint, responseSlot: responseSlot.toString(),
          sortBy: result.sortBy, holderRowCount, capSaturated, workUnits
        });
      }
      duplicateRowCount += 1;
      continue;
    }
    seen.set(row.holder, row);
    const ownerTotal = (ownerTotals.get(row.owner) ?? 0n) + amount;
    observedTotal += amount;
    if (ownerTotal > U64_MAX || observedTotal > U64_MAX) {
      return output("AMOUNT_OVERFLOW", {
        ...base, responseMint: result.mint, responseSlot: responseSlot.toString(),
        sortBy: result.sortBy, holderRowCount, capSaturated, workUnits
      });
    }
    ownerTotals.set(row.owner, ownerTotal);
  }

  const owners = [...ownerTotals].map(([owner, amount]) => ({
    owner,
    balanceRaw: amount.toString()
  })).sort((left, right) => {
    const a = BigInt(left.balanceRaw);
    const b = BigInt(right.balanceRaw);
    return a === b ? left.owner.localeCompare(right.owner) : a > b ? -1 : 1;
  });
  const supplyComparison = compareSupply(
    sameSlotMintSupply, result.mint, responseSlot, observedTotal
  );
  return output("CHECKS_MATCH_SOURCE_COMPLETENESS_UNKNOWN", {
    ...base,
    responseMint: result.mint,
    responseSlot: responseSlot.toString(),
    sortBy: result.sortBy,
    holderRowCount,
    uniqueTokenAccountCount: seen.size,
    duplicateRowCount,
    ownerCount: owners.length,
    observedBalanceRawTotal: observedTotal.toString(),
    owners,
    capSaturated,
    workUnits,
    supplyComparison
  });
}
