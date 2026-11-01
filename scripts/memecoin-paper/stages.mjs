export const PIPELINE_ROLES = Object.freeze([
  "Scout",
  "Filter",
  "Analyst",
  "Risk authorization",
  "Executor (simulated only)",
  "Logger"
]);

export const FILTER_POLICY = Object.freeze({
  version: "solana-memecoin-hard-gates-v1",
  minPairAgeMs: 30 * 60 * 1000,
  maxPairAgeMs: 72 * 60 * 60 * 1000,
  minMarketCapUsd: 300_000,
  maxMarketCapUsd: 20_000_000,
  minLiquidityUsd: 40_000,
  minVolume1hUsd: 50_000,
  maxTop10OwnerPct: 25,
  maxDevAssociatedPct: 3,
  maxBundledLaunchPct: 10,
  maxPriceChange1hPct: 80,
  maxEvidenceAgeMs: 5 * 60 * 1000
});

export const SCORE_SPEC = Object.freeze({
  version: "memecoin-candidate-score-v1",
  threshold: 70,
  weights: Object.freeze({
    momentum15m: 25,
    uniqueBuyers1h: 20,
    buySellUsdRatio1h: 15,
    holderGrowthPct1h: 15,
    liquidityMarketCapPct: 15,
    qualifiedSmartWallets: 10
  }),
  normalizations: Object.freeze({
    momentum15m: [-10, 20],
    uniqueBuyers1h: [0, 100],
    buySellUsdRatio1h: [0.5, 2.5],
    holderGrowthPct1h: [-5, 15],
    liquidityMarketCapPct: [0.2, 5],
    qualifiedSmartWallets: [0, 5]
  })
});

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EXTENSIONS = ["transferFee", "transferHook", "defaultFrozen", "permanentDelegate"];
const SYNTHETIC_SOURCE = "SYNTHETIC_FIXTURE_ONLY";

function timestamp(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isSafeInteger(parsed) && Number.isFinite(new Date(parsed).getTime()) ? parsed : null;
}

function safeLogString(value, maxLength = 200) {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, maxLength);
}

function evidenceResult(status, reason, evidence = null) {
  return {
    status,
    reason,
    source: evidence?.source ?? null,
    observedAt: evidence?.observedAt ?? null,
    slot: evidence?.slot ?? null,
    coverage: evidence?.coverage ?? null
  };
}

function boundEvidence(candidate, key, now, maxAgeMs = FILTER_POLICY.maxEvidenceAgeMs) {
  const evidence = candidate?.evidence?.[key];
  if (!evidence || typeof evidence !== "object") {
    return {result: evidenceResult("UNKNOWN", "required evidence missing"), value: undefined};
  }
  const observed = timestamp(evidence.observedAt);
  const sample = timestamp(candidate.sampledAt);
  const evaluationTime = timestamp(now);
  const age = observed === null || evaluationTime === null ? null : evaluationTime - observed;
  const binding = evidence.binding;
  if (typeof evidence.source !== "string" || !evidence.source.trim() || evidence.source.length > 256) {
    return {result: evidenceResult("UNKNOWN", "evidence source missing", evidence), value: undefined};
  }
  if ((candidate.source === SYNTHETIC_SOURCE) !== (evidence.source === SYNTHETIC_SOURCE)) {
    return {result: evidenceResult("UNKNOWN", "synthetic and real evidence may not be mixed", evidence), value: undefined};
  }
  if (observed === null || evaluationTime === null || age === null ||
      age < 0 || age > maxAgeMs || sample === null || observed > sample) {
    return {result: evidenceResult("UNKNOWN", "evidence stale, future-dated, or outside sample", evidence), value: undefined};
  }
  if (evidence.verified !== true) {
    return {result: evidenceResult("UNKNOWN", "evidence is not verified", evidence), value: undefined};
  }
  if (!binding || binding.chainId !== candidate.chainId || binding.mint !== candidate.mint ||
      binding.pool !== candidate.pool || binding.quote !== candidate.quote) {
    return {result: evidenceResult("UNKNOWN", "evidence identity does not match selected chain, pool, and quote", evidence), value: undefined};
  }
  if (!evidence.coverage || typeof evidence.coverage !== "object" || evidence.coverage.complete !== true) {
    return {result: evidenceResult("UNKNOWN", "evidence coverage is incomplete or undescribed", evidence), value: undefined};
  }
  return {result: evidenceResult("PASS", "evidence is fresh, verified, covered, and identity-bound", evidence), value: evidence.value};
}

