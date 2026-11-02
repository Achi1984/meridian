export const RAYDIUM_CPMM_LAYOUT = Object.freeze({
  programId: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  sourceCommit: "ec3b20ddf74d4f3c69f6ac475fde85755a57b0e6",
  idlCommit: "e7e0c96fe77bcf6a020b84a44c47a722aac8e359",
  instructions: Object.freeze({
    swapBaseInput: Object.freeze([143, 190, 90, 218, 196, 30, 51, 222]),
    swapBaseOutput: Object.freeze([55, 217, 98, 86, 163, 74, 180, 173]),
    deposit: Object.freeze([242, 35, 198, 137, 82, 225, 242, 182]),
    withdraw: Object.freeze([183, 18, 70, 156, 148, 109, 161, 34])
  }),
  events: Object.freeze({
    swap: Object.freeze([64, 198, 205, 232, 38, 8, 113, 226]),
    lpChange: Object.freeze([121, 163, 205, 201, 57, 218, 117, 60])
  })
});

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const TOKEN_AMOUNT = /^(0|[1-9]\d{0,39})$/;

function excluded(reason, details = {}) {
  return Object.freeze({status: "EXCLUDED", reason, ...details});
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeBase58(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) return null;
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) return null;
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === "1") zeroes += 1;
  const decoded = new Uint8Array(zeroes + bytes.length);
  decoded.set(bytes, zeroes);
  return decoded;
}

function encodeBase58(bytes) {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}

function validPublicKey(value) {
  return decodeBase58(value)?.length === 32;
}

function bytesMatch(bytes, expected) {
  return bytes.length >= expected.length &&
    expected.every((value, index) => bytes[index] === value);
}

function uint64(bytes, offset) {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  return value;
}

function accountKey(value) {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.pubkey === "string") return value.pubkey;
  return null;
}

function accountKeysFor(transaction) {
  const message = transaction?.message;
  const staticKeys = message?.staticAccountKeys ?? message?.accountKeys;
  if (!Array.isArray(staticKeys)) return null;
  const keys = staticKeys.map(accountKey);
  const loaded = transaction?.meta?.loadedAddresses;
  if (loaded !== undefined) {
    if (!isRecord(loaded) || !Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly)) {
      return null;
    }
    keys.push(...loaded.writable.map(accountKey), ...loaded.readonly.map(accountKey));
  }
  return keys.every(validPublicKey) ? keys : null;
}

function resolveIndex(value, keys) {
  if (Number.isSafeInteger(value) && value >= 0 && value < keys.length) return value;
  if (typeof value === "string") {
    const index = keys.indexOf(value);
    return index < 0 ? null : index;
  }
  return null;
}

function instructionRows(transaction) {
  const message = transaction?.message;
  const outer = message?.compiledInstructions ?? message?.instructions;
  if (!Array.isArray(outer)) return null;
  const rows = outer.map((instruction, index) => ({instruction, index, inner: false}));
  const innerGroups = transaction?.meta?.innerInstructions ?? [];
  if (!Array.isArray(innerGroups)) return null;
  for (const group of innerGroups) {
    if (!isRecord(group) || !Number.isSafeInteger(group.index) ||
        !Array.isArray(group.instructions)) return null;
    for (const instruction of group.instructions) {
      rows.push({instruction, index: group.index, inner: true});
    }
  }
  return rows;
}

function instructionData(instruction) {
  if (typeof instruction?.data !== "string" || instruction.data.length > 4096) return null;
  return decodeBase58(instruction.data);
}

function instructionProgram(instruction, keys) {
  if (typeof instruction?.programId === "string") return instruction.programId;
  if (!Number.isSafeInteger(instruction?.programIdIndex)) return null;
  return keys[instruction.programIdIndex] ?? null;
}

function instructionAccounts(instruction, keys) {
  if (!Array.isArray(instruction?.accounts) || instruction.accounts.length > 128) return null;
  const indexes = instruction.accounts.map(value => resolveIndex(value, keys));
  return indexes.every(Number.isSafeInteger) ? indexes : null;
}

