import assert from "node:assert/strict";
import {createHash} from "node:crypto";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));

export const RPC_URL = "https://api.mainnet-beta.solana.com";
export const TOKEN_PROGRAM_ID = TOKEN_PROGRAM;
export const NOW = Date.parse("2026-11-02T18:00:00Z");
export const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: encodeBase58(Buffer.alloc(32, 2)),
  pool: encodeBase58(Buffer.alloc(32, 3)),
  quote: encodeBase58(Buffer.alloc(32, 4))
});

const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = mod(-121665n * modPow(121666n, ED25519_P - 2n, ED25519_P), ED25519_P);
const ED25519_SQRT_MINUS_ONE = modPow(2n, (ED25519_P - 1n) / 4n, ED25519_P);

export function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}

function decodeBase58(value) {
  let decoded = 0n;
  for (const character of value) decoded = decoded * 58n + BigInt(BASE58_VALUES.get(character));
  const bytes = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  bytes.reverse();
  let zeroes = 0;
  while (value[zeroes] === "1") zeroes += 1;
  return Buffer.concat([Buffer.alloc(zeroes), Buffer.from(bytes)]);
}

function littleEndianInteger(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = value * 256n + BigInt(bytes[index]);
  }
  return value;
}

function mod(value, modulus) {
  const result = value % modulus;
  return result < 0n ? result + modulus : result;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let factor = mod(base, modulus);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = result * factor % modulus;
    factor = factor * factor % modulus;
    power >>= 1n;
  }
  return result;
}

function isEd25519Point(bytes) {
  const encoded = Buffer.from(bytes);
  const sign = encoded[31] >>> 7;
  encoded[31] &= 0x7f;
  const y = littleEndianInteger(encoded);
  if (y >= ED25519_P) return false;
  const ySquared = y * y % ED25519_P;
  const numerator = mod(ySquared - 1n, ED25519_P);
  const denominator = mod(ED25519_D * ySquared + 1n, ED25519_P);
  if (denominator === 0n) return false;
  const xSquared = numerator * modPow(denominator, ED25519_P - 2n, ED25519_P) % ED25519_P;
  let x = modPow(xSquared, (ED25519_P + 3n) / 8n, ED25519_P);
  if (x * x % ED25519_P !== xSquared) x = x * ED25519_SQRT_MINUS_ONE % ED25519_P;
  return x * x % ED25519_P === xSquared && (x !== 0n || sign === 0);
}

function derivePda(seeds, programId) {
  const program = decodeBase58(programId);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const bytes = createHash("sha256")
      .update(Buffer.concat([...seeds, Buffer.from([bump]), program,
        Buffer.from("ProgramDerivedAddress")]))
      .digest();
    if (!isEd25519Point(bytes)) return encodeBase58(bytes);
  }
  throw new Error("could not create fixture PDA");
}

export const LP_MINT = derivePda([
  Buffer.from("pool_lp_mint"),
  decodeBase58(IDENTITY.pool)
], CPMM_PROGRAM);
export const PDA_AUTHORITY = derivePda([
  Buffer.from("vault_and_lp_mint_auth_seed")
], CPMM_PROGRAM);
export const WALLET_AUTHORITY = "11111111111111111111111111111111";

export function poolProof({
  identity = IDENTITY,
  supplyAtoms = "1000",
  poolSupplyAtoms = "1100",
  slot = 1_000,
  observedAt = NOW
} = {}) {
  const responseSha256 = "a".repeat(64);
  return {
    status: "DECODED_UNVERIFIED",
    sourceVersion: "raydium-cp-swap@3d69122790e97cd6aff24e8ba95940793773f58c",
    decoderVersion: "raydium-cpmm-pool-v1",
    sourceAuthentication: "NOT_ESTABLISHED",
    identity,
    observedAt,
    slot,
    pool: {
      address: identity.pool,
      programId: CPMM_PROGRAM,
      token0: {mint: identity.mint, programId: TOKEN_PROGRAM, decimals: 6, vault: {}},
      token1: {mint: identity.quote, programId: TOKEN_PROGRAM, decimals: 9, vault: {}},
      lpSupplyAtoms: poolSupplyAtoms,
      lpSupplyMeaning: "PoolState counter only; not evidence of LP burn, lock, or holder distribution",
      poolStateSha256: "b".repeat(64),
      responseSha256,
      lpMintDecimals: 9,
      lpMint: {
        address: LP_MINT,
        tokenProgram: TOKEN_PROGRAM,
        decimals: 9,
        supplyAtoms,
        mintAuthority: PDA_AUTHORITY
      }
    },
    poolExclusionEvidence: {
      status: "DECODED_UNVERIFIED",
      source: "Solana JSON-RPC getMultipleAccounts",
      identity,
      observedAt,
      slot,
      sourceVersion: "raydium-cp-swap@3d69122790e97cd6aff24e8ba95940793773f58c",
      decoderVersion: "raydium-cpmm-pool-v1",
      responseSha256,
      verified: false
    },
    lpProtection: {status: "UNKNOWN"}
  };
}

