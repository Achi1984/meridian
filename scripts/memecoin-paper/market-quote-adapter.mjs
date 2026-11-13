const DEFAULT_ORIGIN = 'https://api.dexscreener.com';
const DEFAULT_MAX_DURATION_MS = 5000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

const unknown = (reason, extra = {}) => Object.freeze({
  status: 'UNKNOWN',
  reason,
  evidenceComplete: false,
  executionAuthorized: false,
  ...extra
});

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function provenanceKnown(value) {
  return value && typeof value === 'object' &&
    typeof value.source === 'string' && value.source.trim() &&
    typeof value.receiptTime === 'string' && Number.isFinite(Date.parse(value.receiptTime));
}

function normaliseComponent(value, name) {
  if (!value || typeof value !== 'object' || !finiteNonNegative(value.amount) || !provenanceKnown(value.provenance)) {
    return unknown(`MISSING_OR_UNPROVEN_${name.toUpperCase()}`);
  }
  return {amount: value.amount, provenance: value.provenance};
}

function normaliseLeg(leg, name) {
  if (!leg || typeof leg !== 'object') return unknown(`MISSING_${name.toUpperCase()}_LEG`);
  const required = ['asset', 'quoteCurrency', 'poolId', 'routeId', 'sourceTime', 'receiptTime'];
  if (required.some(key => typeof leg[key] !== 'string' || !leg[key].trim())) return unknown(`MALFORMED_${name.toUpperCase()}_IDENTITY`);
  const sourceMs = Date.parse(leg.sourceTime);
  const receiptMs = Date.parse(leg.receiptTime);
  if (!Number.isFinite(sourceMs) || !Number.isFinite(receiptMs) || receiptMs < sourceMs) {
    return unknown(`MALFORMED_${name.toUpperCase()}_CHRONOLOGY`);
  }
  if (!finiteNonNegative(leg.grossInput) || !finiteNonNegative(leg.grossOutput)) {
    return unknown(`MALFORMED_${name.toUpperCase()}_GROSS`);
  }
  const components = {};
  for (const key of ['fees', 'slippage', 'impact', 'network']) {
    const component = normaliseComponent(leg[key], key);
    if (component.status === 'UNKNOWN') return component;
    components[key] = component;
  }
  return {...leg, sourceMs, receiptMs, components};
}

export function evaluateCausalQuoteChain({entry, exit, fx, now = new Date().toISOString(), staleAfterMs = DEFAULT_STALE_AFTER_MS} = {}) {
  const entryLeg = normaliseLeg(entry, 'entry');
  if (entryLeg.status === 'UNKNOWN') return entryLeg;
  const exitLeg = normaliseLeg(exit, 'exit');
  if (exitLeg.status === 'UNKNOWN') return exitLeg;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) return unknown('MALFORMED_CLOCK');
  if (exitLeg.sourceMs < entryLeg.sourceMs) return unknown('EXIT_BEFORE_ENTRY');
  if (entryLeg.asset !== exitLeg.asset || entryLeg.quoteCurrency !== exitLeg.quoteCurrency ||
      entryLeg.poolId !== exitLeg.poolId || entryLeg.routeId !== exitLeg.routeId) {
    return unknown('MIXED_QUOTE_IDENTITY');
  }
  if (nowMs < entryLeg.sourceMs || nowMs < exitLeg.sourceMs) return unknown('FUTURE_SOURCE_TIME');
  if (nowMs - entryLeg.sourceMs > staleAfterMs || nowMs - exitLeg.sourceMs > staleAfterMs) return unknown('STALE_QUOTE');
  if (!fx || typeof fx !== 'object' || !finiteNonNegative(fx.rate) || fx.rate <= 0 ||
      typeof fx.pair !== 'string' || !fx.pair.trim() || !provenanceKnown(fx.provenance)) {
    return unknown('MISSING_OR_UNPROVEN_FX');
  }
  const entryCosts = Object.values(entryLeg.components).reduce((sum, component) => sum + component.amount, 0);
  const exitCosts = Object.values(exitLeg.components).reduce((sum, component) => sum + component.amount, 0);
  const entryCost = entryLeg.grossInput + entryCosts;
  const exitProceeds = exitLeg.grossOutput - exitCosts;
  if (exitProceeds < 0) return unknown('NEGATIVE_EXIT_PROCEEDS');
  const netQuote = exitProceeds - entryCost;
  return Object.freeze({
    status: 'READY',
    evidenceComplete: true,
    executionAuthorized: false,
    asset: entryLeg.asset,
    quoteCurrency: entryLeg.quoteCurrency,
    poolId: entryLeg.poolId,
    routeId: entryLeg.routeId,
    entry: Object.freeze({sourceTime: entryLeg.sourceTime, grossInput: entryLeg.grossInput, totalCosts: entryCosts}),
    exit: Object.freeze({sourceTime: exitLeg.sourceTime, grossOutput: exitLeg.grossOutput, totalCosts: exitCosts}),
    fx: Object.freeze({rate: fx.rate, pair: fx.pair, provenance: fx.provenance}),
    netQuote,
    netUsd: netQuote * fx.rate,
    breakevenQuote: entryCost,
    provenance: Object.freeze({entrySourceTime: entryLeg.sourceTime, exitSourceTime: exitLeg.sourceTime, fxSource: fx.provenance.source})
  });
}

