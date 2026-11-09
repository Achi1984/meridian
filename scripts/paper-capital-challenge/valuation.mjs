import {
  cents, integer, modeledExecution, record, validateUsdQuote, freezeDeep, normalizeBinding,
  identifier
} from "./account-contract.mjs";

const ACCOUNT_KEYS = ["cashCents", "inventorySatoshis", "unbookedAccruedFeesCents"];

export function validateUsdAccount(account) {
  record(account, ACCOUNT_KEYS, "ACCOUNT");
  integer(account.cashCents, "CASH");
  integer(account.unbookedAccruedFeesCents, "ACCRUED_FEES");
  if (typeof account.inventorySatoshis !== "string" ||
      !/^(?:0|[1-9]\d{0,15})$/.test(account.inventorySatoshis) ||
      BigInt(account.inventorySatoshis) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("INVALID_INVENTORY");
  }
  return { ...account };
}

export function createUsdObservation({ binding, account, quote, id, observedAtMs }) {
  identifier(id, "OBSERVATION_ID");
  const identity = normalizeBinding(binding);
  const balances = validateUsdAccount(account);
  const evidence = validateUsdQuote(quote, observedAtMs);
  const exit = modeledExecution(BigInt(balances.inventorySatoshis), evidence, "SELL");
  const net = BigInt(balances.cashCents) + BigInt(exit.notionalCents) -
    BigInt(balances.unbookedAccruedFeesCents) - BigInt(exit.feeCents);
  return freezeDeep({
    id, campaignId: identity.campaignId, currency: identity.currency,
    strategyVersion: identity.strategyVersion, observedAtMs,
    netEquityCents: cents(net, "NET_EQUITY"),
    valuation: {
      status: "FRESH", currency: "USD", monetaryUnit: "USD_CENTS",
      marketPair: "BTC/USD", method: "CASH_PLUS_EXECUTABLE_ADVERSE_BID",
      asOfMs: observedAtMs, bidQuoteAtMs: evidence.quotedAtMs,
      maxAgeMs: evidence.maxAgeMs, quoteSourceId: evidence.sourceId,
      cashCents: balances.cashCents,
      inventoryAtAdverseBidCents: exit.notionalCents,
      unbookedAccruedFeesCents: balances.unbookedAccruedFeesCents,
      modeledExitCostsCents: exit.feeCents
    }
  });
}