export function tokenAccount({
  address = encodeBase58(Buffer.alloc(32, 8)),
  mint = LP_MINT,
  authority = WALLET_AUTHORITY,
  amountAtoms = "1000",
  state = 1,
  owner = TOKEN_PROGRAM
} = {}) {
  const bytes = Buffer.alloc(165);
  decodeBase58(mint).copy(bytes, 0);
  decodeBase58(authority).copy(bytes, 32);
  bytes.writeBigUInt64LE(BigInt(amountAtoms), 64);
  bytes[108] = state;
  return {
    pubkey: address,
    account: {
      owner,
      executable: false,
      lamports: 2_039_280,
      data: [bytes.toString("base64"), "base64"]
    }
  };
}

export function rpcResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"content-type": "application/json"}
  });
}

export function transportFor({
  proof = poolProof(),
  supplyAtoms = proof.pool.lpMint.supplyAtoms,
  supplySlot = proof.slot,
  accountSlot = proof.slot,
  accounts = [],
  status = 200
} = {}) {
  const requests = [];
  const responseBodies = [];
  const transport = async (request, options) => {
    requests.push({request, options});
    if (request.url !== RPC_URL || request.method !== "POST" ||
        request.redirect !== "error" || request.credentials !== "omit" ||
        options.redirect !== "error" || options.credentials !== "omit") {
      throw new Error("unexpected request policy");
    }
    const body = JSON.parse(request.body);
    if (body.method === "getTokenSupply") {
      const payload = {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          context: {slot: supplySlot},
          value: {amount: supplyAtoms, decimals: 9}
        }
      };
      responseBodies.push(JSON.stringify(payload));
      return rpcResponse(payload, status);
    }
    if (body.method === "getProgramAccounts") {
      assert.deepEqual(body.params[1].filters, [{memcmp: {offset: 0, bytes: proof.pool.lpMint.address}}]);
      assert.equal(body.params[1].commitment, "finalized");
      assert.equal(body.params[1].withContext, true);
      assert.equal(body.params[1].minContextSlot, proof.slot);
      const payload = {
        jsonrpc: "2.0",
        id: body.id,
        result: {context: {slot: accountSlot}, value: accounts}
      };
      responseBodies.push(JSON.stringify(payload));
      return rpcResponse(payload, status);
    }
    throw new Error("unsupported request method");
  };
  return {transport, requests, responseBodies};
}

export function finalizedBurnEvidence({
  amountAtoms = "1000",
  denominatorAtoms = "1000",
  mint = LP_MINT,
  instructionMint = mint,
  instructionProgramId = TOKEN_PROGRAM,
  pool = IDENTITY.pool,
  slot = 1_000,
  signature = encodeBase58(Buffer.alloc(64, 2)),
  transactionSignatures = [signature],
  holdUntil = NOW + 60_000,
  includesCpmmInstruction = false,
  transactionError = null,
  innerInstructions = []
} = {}) {
  const instructions = [{
    programId: instructionProgramId,
    program: "spl-token",
    parsed: {
      type: "burnChecked",
      info: {
        account: encodeBase58(Buffer.alloc(32, 8)),
        mint: instructionMint,
        authority: WALLET_AUTHORITY,
        amount: amountAtoms,
        decimals: 9
      }
    }
  }];
  if (includesCpmmInstruction) {
    instructions.push({programId: CPMM_PROGRAM, program: "raydium_cpmm", parsed: {type: "withdraw"}});
  }
  const responseJson = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      slot,
      transaction: {
        signatures: transactionSignatures,
        message: {accountKeys: [], instructions}
      },
      meta: {
        err: transactionError,
        innerInstructions
      }
    }
  });
  return {
    source: "Solana JSON-RPC getTransaction",
    commitment: "finalized",
    pool,
    lpMint: mint,
    claimedBurnAtoms: amountAtoms,
    denominatorAtoms,
    holdUntil,
    signature,
    slot,
    responseJson,
    responseSha256: createHash("sha256").update(responseJson).digest("hex")
  };
}