function boundedTransport(transport, url, maxDurationMs, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, {once: true});
  let timer;
  const operation = Promise.resolve().then(() => transport(url, {method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal}));
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve({timeout: true}); }, maxDurationMs);
  });
  return Promise.race([
    operation.then(value => ({value}), () => ({failed: true})),
    timeout
  ]).then(result => result.timeout ? unknown('TIMEOUT') : result.failed ? unknown('TRANSPORT_FAILED') : result.value)
    .finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) controller.abort();
      void operation.catch(() => {});
    });
}

export function createMarketQuoteAdapter({transport = null, origin = DEFAULT_ORIGIN, maxDurationMs = DEFAULT_MAX_DURATION_MS, maxBytes = DEFAULT_MAX_BYTES} = {}) {
  if (typeof origin !== 'string' || !/^https?:\/\//.test(origin)) throw new TypeError('origin must be an absolute HTTP(S) origin');
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs <= 0) throw new TypeError('maxDurationMs must be a positive safe integer');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('maxBytes must be a positive safe integer');
  const expectedOrigin = origin.replace(/\/$/, '');
  return Object.freeze({
    async request({path = '/', signal} = {}) {
      if (typeof transport !== 'function') return unknown('TRANSPORT_UNAVAILABLE');
      let url;
      try { url = new URL(path, expectedOrigin + '/'); } catch { return unknown('MALFORMED_URL'); }
      if (url.origin !== expectedOrigin || url.username || url.password) return unknown('ORIGIN_MISMATCH');
      const response = await boundedTransport(transport, url.toString(), maxDurationMs, signal);
      if (response?.status === 'UNKNOWN') return response;
      let body = response;
      if (response && typeof response.json === 'function') {
        try { body = await response.json(); } catch { return unknown('MALFORMED_RESPONSE'); }
      }
      let serialized;
      try { serialized = JSON.stringify(body); } catch { return unknown('MALFORMED_RESPONSE'); }
      if (Buffer.byteLength(serialized, 'utf8') > maxBytes) return unknown('RESPONSE_TOO_LARGE');
      return Object.freeze({status: 'RECEIVED', executionAuthorized: false, evidenceComplete: false, body});
    },
    evaluate: evaluateCausalQuoteChain
  });
}

export const MARKET_QUOTE_ADAPTER_DEFAULTS = Object.freeze({
  origin: DEFAULT_ORIGIN,
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  staleAfterMs: DEFAULT_STALE_AFTER_MS,
  executionAuthorized: false
});
