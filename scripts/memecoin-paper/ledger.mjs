const INITIAL_CAPITAL_CENTS = 100_000n;
const MAX_ENTRY_CENTS = 8_000n;
const MAX_POSITIONS = 3;
const DAY_LOSS_BPS = 300n;
const BPS = 10_000n;
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000;
const VIENNA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function asBigInt(value, label, {positive = false} = {}) {
  let result;
  if (typeof value === "bigint") result = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) result = BigInt(value);
  else if (typeof value === "string" && /^\d+$/.test(value)) result = BigInt(value);
  else throw new TypeError(`${label} must be an integer`);
  if (result < 0n || (positive && result === 0n)) throw new RangeError(`${label} is outside allowed range`);
  return result;
}

function time(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyCents(value, label) {
  return asBigInt(value, label);
}

function decimalScale(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError("token decimals must be an integer from 0 to 18");
  }
  return 10n ** BigInt(decimals);
}

function sumCosts(costs, label) {
  if (!costs || typeof costs !== "object") throw new TypeError(`${label} cost breakdown is required`);
  const keys = ["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"];
  const values = {};
  for (const key of keys) values[key] = moneyCents(costs[key], `${label}.${key}`);
  return {values, total: Object.values(values).reduce((sum, value) => sum + value, 0n)};
}

function quoteIdentityValid(quote, identity) {
  return quote && quote.mint === identity.mint && quote.chainId === identity.chainId &&
    quote.pool === identity.pool && quote.quote === identity.quote &&
    typeof quote.source === "string" && quote.source.trim().length > 0;
}

function digest(fields) {
  return JSON.stringify(fields, (_key, value) => typeof value === "bigint" ? value.toString() : value);
}

function exitPayloadDigest(eventId, quote) {
  return digest({
    eventId,
    mint: quote?.mint,
    chainId: quote?.chainId,
    pool: quote?.pool,
    quote: quote?.quote,
    observedAt: quote?.observedAt,
    priceMicros: quote?.priceMicros,
    costs: quote?.costs,
    mode: quote?.mode,
    executable: quote?.executable
  });
}