function evaluate(candidate, key, now, predicate, rejectReason) {
  const checked = boundEvidence(candidate, key, now);
  if (checked.result.status !== "PASS") return checked.result;
  const outcome = predicate(checked.value, candidate, checked.result.coverage);
  if (outcome === null) return evidenceResult("UNKNOWN", "required evidence value or coverage is incomplete", candidate.evidence[key]);
  return outcome ? evidenceResult("PASS", "threshold satisfied", candidate.evidence[key])
    : evidenceResult("REJECT", rejectReason, candidate.evidence[key]);
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function candidateBinding(candidate) {
  return {
    chainId: candidate?.chainId ?? null,
    mint: candidate?.mint ?? null,
    pool: candidate?.pool ?? null,
    quote: candidate?.quote ?? null,
    source: candidate?.source ?? null,
    sampledAt: timestamp(candidate?.sampledAt)
  };
}

function sameBinding(left, right) {
  return Boolean(left && right && left.chainId === right.chainId && left.mint === right.mint &&
    left.pool === right.pool && left.quote === right.quote && left.source === right.source &&
    left.sampledAt !== null && left.sampledAt === right.sampledAt);
}

function identityFilter(candidate, now) {
  const sample = timestamp(candidate?.sampledAt);
  const evaluationTime = timestamp(now);
  const age = sample === null || evaluationTime === null ? null : evaluationTime - sample;
  const identityEvidence = {
    source: candidate?.source ?? null,
    observedAt: candidate?.sampledAt ?? null,
    slot: candidate?.slot ?? null,
    coverage: {
      chainId: candidate?.chainId ?? null,
      mint: candidate?.mint ?? null,
      pool: candidate?.pool ?? null,
      quote: candidate?.quote ?? null
    }
  };
  if (candidate?.chainId === undefined || candidate.chainId === null || candidate.chainId === "") {
    return evidenceResult("UNKNOWN", "chain identity is missing", identityEvidence);
  }
  if (candidate.chainId !== "solana") return evidenceResult("REJECT", "chain is not Solana", identityEvidence);
  if (!BASE58.test(candidate?.mint ?? "") || !BASE58.test(candidate?.pool ?? "") ||
      !BASE58.test(candidate?.quote ?? "")) {
    return evidenceResult("UNKNOWN", "mint, selected pool, or quote identity is invalid", identityEvidence);
  }
  if (typeof candidate?.source !== "string" || !candidate.source.trim() ||
      sample === null || age === null || age < 0 || age > FILTER_POLICY.maxEvidenceAgeMs) {
    return evidenceResult("UNKNOWN", "source or sample time missing, stale, or future-dated", identityEvidence);
  }
  return evidenceResult("PASS", "Solana mint, selected pool, quote, source, and sample time are bound", {
    source: candidate.source,
    observedAt: candidate.sampledAt,
    slot: candidate.slot ?? null,
    coverage: identityEvidence.coverage
  });
}

export function scout(rows, {now = Date.now(), maxCandidates = 1000, source = "UNSPECIFIED"} = {}) {
  if (!Array.isArray(rows) || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new TypeError("invalid bounded scout input");
  }
  const bounded = rows.slice(0, maxCandidates);
  const loggedSource = safeLogString(source, 120);
  const groups = new Map();
  const audit = [];
  for (const row of bounded) {
    const mint = typeof row?.mint === "string" ? row.mint : "";
    if (!BASE58.test(mint)) {
      audit.push({stage: "Scout", status: "REJECT", reason: "invalid or missing mint identity", source: loggedSource});
      continue;
    }
    const list = groups.get(mint) ?? [];
    list.push(row);
    groups.set(mint, list);
  }
  const selected = [];
  for (const [mint, candidates] of groups) {
    const ordered = [...candidates].sort((a, b) =>
      (timestamp(b.sampledAt) ?? -1) - (timestamp(a.sampledAt) ?? -1) ||
      String(a.pool ?? "").localeCompare(String(b.pool ?? "")) ||
      String(a.quote ?? "").localeCompare(String(b.quote ?? "")));
    const chosen = ordered[0];
    selected.push(chosen);
    audit.push({
      stage: "Scout",
      status: "SELECTED",
      mint,
      selectedPool: BASE58.test(chosen.pool ?? "") ? chosen.pool : null,
      quote: BASE58.test(chosen.quote ?? "") ? chosen.quote : null,
      chainId: safeLogString(chosen.chainId, 32),
      sampledAt: timestamp(chosen.sampledAt) === null ? null : new Date(timestamp(chosen.sampledAt)).toISOString(),
      source: loggedSource
    });
    for (const duplicate of ordered.slice(1)) {
      audit.push({
        stage: "Scout",
        status: "REJECT",
        reason: "duplicate mint; selected pool evidence is not mixed",
        mint,
        selectedPool: BASE58.test(chosen.pool ?? "") ? chosen.pool : null,
        duplicatePool: BASE58.test(duplicate.pool ?? "") ? duplicate.pool : null,
        source: loggedSource
      });
    }
  }
  return {
    selected,
    audit: audit.slice(0, maxCandidates * 2),
    discovery: {
      source: loggedSource,
      observedRecords: bounded.length,
      truncated: rows.length > bounded.length,
      exhaustive: false,
      note: "Profiles and boosts are bounded discovery hints, not an exhaustive new-pair feed or quality evidence."
    }
  };
}

export function filterCandidate(candidate, {now = Date.now(), holdUntil = null} = {}) {
  const checks = {
    identity: identityFilter(candidate, now),
    pairAge: evaluate(candidate, "pairCreatedAt", now, (value, row) => {
      const pairTime = timestamp(value);
      if (pairTime === null || pairTime !== timestamp(row.pairCreatedAt)) return null;
      const sampled = timestamp(row.sampledAt);
      if (sampled === null) return null;
      const age = sampled - pairTime;
      if (age < 0) return null;
      return age >= FILTER_POLICY.minPairAgeMs && age <= FILTER_POLICY.maxPairAgeMs;
    }, "pair age is outside 30-minute to 72-hour bounds"),
    marketCap: evaluate(candidate, "marketCapUsd", now, (value, row) =>
      !numeric(value) || value < 0 || value !== row.marketCapUsd ? null
        : value >= FILTER_POLICY.minMarketCapUsd && value <= FILTER_POLICY.maxMarketCapUsd,
    "actual USD market cap is outside USD 300,000 to USD 20,000,000"),
    tokenDecimals: evaluate(candidate, "tokenDecimals", now, (value, row) =>
      !Number.isInteger(value) ? null : value >= 0 && value <= 18 && value === row.decimals,
    "validated token decimals are unavailable or invalid"),
    mintAuthority: evaluate(candidate, "mintAuthorityRevoked", now, value =>
      typeof value === "boolean" ? value : null,
      "mint authority is not revoked"),
    freezeAuthority: evaluate(candidate, "freezeAuthorityRevoked", now, value =>
      typeof value === "boolean" ? value : null,
      "freeze authority is not revoked"),
    lpProtection: evaluate(candidate, "lpProtection", now, (value, row) => {
      if (!value || value.verified !== true || value.pool !== row.pool) return null;
      if (value.model === "burn") return typeof value.burnEvidenceId === "string" && value.burnEvidenceId.length > 0;
      if (value.model === "lock") {
        const until = timestamp(value.lockedUntil);
        const required = timestamp(holdUntil);
        if (required === null || until === null) return null;
        return until >= required;
      }
      return null;
    }, "pool LP is not verifiably burned or locked for the proposed hold"),
    liquidity: evaluate(candidate, "liquidityUsd", now, value =>
      !numeric(value) || value < 0 ? null : value >= FILTER_POLICY.minLiquidityUsd,
      "liquidity is below USD 40,000"),
    volume1h: evaluate(candidate, "volume1hUsd", now, value =>
      !numeric(value) || value < 0 ? null : value >= FILTER_POLICY.minVolume1hUsd,
      "trailing one-hour volume is below USD 50,000"),
    top10Owners: evaluate(candidate, "top10OwnerPct", now, (value, row, coverage) =>
      !numeric(value) || value < 0 || coverage.aggregation !== "owner" ||
      typeof coverage.denominatorAtoms !== "string" || coverage.denominatorAtoms.length > 40 ||
      !/^\d+$/.test(coverage.denominatorAtoms) ||
      BigInt(coverage.denominatorAtoms) <= 0n || !Array.isArray(coverage.exclusions) ||
      !coverage.exclusions.includes("selected_pool") || !coverage.exclusions.includes("burned_supply")
        ? null : value <= FILTER_POLICY.maxTop10OwnerPct,
    "owner-aggregated top-ten concentration exceeds 25% or coverage is incomplete"),
    devHoldings: evaluate(candidate, "devAssociatedPct", now, (value, row, coverage) =>
      !numeric(value) || value < 0 || coverage.associationMethod !== "documented"
        ? null : value <= FILTER_POLICY.maxDevAssociatedPct,
    "dev-associated holdings exceed 3% or attribution is incomplete"),
    priorRug: evaluate(candidate, "crediblePriorRug", now, value => {
      if (!value || typeof value.found !== "boolean" || value.reviewed !== true ||
          value.historyCoverage !== "complete") return null;
      if (value.found && (typeof value.attribution !== "string" || !value.attribution.trim() ||
          !Array.isArray(value.evidenceIds) || value.evidenceIds.length === 0 ||
          !value.evidenceIds.every(id => typeof id === "string" && id.trim()))) return null;
      return value.found === false;
    },
    "credible attributable prior-rug evidence found or history is incomplete"),
    bundledLaunch: evaluate(candidate, "bundledLaunchPct", now, (value, row, coverage) =>
      !numeric(value) || value < 0 ? null : value <= FILTER_POLICY.maxBundledLaunchPct,
    "bundled-launch supply exceeds 10% or coverage is incomplete"),
    priceRunup: evaluate(candidate, "priceChange1hPct", now, value =>
      !numeric(value) || value < -100 ? null : value < FILTER_POLICY.maxPriceChange1hPct,
    "one-hour price increase is at least 80%"),
    tokenExtensions: evaluate(candidate, "tokenExtensions", now, value => {
      if (!value || !EXTENSIONS.every(name => typeof value[name] === "boolean")) return null;
      return EXTENSIONS.every(name => value[name] === false);
    },
    "unsupported or transferability-altering token extension is present")
  };
  if (checks.priorRug.status === "REJECT") {
    const rugEvidence = candidate.evidence.crediblePriorRug.value;
    checks.priorRug.attribution = rugEvidence.attribution;
    checks.priorRug.evidenceRefs = rugEvidence.evidenceIds.slice(0, 16);
  }

  const statuses = Object.values(checks).map(check => check.status);
  const status = statuses.includes("REJECT") ? "REJECT"
    : statuses.includes("UNKNOWN") ? "UNKNOWN" : "PASS";
  return {status, accepted: status === "PASS", identity: candidateBinding(candidate), checks};
}

function normalize(key, value) {
  if (!numeric(value)) return null;
  const [minimum, maximum] = SCORE_SPEC.normalizations[key];
  if (value <= minimum) return 0;
  if (value >= maximum) return 100;
  const scale = 1_000_000n;
  const toScaled = number => BigInt(Math.round(number * Number(scale)));
  const scaledValue = toScaled(value);
  const scaledMinimum = toScaled(minimum);
  const scaledMaximum = toScaled(maximum);
  if (scaledValue <= scaledMinimum) return 0;
  if (scaledValue >= scaledMaximum) return 100;
  return Number((scaledValue - scaledMinimum) * 100n / (scaledMaximum - scaledMinimum));
}

export function analyzeCandidate(candidate, {
  now = Date.now(),
  filterResult,
  smartWalletAllowlist = {status: "UNSET", provenance: null}
} = {}) {
  const identity = candidateBinding(candidate);
  if (!filterResult?.accepted) {
    return {status: "BLOCKED", reason: "hard filters must all PASS before scoring", score: null, identity};
  }
  if (!sameBinding(filterResult.identity, identity)) {
    return {status: "BLOCKED", reason: "hard-filter decision is not bound to this candidate sample", score: null, identity};
  }
  const metrics = candidate?.analystEvidence;
  const components = {};
  for (const key of Object.keys(SCORE_SPEC.weights)) {
    const item = metrics?.[key];
    const checked = boundEvidence({ ...candidate, evidence: {[key]: item}}, key, now);
    if (checked.result.status !== "PASS") {
      components[key] = {...checked.result, score: null};
      continue;
    }
    if (key === "qualifiedSmartWallets" &&
        (smartWalletAllowlist?.status !== "VERIFIED" ||
         typeof smartWalletAllowlist.provenance !== "string" ||
         smartWalletAllowlist.provenance.trim() === "" ||
         ((candidate.source === SYNTHETIC_SOURCE) !==
          (smartWalletAllowlist.provenance === SYNTHETIC_SOURCE)))) {
      components[key] = evidenceResult("UNKNOWN", "smart-wallet allowlist or provenance is unset", item);
      components[key].score = null;
      continue;
    }
    if (key === "buySellUsdRatio1h" &&
        (!item.coverage?.buyVolumeUsd || !item.coverage?.sellVolumeUsd ||
         !numeric(item.coverage.buyVolumeUsd) || !numeric(item.coverage.sellVolumeUsd) ||
         item.coverage.buyVolumeUsd <= 0 || item.coverage.sellVolumeUsd <= 0)) {
      components[key] = evidenceResult("UNKNOWN", "buy/sell USD-volume denominator is unavailable", item);
      components[key].score = null;
      continue;
    }
    const value = key === "buySellUsdRatio1h"
      ? item.coverage.buyVolumeUsd / item.coverage.sellVolumeUsd
      : item.value;
    if ((key === "uniqueBuyers1h" || key === "qualifiedSmartWallets") &&
        (!Number.isInteger(value) || value < 0)) {
      components[key] = {...evidenceResult("UNKNOWN", "wallet count must be a nonnegative integer", item), score: null};
      continue;
    }
    if ((key === "momentum15m" || key === "holderGrowthPct1h") && value < -100 ||
        key === "liquidityMarketCapPct" && value <= 0) {
      components[key] = {...evidenceResult("UNKNOWN", "component value is outside its valid domain", item), score: null};
      continue;
    }
    const score = normalize(key, value);
    components[key] = score === null
      ? {...evidenceResult("UNKNOWN", "component value unavailable", item), score: null}
      : {...evidenceResult("PASS", "component normalized by the versioned proposed specification", item), score};
  }
  if (Object.values(components).some(component => component.status !== "PASS")) {
    return {status: "SCORE_UNAVAILABLE", reason: "all six independently evidenced score components are required", score: null, components, identity};
  }
  const weighted = Object.entries(SCORE_SPEC.weights)
    .reduce((sum, [key, weight]) => sum + components[key].score * weight, 0);
  const score = Math.floor(weighted / 100);
  return {
    status: score >= SCORE_SPEC.threshold ? "PASS" : "REJECT",
    reason: score >= SCORE_SPEC.threshold ? "score meets proposed threshold" : "score is below proposed threshold",
    score,
    threshold: SCORE_SPEC.threshold,
    version: SCORE_SPEC.version,
    identity,
    components,
    weights: SCORE_SPEC.weights
  };
}

export class AuditLogger {
  constructor({maxEvents = 25_000, maxTextLength = 200} = {}) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 ||
        !Number.isSafeInteger(maxTextLength) || maxTextLength < 16) {
      throw new TypeError("invalid bounded audit logger limits");
    }
    this.maxEvents = maxEvents;
    this.maxTextLength = maxTextLength;
    this.events = [];
    this.truncated = false;
  }

  record(event) {
    if (this.events.length >= this.maxEvents) {
      this.truncated = true;
      return false;
    }
    const clean = {};
    for (const [key, value] of Object.entries(event ?? {})) {
      if (value === null || typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))) clean[key] = value;
      else if (typeof value === "string") {
        clean[key] = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/https?:\/\/\S+/gi, "[url]")
          .slice(0, this.maxTextLength);
      } else if (key === "coverage" && value && typeof value === "object" && !Array.isArray(value)) {
        clean[key] = {};
        for (const [coverageKey, coverageValue] of Object.entries(value).slice(0, 12)) {
          if (coverageValue === null || typeof coverageValue === "boolean" ||
              (typeof coverageValue === "number" && Number.isFinite(coverageValue))) {
            clean[key][coverageKey] = coverageValue;
          } else if (typeof coverageValue === "string") {
            clean[key][coverageKey] = coverageValue.replace(/[\u0000-\u001f\u007f]/g, " ")
              .replace(/https?:\/\/\S+/gi, "[url]").slice(0, this.maxTextLength);
          } else if (Array.isArray(coverageValue)) {
            clean[key][coverageKey] = coverageValue.slice(0, 16).map(item =>
              typeof item === "string"
                ? item.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/https?:\/\/\S+/gi, "[url]")
                  .slice(0, this.maxTextLength)
                : (typeof item === "number" && Number.isFinite(item) ? item : null));
          }
        }
      } else if (Array.isArray(value)) {
        clean[key] = value.slice(0, 16).map(item =>
          typeof item === "string"
            ? item.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/https?:\/\/\S+/gi, "[url]")
              .slice(0, this.maxTextLength)
            : null);
      }
    }
    this.events.push(Object.freeze(clean));
    return true;
  }

  report() {
    return this.events.map(event => ({...event}));
  }
}

