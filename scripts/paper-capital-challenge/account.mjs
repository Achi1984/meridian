import { PAPER_CAPITAL_CHALLENGE_POLICY as POLICY } from "./policy.mjs";
import { advanceChallengeState, createChallengeState, getExposureGate } from "./guard.mjs";
import {
  USD_MODELED_COSTS, canonical, cents, decimalAtoms, freezeDeep, identifier,
  integer, modeledExecution, normalizeBinding, record, validateUsdQuote
} from "./account-contract.mjs";
import { createUsdObservation } from "./valuation.mjs";

const JOURNAL_SCHEMA = "USD_PAPER_ACCOUNT_EVENTS_V1";
const EVENT_KEYS = [
  "id", "campaignId", "currency", "strategyVersion", "costVersion", "observedAtMs",
  "action", "quote", "quantityBtc", "feeCents", "reason"
];
const ACTIONS = ["BUY", "SELL", "HOLD", "SKIP_ENTRY", "ACCRUE_FEE", "SETTLE_FEES"];

function normalizeEvent(input, binding) {
  record(input, EVENT_KEYS, "ACCOUNT_EVENT");
  identifier(input.id, "EVENT_ID");
  integer(input.observedAtMs, "EVENT_TIME");
  for (const key of Object.keys(binding)) {
    if (input[key] !== binding[key]) throw new Error(`${key.toUpperCase()}_MISMATCH`);
  }
  if (!ACTIONS.includes(input.action)) throw new Error("INVALID_ACTION");
  const trade = input.action === "BUY" || input.action === "SELL";
  if (trade) decimalAtoms(input.quantityBtc, "QUANTITY");
  else if (input.quantityBtc !== null) throw new Error("UNEXPECTED_QUANTITY");
  integer(input.feeCents, "EVENT_FEE");
  if (input.action === "ACCRUE_FEE" ? input.feeCents === 0 : input.feeCents !== 0) {
    throw new Error("INVALID_EVENT_FEE");
  }
  if (input.action === "SKIP_ENTRY") identifier(input.reason, "SKIP_REASON");
  else if (input.reason !== null) throw new Error("UNEXPECTED_REASON");
  return { ...input, quote: validateUsdQuote(input.quote, input.observedAtMs) };
}

export function createUsdAccountJournal(binding) {
  return freezeDeep({
    schemaVersion: JOURNAL_SCHEMA, binding: normalizeBinding(binding), events: []
  });
}

