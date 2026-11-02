export const MINT = "So11111111111111111111111111111111111111112";
export const AUTHORITY = "Vote111111111111111111111111111111111111111";
export const RECIPIENT = "Stake11111111111111111111111111111111111111";
export const TOKEN_ACCOUNT = "11111111111111111111111111111111";
export const OTHER_MINT = "SysvarRent111111111111111111111111111111111";
export const TXIDS = Object.freeze(["history-tx-120", "history-tx-110", "history-tx-100", "history-tx-90"]);

export const PAGE_ONE = Object.freeze([
  Object.freeze({signature: TXIDS[0], slot: 120, err: null}),
  Object.freeze({signature: TXIDS[1], slot: 110, err: null})
]);
export const PAGE_TWO = Object.freeze([
  Object.freeze({signature: TXIDS[2], slot: 100, err: null}),
  Object.freeze({signature: TXIDS[3], slot: 90, err: null})
]);

export function parsedInstruction(type, info, programId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
  return {programId, parsed: {type, info}};
}

export function parsedTransaction(slot, instructions, {version = "legacy", metaError = null} = {}) {
  return {
    slot,
    version,
    transaction: {message: {instructions}},
    meta: {err: metaError, innerInstructions: []}
  };
}

export function initialMintTransaction(slot = 120) {
  return parsedTransaction(slot, [
    parsedInstruction("initializeMint", {
      mint: MINT,
      mintAuthority: AUTHORITY,
      decimals: 6,
      freezeAuthority: null
    }),
    parsedInstruction("initializeAccount", {
      account: TOKEN_ACCOUNT,
      mint: MINT,
      owner: RECIPIENT
    }),
    parsedInstruction("mintTo", {
      mint: MINT,
      account: TOKEN_ACCOUNT,
      amount: "2500000",
      authority: AUTHORITY
    })
  ]);
}
