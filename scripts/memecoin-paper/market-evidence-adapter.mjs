import {FILTER_POLICY, SCORE_SPEC} from "./stages.mjs";

export const MARKET_EVIDENCE_ADAPTER_VERSION = "market-evidence-adapter-v1";
export const PROVIDER_NORMALIZER_VERSION = "acquireProviderEvidence-contract-v1";
export const SYNTHETIC_SOURCE = "SYNTHETIC_FIXTURE_ONLY";
export const MAX_OWNER_ACCOUNTS = 20_000;

const BASE_FILTER_KEYS = Object.freeze([
  "pairCreatedAt",
  "marketCapUsd",
  "tokenDecimals",
  "mintAuthorityRevoked",
  "freezeAuthorityRevoked",
  "liquidityUsd",
  "volume1hUsd",
  "priceChange1hPct",
  "tokenExtensions"
]);
const ANALYST_KEYS = Object.freeze(Object.keys(SCORE_SPEC.weights));
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DECIMAL_INTEGER = /^(0|[1-9]\d{0,38})$/;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 .:_/-]{0,127}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function safeLabel(value) {
  return typeof value === "string" && value.length <= 128 &&
    !value.includes("://") && SAFE_LABEL.test(value);
}

function safeReference(value) {
  return typeof value === "string" && value.length <= 128 && SAFE_REFERENCE.test(value);
}

function address(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 44 &&
    BASE58.test(value);
}

function sameIdentity(left, right) {
  return isRecord(left) && left.chainId === right.chainId && left.mint === right.mint &&
    left.pool === right.pool && left.quote === right.quote;
}

function identityFor(candidate) {
  return {
    chainId: candidate.chainId,
    mint: candidate.mint,
    pool: candidate.pool,
    quote: candidate.quote
  };
}

function unknownEvidence(reason, identity, item = null) {
  const declared = item?.identity;
  const binding = isRecord(declared)
    ? {
        chainId: safeLabel(declared.chainId) ? declared.chainId : null,
        mint: address(declared.mint) ? declared.mint : null,
        pool: address(declared.pool) ? declared.pool : null,
        quote: address(declared.quote) ? declared.quote : null
      }
    : identity;
  return {
    value: null,
    source: safeLabel(item?.source) ? item.source : null,
    observedAt: validTime(item?.observedAt) ? item.observedAt : null,
    slot: Number.isSafeInteger(item?.slot) && item.slot >= 0 ? item.slot : null,
    verified: false,
    coverage: {complete: false, reason, sourceVersion: null},
    binding
  };
}

function invalidCandidate(candidate) {
  return !isRecord(candidate) || candidate.chainId !== "solana" ||
    !address(candidate.mint) || !address(candidate.pool) || !address(candidate.quote) ||
    !validTime(candidate.sampledAt) || !safeLabel(candidate.source);
}