export function replayUsdAccount(journal) {
  record(journal, ["schemaVersion", "binding", "events"], "ACCOUNT_JOURNAL");
  if (journal.schemaVersion !== JOURNAL_SCHEMA) throw new Error("INVALID_ACCOUNT_SCHEMA");
  const binding = normalizeBinding(journal.binding);
  if (!Array.isArray(journal.events) || journal.events.length > POLICY.maxJournalObservations) {
    throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
  }
  let account = {
    cashCents: POLICY.initialCapitalCents, inventorySatoshis: "0", unbookedAccruedFeesCents: 0
  };
  let guardState = createChallengeState({ campaignId: binding.campaignId, currency: binding.currency });
  let openedAtMs = null;
  let exposureDurationMs = 0n;
  let previousAtMs = null;
  let previousQuote = null;
  let maxDrawdownCents = 0n;
  let turnoverCents = 0n;
  let modeledFeesCents = 0n;
  let additionalFeesCents = 0n;
  let slippageCents = 0n;
  let completedRoundTrips = 0;
  const entries = [];
  const seen = new Map();
  const quoteIds = new Map();
  const skippedEntryReasons = Object.create(null);
  for (const input of journal.events) {
    const event = normalizeEvent(input, binding);
    const duplicate = seen.get(event.id);
    if (duplicate) {
      if (canonical(duplicate) !== canonical(event)) throw new Error("CONTRADICTORY_DUPLICATE_EVENT");
      continue;
    }
    const quoteKey = JSON.stringify([event.quote.sourceId, event.quote.id]);
    const oldQuote = quoteIds.get(quoteKey);
    if (oldQuote && canonical(oldQuote) !== canonical(event.quote)) {
      throw new Error("CONTRADICTORY_DUPLICATE_QUOTE");
    }
    if (previousAtMs !== null && event.observedAtMs <= previousAtMs) {
      throw new Error("ACCOUNT_EVENT_OUT_OF_ORDER");
    }
    if (previousQuote && (event.quote.quotedAtMs < previousQuote.quotedAtMs ||
        event.quote.receivedAtMs < previousQuote.receivedAtMs)) {
      throw new Error("QUOTE_OUT_OF_ORDER");
    }
    if (openedAtMs !== null) exposureDurationMs += BigInt(event.observedAtMs - previousAtMs);
    let fill = null;
    let skipReason = event.action === "SKIP_ENTRY" ? event.reason : null;
    if (event.action === "BUY") {
      if (guardState.paused) skipReason = "DRAWDOWN_PAUSED";
      else if (account.inventorySatoshis !== "0") skipReason = "OPEN_INVENTORY";
      else {
        const quantity = decimalAtoms(event.quantityBtc, "QUANTITY");
        const execution = modeledExecution(quantity, event.quote, "BUY");
        const debit = BigInt(execution.notionalCents) + BigInt(execution.feeCents);
        if (execution.notionalCents > USD_MODELED_COSTS.maxEntryCents) {
          skipReason = "MAX_ENTRY_EXCEEDED";
        } else if (debit + BigInt(account.unbookedAccruedFeesCents) > BigInt(account.cashCents)) {
          skipReason = "INSUFFICIENT_UNENCUMBERED_CASH";
        } else {
          account = { ...account, cashCents: cents(BigInt(account.cashCents) - debit, "CASH"),
            inventorySatoshis: String(quantity) };
          openedAtMs = event.observedAtMs;
          fill = { side: "BUY", quantitySatoshis: String(quantity), ...execution };
        }
      }
    } else if (event.action === "SELL") {
      const quantity = decimalAtoms(event.quantityBtc, "QUANTITY");
      if (quantity > BigInt(account.inventorySatoshis)) throw new Error("EXIT_EXCEEDS_INVENTORY");
      const execution = modeledExecution(quantity, event.quote, "SELL");
      const cash = BigInt(account.cashCents) + BigInt(execution.notionalCents) -
        BigInt(execution.feeCents);
      if (cash < 0n) throw new Error("INSUFFICIENT_CASH_FOR_EXIT_FEE");
      account = { ...account, cashCents: cents(cash, "CASH"),
        inventorySatoshis: String(BigInt(account.inventorySatoshis) - quantity) };
      fill = { side: "SELL", quantitySatoshis: String(quantity), ...execution };
      if (account.inventorySatoshis === "0") {
        completedRoundTrips++;
        openedAtMs = null;
      }
    } else if (event.action === "ACCRUE_FEE") {
      account = { ...account, unbookedAccruedFeesCents: cents(
        BigInt(account.unbookedAccruedFeesCents) + BigInt(event.feeCents), "ACCRUED_FEES") };
      additionalFeesCents += BigInt(event.feeCents);
    } else if (event.action === "SETTLE_FEES") {
      const cash = BigInt(account.cashCents) - BigInt(account.unbookedAccruedFeesCents);
      if (cash < 0n) throw new Error("INSUFFICIENT_CASH_TO_SETTLE_FEES");
      account = { ...account, cashCents: cents(cash, "CASH"), unbookedAccruedFeesCents: 0 };
    }
    if (skipReason) skippedEntryReasons[skipReason] = (skippedEntryReasons[skipReason] ?? 0) + 1;
    if (fill) {
      turnoverCents += BigInt(fill.notionalCents);
      modeledFeesCents += BigInt(fill.feeCents);
      slippageCents += BigInt(fill.slippageCents);
      fill = { ...fill, eventId: event.id, quoteId: event.quote.id,
        sourceId: event.quote.sourceId, observedAtMs: event.observedAtMs,
        ...binding, provenance: USD_MODELED_COSTS.provenance, liquidity: "MODELED_TAKER" };
    }
    const observation = createUsdObservation({
      binding, account, quote: event.quote, id: event.id, observedAtMs: event.observedAtMs
    });
    guardState = advanceChallengeState(guardState, observation);
    const drawdown = BigInt(guardState.highWaterEquityCents) - BigInt(observation.netEquityCents);
    if (drawdown > maxDrawdownCents) maxDrawdownCents = drawdown;
    entries.push({ event, fill, skipReason, observation });
    seen.set(event.id, event);
    quoteIds.set(quoteKey, event.quote);
    previousAtMs = event.observedAtMs;
    previousQuote = event.quote;
  }
  const last = entries.at(-1)?.observation;
  const netEquityCents = last?.netEquityCents ?? POLICY.initialCapitalCents;
  return freezeDeep({
    schemaVersion: "USD_PAPER_ACCOUNT_REPLAY_V1", binding, costs: USD_MODELED_COSTS,
    account, guardState, entries,
    activity: {
      completedRoundTrips, exposureDurationMs: cents(exposureDurationMs, "EXPOSURE_DURATION"),
      openExposureSinceMs: openedAtMs, skippedEntryReasons,
      modeledFeesCents: cents(modeledFeesCents, "TOTAL_FEES"),
      additionalAccruedFeesCents: cents(additionalFeesCents, "TOTAL_ADDITIONAL_FEES"),
      turnoverCents: cents(turnoverCents, "TURNOVER"),
      modeledSlippageCents: cents(slippageCents, "TOTAL_SLIPPAGE"),
      modeledExitCostsCents: last?.valuation.modeledExitCostsCents ?? 0,
      maxDrawdownCents: cents(maxDrawdownCents, "MAX_DRAWDOWN"),
      netEquityCents, netPnlCents: cents(BigInt(netEquityCents) -
        BigInt(POLICY.initialCapitalCents), "NET_PNL"),
      activityCriterionMet: completedRoundTrips > 0,
      profitableCandidateEstablished: false
    },
    authorization: {
      executionAuthorized: false, liveAcquisitionAuthenticated: false,
      productionExposureGate: getExposureGate(guardState, previousAtMs ?? 0)
    }
  });
}