export function processCandidate(candidate, {
  now = Date.now(),
  holdUntil = null,
  smartWalletAllowlist,
  logger = new AuditLogger()
} = {}) {
  const filters = filterCandidate(candidate, {now, holdUntil});
  for (const [gate, check] of Object.entries(filters.checks)) {
    logger.record({
      stage: "Filter",
      gate,
      status: check.status,
      mint: candidate?.mint,
      pool: candidate?.pool,
      quote: candidate?.quote,
      reason: check.reason,
      source: check.source,
      observedAt: check.observedAt,
      slot: check.slot,
      coverage: check.coverage,
      attribution: check.attribution,
      evidenceRefs: check.evidenceRefs
    });
  }
  const analysis = analyzeCandidate(candidate, {now, filterResult: filters, smartWalletAllowlist});
  for (const [component, check] of Object.entries(analysis.components ?? {})) {
    logger.record({
      stage: "Analyst",
      component,
      status: check.status,
      mint: candidate?.mint,
      pool: candidate?.pool,
      quote: candidate?.quote,
      reason: check.reason,
      source: check.source,
      observedAt: check.observedAt,
      slot: check.slot,
      coverage: check.coverage,
      score: check.score
    });
  }
  logger.record({stage: "Analyst", status: analysis.status, mint: candidate?.mint,
    score: analysis.score, reason: analysis.reason});
  return {filters, analysis, logger, auditTruncated: logger.truncated};
}