function providerEvidence(candidate, key, now, identity) {
  const item = candidate.evidence?.[key];
  if (!isRecord(item) || !safeLabel(item.source) ||
      !sameIdentity(item.binding, identity) ||
      !validTime(item.observedAt) || item.observedAt > candidate.sampledAt ||
      now < item.observedAt || now - item.observedAt > FILTER_POLICY.maxEvidenceAgeMs ||
      item.coverage?.complete !== true) {
    return unknownEvidence("normalized provider evidence is absent, unbound, stale, or incomplete",
      identity, item);
  }
  const onChain = key === "tokenDecimals" || key === "mintAuthorityRevoked" ||
    key === "freezeAuthorityRevoked" || key === "tokenExtensions";
  if ((onChain && (!Number.isSafeInteger(item.slot) || item.slot < 0)) ||
      (!onChain && item.slot !== null && (!Number.isSafeInteger(item.slot) || item.slot < 0))) {
    return unknownEvidence("provider slot binding is invalid", identity, item);
  }
  const expectedSources = {
    pairCreatedAt: "DexScreener public API",
    marketCapUsd: "DexScreener public API",
    liquidityUsd: "DexScreener public API",
    volume1hUsd: "DexScreener public API",
    priceChange1hPct: "DexScreener public API",
    tokenDecimals: "Solana JSON-RPC getTokenSupply",
    mintAuthorityRevoked: "Solana JSON-RPC getAccountInfo",
    freezeAuthorityRevoked: "Solana JSON-RPC getAccountInfo",
    tokenExtensions: "Solana JSON-RPC getAccountInfo"
  };
  if (candidate.source === SYNTHETIC_SOURCE
    ? item.source !== SYNTHETIC_SOURCE
    : item.source !== expectedSources[key]) {
    return unknownEvidence("provider source does not match the normalized field contract", identity, item);
  }
  const value = item.value;
  const validValue = key === "pairCreatedAt" ? validTime(value)
    : key === "tokenDecimals" ? Number.isInteger(value) && value >= 0 && value <= 18
      : key === "mintAuthorityRevoked" || key === "freezeAuthorityRevoked"
        ? typeof value === "boolean"
        : key === "tokenExtensions"
          ? isRecord(value) && ["transferFee", "transferHook", "defaultFrozen", "permanentDelegate"]
            .every(name => typeof value[name] === "boolean")
          : isFiniteNumber(value) && value >= (key === "priceChange1hPct" ? -100 : 0);
  if (!validValue) return unknownEvidence("normalized provider field has an invalid value", identity, item);
  if (key === "tokenDecimals") {
    const candidateSupply = decimalAtoms(candidate.tokenSupplyAtoms);
    const normalizedSupply = decimalAtoms(item.coverage.amountAtoms);
    if (item.verified !== true || candidateSupply === null || normalizedSupply === null ||
        candidateSupply !== normalizedSupply || item.coverage.mintAccountMatch !== true ||
        item.coverage.accountSlot !== item.slot) {
      return unknownEvidence("authoritative mint supply is missing, unbound, or inconsistent", identity, item);
    }
  }
  const record = {
    value,
    source: item.source,
    observedAt: item.observedAt,
    slot: item.slot,
    verified: true,
    coverage: {
      complete: true,
      sourceVersion: PROVIDER_NORMALIZER_VERSION,
      ...(item.coverage.sourceTime === true ? {sourceTime: true} : {}),
      ...(typeof item.coverage.sourceBinding === "string" &&
        item.coverage.sourceBinding.length <= 80 && safeReference(item.coverage.sourceBinding)
        ? {sourceBinding: item.coverage.sourceBinding} : {}),
      ...(typeof item.coverage.amountAtoms === "string" &&
        item.coverage.amountAtoms.length <= 39 && DECIMAL_INTEGER.test(item.coverage.amountAtoms)
        ? {amountAtoms: item.coverage.amountAtoms} : {}),
      ...(item.coverage.mintAccountMatch === true ? {mintAccountMatch: true} : {}),
      ...(Number.isSafeInteger(item.coverage.accountSlot) && item.coverage.accountSlot >= 0
        ? {accountSlot: item.coverage.accountSlot} : {})
    },
    binding: identity
  };
  if (key === "pairCreatedAt" && value !== candidate.pairCreatedAt ||
      key === "marketCapUsd" && value !== candidate.marketCapUsd ||
      key === "tokenDecimals" && value !== candidate.decimals) {
    return unknownEvidence("normalized field disagrees with candidate summary", identity, item);
  }
  return record;
}