export function appendUsdAccountEventWithReplay(journal, input) {
  const previous = replayUsdAccount(journal);
  const event = normalizeEvent(input, previous.binding);
  const duplicate = previous.entries.find(entry => entry.event.id === event.id);
  if (duplicate) {
    if (canonical(duplicate.event) !== canonical(event)) throw new Error("CONTRADICTORY_DUPLICATE_EVENT");
    return {
      journal: freezeDeep({
        schemaVersion: JOURNAL_SCHEMA, binding: { ...previous.binding },
        events: previous.entries.map(entry => entry.event)
      }),
      replay: previous,
      duplicate: true
    };
  }
  const next = { schemaVersion: JOURNAL_SCHEMA, binding: { ...previous.binding },
    events: [...previous.entries.map(entry => entry.event), event] };
  return {
    journal: freezeDeep(next),
    replay: replayUsdAccount(next),
    duplicate: false
  };
}

export function appendUsdAccountEvent(journal, input) {
  return appendUsdAccountEventWithReplay(journal, input).journal;
}

export function createUsdPersistencePayload(journal) {
  const replay = replayUsdAccount(journal);
  return freezeDeep({
    schemaVersion: "USD_PAPER_ACCOUNT_PERSISTENCE_V1",
    binding: replay.binding, costs: replay.costs,
    transactions: replay.entries,
    guardObservations: replay.entries.map(entry => entry.observation),
    account: replay.account, guardState: replay.guardState,
    accountTransactionDurability: "NOT_IMPLEMENTED",
    executionAuthorized: false
  });
}