function readSwapEvent(logMessages) {
  if (!Array.isArray(logMessages) || logMessages.length > 100_000) return null;
  const stack = [];
  const events = [];
  let lpChangeFound = false;
  for (const line of logMessages) {
    if (typeof line !== "string" || line.length > 16_384) return null;
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    const finish = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:success|failed:.*)$/.exec(line);
    if (finish) {
      if (stack.at(-1) !== finish[1]) return null;
      stack.pop();
      continue;
    }
    const dataMatch = /^Program data: ([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (!dataMatch || stack.at(-1) !== RAYDIUM_CPMM_LAYOUT.programId) continue;
    const bytes = Buffer.from(dataMatch[1], "base64");
    if (bytes.toString("base64") !== dataMatch[1]) return null;
    if (bytesMatch(bytes, RAYDIUM_CPMM_LAYOUT.events.lpChange)) {
      lpChangeFound = true;
      continue;
    }
    if (!bytesMatch(bytes, RAYDIUM_CPMM_LAYOUT.events.swap)) continue;
    if (bytes.length !== 170 || (bytes[88] !== 0 && bytes[88] !== 1) ||
        (bytes[169] !== 0 && bytes[169] !== 1)) return null;
    events.push({
      pool: encodeBase58(bytes.subarray(8, 40)),
      inputVaultBefore: uint64(bytes, 40),
      outputVaultBefore: uint64(bytes, 48),
      inputAmount: uint64(bytes, 56),
      outputAmount: uint64(bytes, 64),
      inputTransferFee: uint64(bytes, 72),
      outputTransferFee: uint64(bytes, 80),
      baseInput: bytes[88] === 1,
      inputMint: encodeBase58(bytes.subarray(89, 121)),
      outputMint: encodeBase58(bytes.subarray(121, 153)),
      tradeFee: uint64(bytes, 153),
      creatorFee: uint64(bytes, 161),
      creatorFeeOnInput: bytes[169] === 1
    });
  }
  return {events, lpChangeFound, balancedLog: stack.length === 0};
}

function tokenBalanceMap(rows, keys) {
  if (!Array.isArray(rows) || rows.length > 100_000) return null;
  const result = new Map();
  for (const row of rows) {
    if (!isRecord(row) || !Number.isSafeInteger(row.accountIndex) ||
        row.accountIndex < 0 || row.accountIndex >= keys.length ||
        !validPublicKey(row.mint) || !validPublicKey(row.owner) ||
        !TOKEN_AMOUNT.test(row.uiTokenAmount?.amount ?? "") ||
        !Number.isInteger(row.uiTokenAmount?.decimals) ||
        row.uiTokenAmount.decimals < 0 || row.uiTokenAmount.decimals > 18 ||
        result.has(row.accountIndex)) return null;
    result.set(row.accountIndex, {
      account: keys[row.accountIndex],
      mint: row.mint,
      owner: row.owner,
      amount: BigInt(row.uiTokenAmount.amount),
      decimals: row.uiTokenAmount.decimals
    });
  }
  return result;
}

function balanceDelta(pre, post, index, mint) {
  const before = pre.get(index);
  const after = post.get(index);
  if (!before || !after || before.account !== after.account || before.mint !== mint ||
      after.mint !== mint || before.owner !== after.owner ||
      before.decimals !== after.decimals) return null;
  return {before, after, delta: after.amount - before.amount};
}

function decodeInstructionArguments(bytes, expectedLength) {
  if (!bytes || bytes.length !== expectedLength) return null;
  return {
    amount: uint64(bytes, 8),
    limit: uint64(bytes, 16)
  };
}

function validProof(poolProof, identity) {
  return isRecord(poolProof) && poolProof.status === "SOURCE_BOUND" &&
    poolProof.verified === true && poolProof.chainId === "solana" &&
    poolProof.pool === identity.pool && poolProof.baseMint === identity.mint &&
    poolProof.quoteMint === identity.quote && validPublicKey(poolProof.baseVault) &&
    validPublicKey(poolProof.quoteVault) && poolProof.baseVault !== poolProof.quoteVault &&
    Number.isInteger(poolProof.baseDecimals) && poolProof.baseDecimals >= 0 &&
    poolProof.baseDecimals <= 18 && Number.isInteger(poolProof.quoteDecimals) &&
    poolProof.quoteDecimals >= 0 && poolProof.quoteDecimals <= 18 &&
    Number.isSafeInteger(poolProof.slot) && poolProof.slot >= 0 &&
    typeof poolProof.source === "string" && poolProof.source.length > 0 &&
    typeof poolProof.receipt?.id === "string" && poolProof.receipt.id.length > 0 &&
    /^[a-f0-9]{64}$/i.test(poolProof.receipt.payloadSha256 ?? "");
}

function transactionTimestamp(row) {
  if (!Number.isSafeInteger(row?.blockTime) || row.blockTime <= 0 ||
      row.blockTime > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) return null;
  const timestamp = row.blockTime * 1000;
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function validSignature(signature) {
  return typeof signature === "string" && decodeBase58(signature)?.length === 64;
}

function nonnegativeBalance(account, index) {
  return account?.get(index) ?? null;
}

export function decodeCpmmSuccessfulSwap(row, {identity, poolProof} = {}) {
  if (!identity || identity.chainId !== "solana" || !validPublicKey(identity.mint) ||
      !validPublicKey(identity.pool) || !validPublicKey(identity.quote)) {
    return excluded("CANDIDATE_IDENTITY_INVALID");
  }
  if (!validProof(poolProof, identity)) return excluded("POOL_PROOF_UNBOUND_OR_INCOMPLETE");
  const transaction = row?.transaction;
  const meta = row?.meta;
  if (!isRecord(transaction) || !isRecord(meta) || meta.err !== null) {
    return excluded(!isRecord(meta) ? "TRANSACTION_UNAVAILABLE"
      : meta.err === null ? "TRANSACTION_UNAVAILABLE" : "TRANSACTION_FAILED");
  }
  if (!validSignature(row.signature) || !Number.isSafeInteger(row.slot) || row.slot < 0 ||
      row.slot > Number.MAX_SAFE_INTEGER || transactionTimestamp(row) === null) {
    return excluded("TRANSACTION_RECEIPT_INVALID");
  }
  const keys = accountKeysFor({...transaction, meta});
  const rows = instructionRows({...transaction, meta});
  if (!keys || !rows) return excluded("TRANSACTION_LAYOUT_UNAVAILABLE");

  const cpmmInstructions = [];
  let lpOperation = false;
  for (const entry of rows) {
    const program = instructionProgram(entry.instruction, keys);
    if (program !== RAYDIUM_CPMM_LAYOUT.programId) continue;
    const data = instructionData(entry.instruction);
    const accounts = instructionAccounts(entry.instruction, keys);
    if (!data || !accounts) return excluded("CPMM_INSTRUCTION_UNDECODABLE");
    if (bytesMatch(data, RAYDIUM_CPMM_LAYOUT.instructions.deposit) ||
        bytesMatch(data, RAYDIUM_CPMM_LAYOUT.instructions.withdraw)) {
      if (accounts.some(index => keys[index] === identity.pool)) lpOperation = true;
      continue;
    }
    if (bytesMatch(data, RAYDIUM_CPMM_LAYOUT.instructions.swapBaseInput) ||
        bytesMatch(data, RAYDIUM_CPMM_LAYOUT.instructions.swapBaseOutput)) {
      cpmmInstructions.push({...entry, data, accounts});
    }
  }
  if (cpmmInstructions.some(entry => entry.inner)) {
    return excluded("ROUTED_INSTRUCTION_AMBIGUOUS");
  }
  if (cpmmInstructions.length > 1) return excluded("MULTIPLE_CPMM_SWAPS_AMBIGUOUS");
  if (cpmmInstructions.length === 0) {
    if (lpOperation) return excluded("LP_OPERATION");
    return excluded("TRANSFER_OR_NON_SWAP");
  }
  const selected = cpmmInstructions[0];
  if (rows.some(entry => !entry.inner && entry.instruction !== selected.instruction &&
      instructionProgram(entry.instruction, keys) !== COMPUTE_BUDGET_PROGRAM)) {
    return excluded("ROUTED_INSTRUCTION_AMBIGUOUS");
  }
  if (selected.accounts.length !== 13) return excluded("CPMM_ACCOUNT_LAYOUT_MISMATCH");
  const [
    , , , poolIndex, inputAccountIndex, outputAccountIndex, inputVaultIndex, outputVaultIndex,
    , , inputMintIndex, outputMintIndex
  ] = selected.accounts;
  const accountAt = index => keys[index];
  if (accountAt(poolIndex) !== identity.pool ||
      accountAt(inputAccountIndex) === poolProof.baseVault ||
      accountAt(inputAccountIndex) === poolProof.quoteVault ||
      accountAt(outputAccountIndex) === poolProof.baseVault ||
      accountAt(outputAccountIndex) === poolProof.quoteVault) {
    return excluded("SWAP_POOL_OR_USER_ACCOUNT_MISMATCH");
  }
  const inputMint = accountAt(inputMintIndex);
  const outputMint = accountAt(outputMintIndex);
  const inputVault = accountAt(inputVaultIndex);
  const outputVault = accountAt(outputVaultIndex);
  if (!((inputMint === identity.mint && inputVault === poolProof.baseVault &&
         outputMint === identity.quote && outputVault === poolProof.quoteVault) ||
        (inputMint === identity.quote && inputVault === poolProof.quoteVault &&
         outputMint === identity.mint && outputVault === poolProof.baseVault))) {
    return excluded("SWAP_MINT_OR_VAULT_MISMATCH");
  }
  const eventResult = readSwapEvent(meta.logMessages);
  if (!eventResult?.balancedLog) return excluded("SWAP_EVENT_LOG_INVALID");
  if (eventResult.events.length !== 1) {
    return excluded(eventResult.lpChangeFound ? "LP_OPERATION" : "SWAP_EVENT_MISSING_OR_AMBIGUOUS");
  }
  const event = eventResult.events[0];
  if (event.pool !== identity.pool || event.inputMint !== inputMint ||
      event.outputMint !== outputMint) return excluded("SWAP_EVENT_IDENTITY_MISMATCH");

  const baseInput = bytesMatch(selected.data, RAYDIUM_CPMM_LAYOUT.instructions.swapBaseInput);
  if (event.baseInput !== baseInput) return excluded("SWAP_EVENT_INSTRUCTION_MISMATCH");
  const args = decodeInstructionArguments(selected.data, 24);
  if (!args) return excluded("SWAP_INSTRUCTION_ARGUMENTS_INVALID");
  const grossInput = event.inputAmount + event.inputTransferFee;
  const netOutput = event.outputAmount - event.outputTransferFee;
  if (netOutput <= 0n ||
      (baseInput && (args.amount !== grossInput || args.limit > netOutput)) ||
      (!baseInput && (grossInput > args.amount || args.limit !== netOutput))) {
    return excluded("SWAP_EVENT_AMOUNT_MISMATCH");
  }
  const pre = tokenBalanceMap(meta.preTokenBalances, keys);
  const post = tokenBalanceMap(meta.postTokenBalances, keys);
  if (!pre || !post) return excluded("TOKEN_BALANCE_LAYOUT_INCOMPLETE");
  const inputUser = balanceDelta(pre, post, inputAccountIndex, inputMint);
  const outputUser = balanceDelta(pre, post, outputAccountIndex, outputMint);
  const inputPool = balanceDelta(pre, post, inputVaultIndex, inputMint);
  const outputPool = balanceDelta(pre, post, outputVaultIndex, outputMint);
  if (!inputUser || !outputUser || !inputPool || !outputPool ||
      inputUser.before.owner !== outputUser.before.owner ||
      inputUser.delta !== -grossInput || outputUser.delta !== netOutput ||
      inputPool.delta <= 0n || outputPool.delta >= 0n) {
    return excluded("USER_OR_VAULT_BALANCE_DELTA_MISMATCH");
  }
  const trader = inputUser.before.owner;
  const isBuy = inputMint === identity.quote && outputMint === identity.mint;
  const expectedDecimals = isBuy ? poolProof.quoteDecimals : poolProof.baseDecimals;
  const outputDecimals = isBuy ? poolProof.baseDecimals : poolProof.quoteDecimals;
  if (inputUser.before.decimals !== expectedDecimals ||
      outputUser.before.decimals !== outputDecimals) {
    return excluded("USER_TOKEN_DECIMALS_MISMATCH");
  }
  const timestamp = transactionTimestamp(row);
  return Object.freeze({
    status: "DECODED",
    kind: "RAYDIUM_CPMM_SWAP",
    programId: RAYDIUM_CPMM_LAYOUT.programId,
    layout: "raydium-cpmm-anchor-v0.2.0",
    signature: row.signature,
    slot: row.slot,
    instructionIndex: selected.index,
    observedAt: timestamp,
    pool: identity.pool,
    mint: identity.mint,
    quote: identity.quote,
    inputMint,
    outputMint,
    direction: isBuy ? "BUY" : "SELL",
    trader,
    buyer: isBuy ? trader : null,
    inputAmountRaw: grossInput.toString(),
    outputAmountRaw: netOutput.toString(),
    inputAmountDecimals: inputUser.before.decimals,
    outputAmountDecimals: outputUser.before.decimals,
    eventAmounts: Object.freeze({
      inputAmountRaw: event.inputAmount.toString(),
      inputTransferFeeRaw: event.inputTransferFee.toString(),
      outputAmountRaw: event.outputAmount.toString(),
      outputTransferFeeRaw: event.outputTransferFee.toString()
    })
  });
}