function reviewable(item, candidate, now, identity) {
  if (!isRecord(item) || !safeLabel(item.source) ||
      !safeReference(item.sourceVersion) ||
      item.source.length + item.sourceVersion.length + 1 > 256 ||
      !sameIdentity(item.identity, identity) ||
      !validTime(item.observedAt) || item.observedAt > candidate.sampledAt ||
      now < item.observedAt || now - item.observedAt > FILTER_POLICY.maxEvidenceAgeMs ||
      !Number.isSafeInteger(item.slot) || item.slot < 0 ||
      !isRecord(item.coverage) || item.coverage.complete !== true ||
      !isRecord(item.review) || item.review.status !== "REVIEWED" ||
      !safeReference(item.review.reviewerId) ||
      !safeReference(item.review.reviewId) ||
      !validTime(item.review.reviewedAt) || item.review.reviewedAt > now ||
      ((candidate.source === SYNTHETIC_SOURCE) !== (item.source === SYNTHETIC_SOURCE))) {
    return {reason: "source, review, identity, slot, coverage, or freshness is incomplete"};
  }
  return {metadata: item};
}

function supplementalRecord(item, value, coverage, candidate, now, identity) {
  const checked = reviewable(item, candidate, now, identity);
  if (!checked.metadata) return unknownEvidence(checked.reason, identity, item);
  return {
    value,
    source: candidate.source === SYNTHETIC_SOURCE
      ? SYNTHETIC_SOURCE : `${item.source} ${item.sourceVersion}`,
    observedAt: item.observedAt,
    slot: item.slot,
    verified: true,
    coverage: {
      ...coverage,
      complete: true,
      sourceVersion: item.sourceVersion,
      reviewId: item.review.reviewId
    },
    binding: identity
  };
}

function unknownWithReason(identity, reason, item = null) {
  return unknownEvidence(reason, identity, item);
}

function decimalAtoms(value) {
  return typeof value === "string" && value.length <= 39 && DECIMAL_INTEGER.test(value)
    ? BigInt(value) : null;
}

function percentageCeiling(numerator, denominator) {
  const scaled = (numerator * 100_000_000n + denominator - 1n) / denominator;
  return Number(scaled) / 1_000_000;
}