function viennaDay(value) {
  const parsed = time(value);
  if (parsed === null) return null;
  const parts = VIENNA_DAY.formatToParts(new Date(parsed));
  const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function computeMark(position, mark, now) {
  if (!quoteIdentityValid(mark, position) || !Number.isSafeInteger(mark.priceMicros) ||
      mark.priceMicros <= 0 || !Number.isSafeInteger(time(mark.observedAt)) ||
      now - time(mark.observedAt) < 0 || now - time(mark.observedAt) > MAX_QUOTE_AGE_MS) {
    return {status: "VALUATION_UNAVAILABLE", reason: "mark is missing, stale, future-dated, or identity-mismatched"};
  }
  let costs;
  try {
    costs = sumCosts(mark.costs, "exit").total;
  } catch {
    return {status: "VALUATION_UNAVAILABLE", reason: "complete exit-cost assumptions are required"};
  }
  const grossCents = position.tokenAtoms * BigInt(mark.priceMicros) /
    (position.scale * 10_000n);
  if (costs > grossCents) {
    return {status: "VALUATION_UNAVAILABLE", reason: "exit costs exceed marked proceeds"};
  }
  return {
    status: "PASS",
    grossCents,
    exitCostsCents: costs,
    netProceedsCents: grossCents - costs,
    observedAt: mark.observedAt,
    priceMicros: BigInt(mark.priceMicros)
  };
}

export class PaperLedger {
  constructor({initialCapitalCents = INITIAL_CAPITAL_CENTS, now = Date.now(), runId = "synthetic-only"} = {}) {
    this.initialCapitalCents = moneyCents(initialCapitalCents, "initialCapitalCents");
    if (this.initialCapitalCents !== INITIAL_CAPITAL_CENTS) {
      throw new RangeError("this prototype is fixed to USD 1,000 initial virtual capital");
    }
    this.cashCents = this.initialCapitalCents;
    this.realizedGrossPnlCents = 0n;
    this.realizedPnlCents = 0n;
    this.positions = new Map();
    this.reservations = new Map();
    this.authorizationDigests = new Map();
    this.eventDigests = new Map();
    this.results = new Map();
    this.entriesByTickMint = new Set();
    this.events = [];
    this.costTotals = {
      entry: {feeCents: 0n, spreadCents: 0n, slippageCents: 0n, priceImpactCents: 0n, networkCents: 0n},
      exit: {feeCents: 0n, spreadCents: 0n, slippageCents: 0n, priceImpactCents: 0n, networkCents: 0n}
    };
    this.day = viennaDay(now);
    if (!this.day) throw new TypeError("valid initialization time is required");
    this.dailyOpeningEquityCents = this.initialCapitalCents;
    this.dailyLossTripped = false;
    this.runId = String(runId);
    this.newWorkAllowed = true;
  }

  static restartDisposition() {
    return {
      status: "UNRECOVERABLE_FAIL_CLOSED",
      entriesAllowed: false,
      reason: "No durable journal or atomic restart recovery is implemented; do not resume an interrupted run."
    };
  }

  #record(event) {
    if (this.events.length >= 10_000) {
      this.newWorkAllowed = false;
      return false;
    }
    this.events.push(Object.freeze(event));
    return true;
  }

  #snapshotEquity({now, marks}) {
    const parsedNow = time(now);
    if (parsedNow === null || !Array.isArray(marks)) {
      return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: "timestamp and complete marks are required"};
    }
    const marksByMint = new Map(marks.map(mark => [mark?.mint, mark]));
    if (marksByMint.size !== marks.length) {
      return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: "duplicate marks are ambiguous"};
    }
    let equity = this.cashCents;
    let grossOpenValueCents = 0n;
    let estimatedExitCostsCents = 0n;
    let grossUnrealizedPnlCents = 0n;
    let netUnrealizedPnlCents = 0n;
    for (const [mint, position] of this.positions) {
      const mark = marksByMint.get(mint);
      if (!mark) return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: `missing mark for ${mint}`};
      const valuation = computeMark(position, mark, parsedNow);
      if (valuation.status !== "PASS") {
        return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: valuation.reason};
      }
      equity += valuation.netProceedsCents;
      grossOpenValueCents += valuation.grossCents;
      estimatedExitCostsCents += valuation.exitCostsCents;
      grossUnrealizedPnlCents += valuation.grossCents - position.entryNotionalCents;
      netUnrealizedPnlCents += valuation.netProceedsCents - position.entryCostCents;
    }
    return {
      status: "PASS",
      equityCents: equity,
      cashCents: this.cashCents,
      grossOpenValueCents,
      estimatedExitCostsCents,
      grossUnrealizedPnlCents,
      netUnrealizedPnlCents,
      marksByMint
    };
  }

  #updateDailyGate({now, marks = []}) {
    const parsedNow = time(now);
    const localDay = viennaDay(parsedNow);
    if (parsedNow === null || localDay === null) {
      return {status: "EQUITY_UNKNOWN", entriesAllowed: false, reason: "valid current time required"};
    }
    const snapshot = this.#snapshotEquity({now: parsedNow, marks});
    if (snapshot.status !== "PASS") {
      return {status: "EQUITY_UNKNOWN", entriesAllowed: false, equityCents: null, reason: snapshot.reason};
    }
    this.lastEquitySnapshot = snapshot;
    if (localDay !== this.day) {
      this.day = localDay;
      this.dailyOpeningEquityCents = snapshot.equityCents;
      this.dailyLossTripped = false;
      this.#record({type: "LOCAL_DAY_OPEN", day: localDay, openingEquityCents: snapshot.equityCents.toString()});
    }
    const loss = this.dailyOpeningEquityCents - snapshot.equityCents;
    const threshold = this.dailyOpeningEquityCents * DAY_LOSS_BPS / BPS;
    if (loss >= threshold) this.dailyLossTripped = true;
    return {
      status: this.dailyLossTripped ? "DAILY_LOSS_LIMIT" : "PASS",
      entriesAllowed: !this.dailyLossTripped && this.newWorkAllowed,
      equityCents: snapshot.equityCents,
      dailyOpeningEquityCents: this.dailyOpeningEquityCents,
      lossCents: loss > 0n ? loss : 0n,
      limitCents: threshold,
      marksByMint: snapshot.marksByMint
    };
  }

  authorizeEntry({
    authorizationId,
    candidate,
    filterResult,
    scoreResult,
    tickId,
    now,
    marks = []
  }) {
    const request = {
      authorizationId,
      mint: candidate?.mint,
      chainId: candidate?.chainId,
      pool: candidate?.pool,
      quote: candidate?.quote,
      decimals: candidate?.decimals,
      tickId,
      sampledAt: candidate?.sampledAt
    };
    const requestDigest = digest(request);
    if (typeof authorizationId !== "string" || !authorizationId ||
        typeof candidate?.mint !== "string" || typeof tickId !== "string" || !tickId) {
      return {status: "REJECT", reason: "authorization, candidate, and tick identities are required"};
    }
    if (this.authorizationDigests.has(authorizationId)) {
      if (this.authorizationDigests.get(authorizationId) !== requestDigest) {
        return {status: "REJECT", reason: "authorization identity reused with different request"};
      }
      return this.reservations.get(authorizationId) ?? this.results.get(authorizationId) ??
        {status: "DUPLICATE", reason: "authorization already consumed"};
    }
    if (!this.newWorkAllowed) return {status: "REJECT", reason: "session is stopped"};
    if (filterResult?.status !== "PASS" || !filterResult.accepted) {
      return {status: "REJECT", reason: "all hard evidence gates must PASS"};
    }
    if (scoreResult?.status !== "PASS" || scoreResult.score < 70) {
      return {status: "REJECT", reason: "proposed analyst score must be at least 70"};
    }
    if (candidate.chainId !== "solana" || !candidate.pool || !candidate.quote ||
        !Number.isInteger(candidate.decimals) || candidate.decimals < 0 || candidate.decimals > 18) {
      return {status: "REJECT", reason: "Solana mint, selected pool, and quote identity are required"};
    }
    const gate = this.#updateDailyGate({now, marks});
    if (!gate.entriesAllowed) {
      const exitRequests = this.#requestDailyLossExits(gate, now);
      return {
        status: "REJECT",
        reason: gate.status,
        equityCents: gate.equityCents?.toString() ?? null,
        exitRequests
      };
    }
    if (this.positions.size + this.reservations.size >= MAX_POSITIONS) {
      return {status: "REJECT", reason: "maximum of three distinct open or reserved positions reached"};
    }
    const tickMint = `${tickId}:${candidate.mint}`;
    if (this.entriesByTickMint.has(tickMint) || this.positions.has(candidate.mint)) {
      return {status: "REJECT", reason: "same-tick re-entry or pyramiding is not allowed"};
    }
    const reserved = [...this.reservations.values()]
      .reduce((sum, item) => sum + item.maxSpendCents, 0n);
    const available = this.cashCents - reserved;
    const equityLimit = gate.equityCents * 8n / 100n;
    const maxSpend = [MAX_ENTRY_CENTS, equityLimit, available].reduce((minimum, amount) =>
      amount < minimum ? amount : minimum);
    if (maxSpend <= 0n) return {status: "REJECT", reason: "no unreserved cash available"};
    const authorization = Object.freeze({
      status: "AUTHORIZED",
      authorizationId,
      mint: candidate.mint,
      chainId: candidate.chainId,
      pool: candidate.pool,
      quote: candidate.quote,
      decimals: candidate.decimals,
      tickId,
      sampledAt: candidate.sampledAt,
      authorizedAt: now,
      maxSpendCents: maxSpend,
      stopLossBps: 600,
      trailingActivationBps: 1200,
      trailingDistanceBps: 600,
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false
    });
    this.authorizationDigests.set(authorizationId, requestDigest);
    this.reservations.set(authorizationId, authorization);
    this.entriesByTickMint.add(tickMint);
    this.#record({type: "RISK_AUTHORIZED", authorizationId, mint: candidate.mint,
      maxSpendCents: maxSpend.toString(), tickId, observedAt: now});
    return authorization;
  }

  executeEntry(authorization, quote, {now = Date.now()} = {}) {
    const eventId = quote?.eventId;
    if (typeof eventId !== "string" || !eventId) return {status: "REJECT", reason: "stable entry event identity required"};
    const eventPayload = {
      eventId, authorizationId: authorization?.authorizationId, mint: authorization?.mint,
      chainId: authorization?.chainId, pool: authorization?.pool, quote: authorization?.quote,
      observedAt: quote.observedAt, priceMicros: quote.priceMicros,
      decimals: quote.decimals, costs: quote.costs, mode: quote.mode
    };
    const eventDigest = digest(eventPayload);
    if (this.eventDigests.has(eventId)) {
      if (this.eventDigests.get(eventId) !== eventDigest) {
        return {status: "REJECT", reason: "event identity reused with different payload"};
      }
      return this.results.get(eventId);
    }
    const auth = this.reservations.get(authorization?.authorizationId);
    if (!auth || auth !== authorization) return {status: "REJECT", reason: "live risk reservation required"};
    const identity = {mint: auth.mint, chainId: auth.chainId, pool: auth.pool, quote: auth.quote};
    const fillTime = time(quote.observedAt);
    const authTime = time(auth.sampledAt);
    const authorizedTime = time(auth.authorizedAt);
    const currentTime = time(now);
    if (!quoteIdentityValid(quote, identity) || quote.mode !== "HYPOTHETICAL" ||
        !quote.executable ||         fillTime === null || authTime === null || authorizedTime === null || currentTime === null ||
        fillTime <= authTime || fillTime <= authorizedTime ||
        currentTime - fillTime < 0 || currentTime - fillTime > MAX_QUOTE_AGE_MS ||
        quote.decimals !== auth.decimals ||
        !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0) {
      return {status: "UNFILLED", reason: "later identity-bound hypothetical executable quote is unavailable"};
    }
    let costs;
    let scale;
    try {
      costs = sumCosts(quote.costs, "entry");
      scale = decimalScale(quote.decimals);
    } catch (error) {
      return {status: "UNFILLED", reason: error.message};
    }
    const maxNotional = auth.maxSpendCents - costs.total;
    if (maxNotional <= 0n) return {status: "UNFILLED", reason: "entry costs exceed risk budget"};
    const tokenAtoms = maxNotional * 10_000n * scale / BigInt(quote.priceMicros);
    const notional = tokenAtoms * BigInt(quote.priceMicros) / (scale * 10_000n);
    const allIn = notional + costs.total;
    if (tokenAtoms <= 0n || allIn > auth.maxSpendCents || allIn > this.cashCents) {
      return {status: "UNFILLED", reason: "conservative base-unit rounding leaves no affordable fill"};
    }
    const stopPriceMicros = BigInt(quote.priceMicros) * 9_400n / BPS;
    if (stopPriceMicros <= 0n) return {status: "UNFILLED", reason: "modeled initial stop is invalid"};

    const position = {
      mint: auth.mint,
      chainId: auth.chainId,
      pool: auth.pool,
      quote: auth.quote,
      decimals: quote.decimals,
      scale,
      tokenAtoms,
      entryPriceMicros: BigInt(quote.priceMicros),
      stopPriceMicros,
      highWaterPriceMicros: BigInt(quote.priceMicros),
      trailingActive: false,
      entryNotionalCents: notional,
      entryCostCents: allIn,
      entryCosts: costs.values,
      entryObservedAt: quote.observedAt,
      lastObservedAt: quote.observedAt,
      executionRealistic: false
    };
    const result = Object.freeze({
      status: "FILLED_PAPER",
      eventId,
      mint: auth.mint,
      tokenAtoms: tokenAtoms.toString(),
      decimals: quote.decimals,
      notionalCents: notional.toString(),
      entryCostsCents: costs.total.toString(),
      allInCents: allIn.toString(),
      entryPriceMicros: String(quote.priceMicros),
      initialStopPriceMicros: stopPriceMicros.toString(),
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false
    });
    this.cashCents -= allIn;
    this.positions.set(auth.mint, position);
    this.reservations.delete(auth.authorizationId);
    for (const [key, value] of Object.entries(costs.values)) this.costTotals.entry[key] += value;
    this.eventDigests.set(eventId, eventDigest);
    this.results.set(eventId, result);
    this.#record({type: "STOP_ARMED", eventId, mint: auth.mint,
      stopPriceMicros: stopPriceMicros.toString(), observedAt: quote.observedAt});
    this.#record({type: "PAPER_FILL", ...result});
    return result;
  }

  #closeAtQuote(position, quote, eventId, {reason, gapThroughStop = false} = {}) {
    if (typeof eventId !== "string" || !eventId) {
      return {status: "UNFILLED", reason: "stable exit event identity is missing"};
    }
    const payloadDigest = exitPayloadDigest(eventId, quote);
    if (this.eventDigests.has(eventId)) {
      if (this.eventDigests.get(eventId) !== payloadDigest) {
        return {status: "REJECT", reason: "exit event identity reused with different payload"};
      }
      return this.results.get(eventId);
    }
    if (quote.mode !== "HYPOTHETICAL" || quote.executable !== true) {
      return {status: "UNFILLED", reason: "no supported hypothetical executable exit quote"};
    }
    let costs;
    try {
      costs = sumCosts(quote.costs, "exit");
    } catch (error) {
      return {status: "UNFILLED", reason: error.message};
    }
    const price = BigInt(quote.priceMicros);
    const grossCents = position.tokenAtoms * price / (position.scale * 10_000n);
    if (costs.total > grossCents) {
      return {status: "UNFILLED", reason: "exit costs exceed proceeds; position remains open"};
    }
    const proceeds = grossCents - costs.total;
    const pnl = proceeds - position.entryCostCents;
    const grossPnl = grossCents - position.entryNotionalCents;
    const result = Object.freeze({
      status: "CLOSED_PAPER",
      eventId,
      mint: position.mint,
      fillPriceMicros: price.toString(),
      stopPriceMicros: position.stopPriceMicros.toString(),
      grossProceedsCents: grossCents.toString(),
      exitCostsCents: costs.total.toString(),
      realizedGrossPnlCents: grossPnl.toString(),
      realizedNetPnlCents: pnl.toString(),
      reason,
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false,
      gapThroughStop
    });
    this.cashCents += proceeds;
    this.realizedGrossPnlCents += grossPnl;
    this.realizedPnlCents += pnl;
    for (const [key, value] of Object.entries(costs.values)) this.costTotals.exit[key] += value;
    this.positions.delete(position.mint);
    this.eventDigests.set(eventId, payloadDigest);
    this.results.set(eventId, result);
    this.#record({type: "PAPER_EXIT", ...result});
    return result;
  }

  #requestDailyLossExits(gate, now) {
    if (gate.status !== "DAILY_LOSS_LIMIT") return [];
    const nowTime = time(now);
    const requests = [];
    for (const [mint, position] of this.positions) {
      const quote = gate.marksByMint?.get(mint);
      const observed = time(quote?.observedAt);
      if (!quote || !quoteIdentityValid(quote, position) || observed === null ||
          observed <= time(position.lastObservedAt) || observed > nowTime ||
          nowTime - observed > MAX_QUOTE_AGE_MS ||
          !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0) {
        requests.push({mint, status: "UNFILLED", reason: "risk-reducing quote unavailable; position remains open"});
        continue;
      }
      const price = BigInt(quote.priceMicros);
      if (price > position.highWaterPriceMicros) position.highWaterPriceMicros = price;
      if (price * BPS >= position.entryPriceMicros * 11_200n) position.trailingActive = true;
      if (position.trailingActive) {
        const trailingStop = position.highWaterPriceMicros * 9_400n / BPS;
        if (trailingStop > position.stopPriceMicros) position.stopPriceMicros = trailingStop;
      }
      position.lastObservedAt = quote.observedAt;
      const eventId = typeof quote.eventId === "string" && quote.eventId
        ? quote.eventId
        : `daily-loss:${this.runId}:${mint}:${String(quote.observedAt)}`;
      const exit = this.#closeAtQuote(position, quote, eventId, {
        reason: "DAILY_LOSS_LIMIT",
        gapThroughStop: price < position.stopPriceMicros
      });
      requests.push({mint, ...exit});
    }
    return requests;
  }

  observeExitQuote(quote, {now = quote?.observedAt, eventId = quote?.eventId} = {}) {
    if (typeof eventId === "string" && this.eventDigests.has(eventId)) {
      if (this.eventDigests.get(eventId) !== exitPayloadDigest(eventId, quote)) {
        return {status: "REJECT", reason: "exit event identity reused with different payload"};
      }
      return this.results.get(eventId);
    }
    const position = this.positions.get(quote?.mint);
    if (!position) return {status: "UNKNOWN", reason: "no open position for mint"};
    const observed = time(quote.observedAt);
    const current = time(now);
    if (!quoteIdentityValid(quote, position) || observed === null || current === null ||
        observed <= time(position.lastObservedAt) || observed > current ||
        current - observed > MAX_QUOTE_AGE_MS ||
        !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0) {
      return {status: "VALUATION_UNAVAILABLE", reason: "exit quote is stale, non-monotonic, or identity-mismatched"};
    }
    const price = BigInt(quote.priceMicros);
    if (price > position.highWaterPriceMicros) position.highWaterPriceMicros = price;
    if (price * BPS >= position.entryPriceMicros * 11_200n) position.trailingActive = true;
    if (position.trailingActive) {
      const trailingStop = position.highWaterPriceMicros * 9_400n / BPS;
      if (trailingStop > position.stopPriceMicros) position.stopPriceMicros = trailingStop;
    }
    position.lastObservedAt = quote.observedAt;
    this.#record({type: "RISK_MARK", mint: position.mint, observedAt: quote.observedAt,
      priceMicros: price.toString(), highWaterPriceMicros: position.highWaterPriceMicros.toString(),
      stopPriceMicros: position.stopPriceMicros.toString(), trailingActive: position.trailingActive});
    if (price > position.stopPriceMicros) return {status: "MARKED", stopPriceMicros: position.stopPriceMicros.toString()};
    return this.#closeAtQuote(position, quote, eventId, {
      reason: "STOP",
      gapThroughStop: price < position.stopPriceMicros
    });
  }

  riskSnapshot({now, marks = []}) {
    const gate = this.#updateDailyGate({now, marks});
    const exitRequests = this.#requestDailyLossExits(gate, now);
    return {
      ...gate,
      entriesAllowed: gate.entriesAllowed && this.newWorkAllowed,
      cashCents: this.cashCents,
      realizedGrossPnlCents: this.realizedGrossPnlCents,
      realizedPnlCents: this.realizedPnlCents,
      openPositions: this.positions.size,
      reservedPositions: this.reservations.size,
      exitRequests
    };
  }

  finishRun({startedAt, now, marks = []}) {
    const start = time(startedAt);
    const end = time(now);
    if (start === null || end === null || end < start) {
      return {status: "INVALID_RUN_WINDOW", entriesAllowed: false};
    }
    this.newWorkAllowed = false;
    if (end - start > 8 * 60 * 60 * 1000) {
      return {status: "INVALID_RUN_WINDOW", entriesAllowed: false, reason: "eight-hour run limit exceeded"};
    }
    const valued = this.#snapshotEquity({now: end, marks});
    const remaining = [...this.positions.keys()];
    this.#record({type: "RUN_FINISHED", observedAt: now, openMints: remaining});
    return {
      status: "FINISHED",
      entriesAllowed: false,
      elapsedMs: end - start,
      openPositions: remaining.map(mint => ({
        mint,
        markStatus: valued.status === "PASS" ? "MARKED" : "VALUATION_UNAVAILABLE"
      })),
      equityCents: valued.status === "PASS" ? valued.equityCents.toString() : null,
      accounting: valued.status === "PASS" ? {
        cashCents: valued.cashCents.toString(),
        grossOpenValueCents: valued.grossOpenValueCents.toString(),
        estimatedExitCostsCents: valued.estimatedExitCostsCents.toString(),
        grossUnrealizedPnlCents: valued.grossUnrealizedPnlCents.toString(),
        netUnrealizedPnlCents: valued.netUnrealizedPnlCents.toString(),
        realizedGrossPnlCents: this.realizedGrossPnlCents.toString(),
        realizedNetPnlCents: this.realizedPnlCents.toString(),
        reconciliation: "equity = cash + gross open value - estimated exit costs"
      } : null,
      note: "Open positions are not liquidated at run end; no end-of-run fill is invented."
    };
  }

  auditEvents() {
    return this.events.map(event => ({...event}));
  }

  summary() {
    return {
      runId: this.runId,
      initialCapitalCents: this.initialCapitalCents.toString(),
      cashCents: this.cashCents.toString(),
      pnl: {
        realizedGrossCents: this.realizedGrossPnlCents.toString(),
        realizedNetCents: this.realizedPnlCents.toString(),
        unrealizedGrossCents: this.lastEquitySnapshot?.grossUnrealizedPnlCents.toString() ?? null,
        unrealizedNetCents: this.lastEquitySnapshot?.netUnrealizedPnlCents.toString() ?? null
      },
      costs: Object.fromEntries(Object.entries(this.costTotals).map(([kind, values]) =>
        [kind, Object.fromEntries(Object.entries(values).map(([key, amount]) => [key, amount.toString()]))])),
      lastKnownEquityCents: this.lastEquitySnapshot?.equityCents.toString() ?? null,
      openPositions: [...this.positions.values()].map(position => ({
        mint: position.mint,
        tokenAtoms: position.tokenAtoms.toString(),
        decimals: position.decimals,
        entryCostCents: position.entryCostCents.toString(),
        entryNotionalCents: position.entryNotionalCents.toString(),
        entryCostsCents: Object.fromEntries(Object.entries(position.entryCosts)
          .map(([key, amount]) => [key, amount.toString()])),
        stopPriceMicros: position.stopPriceMicros.toString(),
        trailingActive: position.trailingActive,
        highWaterPriceMicros: position.highWaterPriceMicros.toString()
      })),
      eventCount: this.events.length,
      restartDisposition: PaperLedger.restartDisposition(),
      executionRealistic: false
    };
  }
}

export const PAPER_LEDGER_POLICY = Object.freeze({
  initialCapitalCents: INITIAL_CAPITAL_CENTS.toString(),
  maxEntryCents: MAX_ENTRY_CENTS.toString(),
  maxOpenPositions: MAX_POSITIONS,
  initialStopBps: 600,
  trailingActivationBps: 1200,
  trailingDistanceBps: 600,
  dailyLossBps: DAY_LOSS_BPS.toString(),
  timezone: "Europe/Vienna",
  restartPolicy: "UNRECOVERABLE_FAIL_CLOSED",
  executionMode: "SIMULATED_ONLY"
});