function ownerCensus(item, candidate, now, identity, tokenSupplyEvidence) {
  const checked = reviewable(item, candidate, now, identity);
  if (!checked.metadata) return {record: unknownEvidence(checked.reason, identity, item), owners: null};
  const value = item.value;
  const context = value?.context;
  const policy = item.coverage.supplyContextPolicy;
  if (!isRecord(value) || !Array.isArray(value.accounts) ||
      value.accounts.length === 0 || value.accounts.length > MAX_OWNER_ACCOUNTS ||
      !Array.isArray(item.coverage.exclusions) ||
      item.coverage.exclusions.length > 4 ||
      !item.coverage.exclusions.includes("selected_pool") ||
      !item.coverage.exclusions.includes("burned_supply") ||
      item.coverage.ownerResolutionComplete !== true ||
      item.coverage.accountCoverageComplete !== true ||
      value.pool !== candidate.pool ||
      !sameIdentity(context, identity) ||
      context.slot !== item.slot || context.observedAt !== item.observedAt ||
      context.commitment !== "finalized" ||
      !["same-finalized-slot", "distinct-finalized-slots-equal-supply"].includes(policy) ||
      !tokenSupplyEvidence || tokenSupplyEvidence.verified !== true ||
      tokenSupplyEvidence.source !== (candidate.source === SYNTHETIC_SOURCE
        ? SYNTHETIC_SOURCE : "Solana JSON-RPC getTokenSupply") ||
      !Number.isSafeInteger(tokenSupplyEvidence.slot) ||
      !Number.isSafeInteger(tokenSupplyEvidence.coverage?.accountSlot) ||
      tokenSupplyEvidence.coverage.mintAccountMatch !== true ||
      tokenSupplyEvidence.coverage.accountSlot !== tokenSupplyEvidence.slot ||
      !Array.isArray(value.selectedPoolTokenAccounts) ||
      value.selectedPoolTokenAccounts.length < 1 ||
      value.selectedPoolTokenAccounts.length > MAX_OWNER_ACCOUNTS ||
      !Array.isArray(value.burnedTokenAccounts) ||
      value.burnedTokenAccounts.length > MAX_OWNER_ACCOUNTS) {
    return {record: unknownWithReason(identity, "owner census is not complete or exceeds its bound", item), owners: null};
  }
  const selectedPoolAccounts = new Set(value.selectedPoolTokenAccounts);
  const burnedAccounts = new Set(value.burnedTokenAccounts);
  if (selectedPoolAccounts.size !== value.selectedPoolTokenAccounts.length ||
      burnedAccounts.size !== value.burnedTokenAccounts.length ||
      [...selectedPoolAccounts, ...burnedAccounts].some(account => !address(account)) ||
      [...selectedPoolAccounts].some(account => burnedAccounts.has(account))) {
    return {record: unknownWithReason(identity, "owner census exclusions are invalid or overlap", item), owners: null};
  }
  const declaredBurnedAtoms = decimalAtoms(item.coverage.burnedSupplyAtoms);
  if (declaredBurnedAtoms === null) {
    return {record: unknownWithReason(identity, "burned-supply exclusion amount is not established", item), owners: null};
  }
  const supply = decimalAtoms(value.supplyAtoms);
  const authoritativeSupply = decimalAtoms(candidate.tokenSupplyAtoms);
  const normalizedSupply = decimalAtoms(tokenSupplyEvidence.coverage.amountAtoms);
  if (supply === null || supply === 0n || authoritativeSupply === null ||
      normalizedSupply === null || authoritativeSupply !== normalizedSupply ||
      supply !== authoritativeSupply) {
    return {record: unknownWithReason(identity,
      "owner census supply does not match the source-bound mint supply", item), owners: null};
  }
  const sameSlot = context.slot === tokenSupplyEvidence.slot;
  if ((policy === "same-finalized-slot" && !sameSlot) ||
      (policy === "distinct-finalized-slots-equal-supply" && sameSlot)) {
    return {record: unknownWithReason(identity,
      "owner census and mint-supply slots contradict the declared snapshot policy", item), owners: null};
  }
  const seenAccounts = new Set();
  const owners = new Map();
  let allAtoms = 0n;
  let holderAtoms = 0n;
  let selectedPoolRows = 0;
  let burnedRows = 0;
  let burnedAtoms = 0n;
  for (const row of value.accounts) {
    if (!isRecord(row) || !address(row.account) || !address(row.owner) ||
        !["holder", "selected_pool", "burned_supply"].includes(row.classification) ||
        seenAccounts.has(row.account)) {
      return {record: unknownWithReason(identity, "owner census account identity or classification is invalid", item),
        owners: null};
    }
    const amount = decimalAtoms(row.amountAtoms);
    if (amount === null) {
      return {record: unknownWithReason(identity, "owner census account amount is invalid", item), owners: null};
    }
    seenAccounts.add(row.account);
    allAtoms += amount;
    if (row.classification === "selected_pool") {
      if (!selectedPoolAccounts.has(row.account)) {
        return {record: unknownWithReason(identity, "pool-excluded account is not bound to the selected pool", item),
          owners: null};
      }
      selectedPoolRows += 1;
    } else if (row.classification === "burned_supply") {
      if (!burnedAccounts.has(row.account)) {
        return {record: unknownWithReason(identity, "burned account is not in the reviewed exclusion list", item),
          owners: null};
      }
      burnedRows += 1;
      burnedAtoms += amount;
    } else {
      if (selectedPoolAccounts.has(row.account) || burnedAccounts.has(row.account)) {
        return {record: unknownWithReason(identity, "excluded account was misclassified as a holder", item),
          owners: null};
      }
      holderAtoms += amount;
      owners.set(row.owner, (owners.get(row.owner) ?? 0n) + amount);
    }
  }
  if (allAtoms !== supply || holderAtoms === 0n || selectedPoolRows !== selectedPoolAccounts.size ||
      burnedAtoms !== declaredBurnedAtoms || burnedAccounts.size !== burnedRows) {
    return {record: unknownWithReason(identity, "owner census does not reconcile supply and explicit pool/burn exclusions",
      item), owners: null};
  }
  const top10 = [...owners.values()].sort((left, right) => left > right ? -1 : left < right ? 1 : 0)
    .slice(0, 10).reduce((sum, amount) => sum + amount, 0n);
  const percent = percentageCeiling(top10, holderAtoms);
  return {
    record: supplementalRecord(item, percent, {
      aggregation: "owner",
      denominatorAtoms: holderAtoms.toString(),
      exclusions: ["selected_pool", "burned_supply"],
      accountCount: value.accounts.length,
      ownerCount: owners.size,
      supplyAtoms: supply.toString()
    }, candidate, now, identity),
    owners,
    supply,
    holderAtoms
  };
}

function developerHoldings(item, census, candidate, now, identity) {
  const checked = reviewable(item, candidate, now, identity);
  const value = item?.value;
  if (!checked.metadata || !census.owners || !census.holderAtoms ||
      item.slot !== census.record.slot || item.observedAt !== census.record.observedAt ||
      !isRecord(value) || value.method !== "documented" ||
      !Array.isArray(value.developerOwners) || value.developerOwners.length < 1 ||
      value.developerOwners.length > 100 ||
      !Array.isArray(value.evidenceIds) || value.evidenceIds.length < 1 ||
      value.evidenceIds.length > 16 ||
      !value.evidenceIds.every(safeReference)) {
    return unknownWithReason(identity, "developer identity attribution or owner census is unavailable", item);
  }
  const uniqueOwners = new Set();
  let held = 0n;
  for (const owner of value.developerOwners) {
    if (!address(owner) || uniqueOwners.has(owner)) {
      return unknownWithReason(identity, "developer attribution contains invalid or duplicate owners", item);
    }
    uniqueOwners.add(owner);
    held += census.owners.get(owner) ?? 0n;
  }
  const percent = percentageCeiling(held, census.holderAtoms);
  return supplementalRecord(item, percent, {
    associationMethod: "documented",
    attributionEvidenceIds: value.evidenceIds.slice()
  }, candidate, now, identity);
}

function priorRug(item, candidate, now, identity) {
  const checked = reviewable(item, candidate, now, identity);
  const value = item?.value;
  if (!checked.metadata || !isRecord(value) || typeof value.found !== "boolean" ||
      value.historyCoverage !== "complete" ||
      (value.found && (!safeLabel(value.attribution) ||
        !Array.isArray(value.evidenceIds) || value.evidenceIds.length < 1 ||
        value.evidenceIds.length > 16 || !value.evidenceIds.every(safeReference)))) {
    return unknownWithReason(identity, "complete reviewed attributable rug history is unavailable", item);
  }
  return supplementalRecord(item, {
    found: value.found,
    reviewed: true,
    historyCoverage: "complete",
    ...(value.found ? {attribution: value.attribution, evidenceIds: value.evidenceIds.slice()} : {})
  }, {historyCoverage: "complete"}, candidate, now, identity);
}

function bundledLaunch(item, census, candidate, now, identity) {
  const checked = reviewable(item, candidate, now, identity);
  const bundled = decimalAtoms(item?.value?.bundledSupplyAtoms);
  if (!checked.metadata || bundled === null || !census.supply ||
      item.slot !== census.record.slot || item.observedAt !== census.record.observedAt ||
      bundled > census.supply || item.coverage.bundleDetectionComplete !== true) {
    return unknownWithReason(identity, "complete bundled-launch supply evidence is unavailable", item);
  }
  const percent = percentageCeiling(bundled, census.supply);
  return supplementalRecord(item, percent, {
    denominatorAtoms: census.supply.toString(),
    bundledSupplyAtoms: bundled.toString(),
    detectionCoverage: "complete"
  }, candidate, now, identity);
}

function analystRecord(key, item, candidate, now, identity, providerEvidence) {
  const checked = reviewable(item, candidate, now, identity);
  const value = item?.value;
  if (!checked.metadata || !isRecord(value)) {
    return unknownWithReason(identity, checked.reason ?? "analyst evidence is missing", item);
  }
  let normalized;
  const coverage = {windowMs: item.coverage.windowMs};
  switch (key) {
    case "momentum15m":
      if (!isFiniteNumber(value.percent) || item.coverage.windowMs !== 15 * 60 * 1000) break;
      normalized = value.percent;
      break;
    case "uniqueBuyers1h":
      if (!Number.isSafeInteger(value.count) || value.count < 0 ||
          item.coverage.windowMs !== 60 * 60 * 1000 ||
          item.coverage.uniqueAddressesDeduplicated !== true) break;
      normalized = value.count;
      coverage.uniqueAddressesDeduplicated = true;
      break;
    case "buySellUsdRatio1h":
      if (!isFiniteNumber(value.buyVolumeUsd) || value.buyVolumeUsd <= 0 ||
          !isFiniteNumber(value.sellVolumeUsd) || value.sellVolumeUsd <= 0 ||
          item.coverage.windowMs !== 60 * 60 * 1000) break;
      normalized = null;
      coverage.buyVolumeUsd = value.buyVolumeUsd;
      coverage.sellVolumeUsd = value.sellVolumeUsd;
      break;
    case "holderGrowthPct1h":
      if (!Number.isSafeInteger(value.startHolders) || value.startHolders <= 0 ||
          !Number.isSafeInteger(value.endHolders) || value.endHolders < 0 ||
          item.coverage.windowMs !== 60 * 60 * 1000) break;
      normalized = (value.endHolders - value.startHolders) / value.startHolders * 100;
      coverage.startHolders = value.startHolders;
      coverage.endHolders = value.endHolders;
      break;
    case "liquidityMarketCapPct": {
      const liquidity = providerEvidence.liquidityUsd?.value;
      const marketCap = providerEvidence.marketCapUsd?.value;
      if (!isFiniteNumber(value.liquidityUsd) || !isFiniteNumber(value.marketCapUsd) ||
          value.liquidityUsd !== liquidity || value.marketCapUsd !== marketCap ||
          marketCap <= 0) break;
      normalized = value.liquidityUsd / value.marketCapUsd * 100;
      coverage.liquidityUsd = value.liquidityUsd;
      coverage.marketCapUsd = value.marketCapUsd;
      break;
    }
    case "qualifiedSmartWallets":
      if (!Number.isSafeInteger(value.count) || value.count < 0 ||
          !safeReference(value.allowlistId) ||
          !Array.isArray(value.evidenceIds) || value.evidenceIds.length < 1 ||
          value.evidenceIds.length > 16 || !value.evidenceIds.every(safeReference)) break;
      normalized = value.count;
      coverage.allowlistId = value.allowlistId;
      coverage.provenanceEvidenceIds = value.evidenceIds.slice();
      break;
    default:
      break;
  }
  if (normalized === undefined || (normalized !== null && !Number.isFinite(normalized))) {
    return unknownWithReason(identity, `${key} source values or coverage are incomplete`, item);
  }
  return supplementalRecord(item, normalized, coverage, candidate, now, identity);
}

function outputCandidate(candidate, evidence, analystEvidence) {
  const output = {};
  for (const key of [
    "chainId", "mint", "pool", "quote", "source", "sampledAt", "pairCreatedAt",
    "marketCapUsd", "decimals", "tokenSupplyAtoms"
  ]) {
    if (Object.hasOwn(candidate, key) &&
        (typeof candidate[key] === "string" || typeof candidate[key] === "number" ||
          candidate[key] === null)) {
      output[key] = candidate[key];
    }
  }
  output.evidence = evidence;
  output.analystEvidence = analystEvidence;
  return output;
}

export function adaptMarketEvidence({
  providerCandidate,
  evidence = {},
  analystEvidence = {},
  now,
  holdUntil = null
} = {}) {
  if (invalidCandidate(providerCandidate) || !validTime(now) ||
      !isRecord(evidence) || !isRecord(analystEvidence)) {
    throw new TypeError("candidate, evidence maps, and evaluation time are required");
  }
  const candidate = providerCandidate;
  const identity = identityFor(candidate);
  const normalizedEvidence = {};
  for (const key of BASE_FILTER_KEYS) {
    normalizedEvidence[key] = providerEvidence(candidate, key, now, identity);
  }

  const lp = evidence.lpProtection;
  const lpChecked = reviewable(lp, candidate, now, identity);
  const lpValue = lp?.value;
  const lpValid = lpChecked.metadata && isRecord(lpValue) && lpValue.pool === candidate.pool &&
    ((lpValue.model === "burn" && safeReference(lpValue.burnEvidenceId)) ||
      (lpValue.model === "lock" && validTime(lpValue.lockedUntil) &&
        validTime(holdUntil) && holdUntil > now));
  normalizedEvidence.lpProtection = lpValid
    ? supplementalRecord(lp, {
        verified: true,
        model: lpValue.model,
        pool: lpValue.pool,
        ...(lpValue.model === "burn"
          ? {burnEvidenceId: lpValue.burnEvidenceId}
          : {lockedUntil: lpValue.lockedUntil})
      }, {pool: candidate.pool, reviewedProtection: true},
      candidate, now, identity)
    : unknownWithReason(identity, "selected-pool LP burn/lock evidence is missing, mismatched, or does not cover the hold",
      lp);

  const census = ownerCensus(
    evidence.ownerCensus, candidate, now, identity, normalizedEvidence.tokenDecimals);
  normalizedEvidence.top10OwnerPct = census.record;
  normalizedEvidence.devAssociatedPct = developerHoldings(
    evidence.developerAttribution, census, candidate, now, identity);
  normalizedEvidence.crediblePriorRug = priorRug(evidence.priorRug, candidate, now, identity);
  normalizedEvidence.bundledLaunchPct = bundledLaunch(
    evidence.bundledLaunch, census, candidate, now, identity);

  const normalizedAnalyst = {};
  for (const key of ANALYST_KEYS) {
    normalizedAnalyst[key] = analystRecord(key, analystEvidence[key], candidate, now, identity,
      normalizedEvidence);
  }
  const wallets = analystEvidence.qualifiedSmartWallets;
  const walletChecked = reviewable(wallets, candidate, now, identity);
  const walletValue = wallets?.value;
  const smartWalletAllowlist = walletChecked.metadata && isRecord(walletValue) &&
    Number.isSafeInteger(walletValue.count) && walletValue.count >= 0 &&
    safeReference(walletValue.allowlistId)
    ? {
        status: "VERIFIED",
        provenance: candidate.source === SYNTHETIC_SOURCE ? SYNTHETIC_SOURCE
          : `${wallets.source} ${wallets.sourceVersion} ${wallets.review.reviewId}`
      }
    : {status: "UNSET", provenance: null};

  const resultCandidate = outputCandidate(candidate, normalizedEvidence, normalizedAnalyst);
  const complete = [...Object.values(normalizedEvidence), ...Object.values(normalizedAnalyst)]
    .every(item => item.verified === true) && smartWalletAllowlist.status === "VERIFIED";
  return {
    status: complete ? "NORMALIZED" : "PARTIAL",
    version: MARKET_EVIDENCE_ADAPTER_VERSION,
    candidate: resultCandidate,
    smartWalletAllowlist,
    syntheticFixtureOnly: candidate.source === SYNTHETIC_SOURCE,
    realDataEntryEligible: false,
    executionAuthorized: false
  };
}
