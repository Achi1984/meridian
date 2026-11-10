import {isSpotPaperDashboardDto} from '../scripts/spot-paper-report-bridge/contract.mjs?v=B16-M11-FIX15';

function amount(value, signed = false) {
  if (value === null) return {label: 'Unbekannt', tone: 'tone-muted'};
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const whole = digits.slice(0, -2) || '0';
  const groupedWhole = [];
  for (let end = whole.length; end > 0; end -= 3) {
    groupedWhole.push(whole.slice(Math.max(0, end - 3), end));
  }
  const formatted = `${groupedWhole.reverse().join('.')},${digits.slice(-2).padStart(2, '0')} €`;
  if (!signed || value === '0') return {label: formatted, tone: 'tone-muted'};
  return {
    label: `${negative ? '−' : '+'}${formatted}`,
    tone: negative ? 'tone-danger' : 'tone-safe'
  };
}

function freshness(completedAt, now, staleAfterMs) {
  const timestamp = Date.parse(completedAt);
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0 || timestamp > now) {
    return {status: 'UNKNOWN', ageMs: null};
  }
  const ageMs = now - timestamp;
  return {status: ageMs > staleAfterMs ? 'STALE' : 'WITHIN_DISPLAY_POLICY', ageMs};
}

export function presentSpotPaperCockpit(dto, {now = null, staleAfterMs = null} = {}) {
  if (!isSpotPaperDashboardDto(dto)) return {available: false};
  const age = freshness(dto.snapshot.completedAt, now, staleAfterMs);
  return {
    available: true,
    title: 'BTC/EUR Paper – echte Marktdaten, simulierte Trades',
    identity: dto.identity,
    snapshot: dto.snapshot,
    freshness: age,
    startingBalance: amount(dto.startingBalanceCents),
    cash: amount(dto.cashCents),
    equity: amount(dto.equityCents),
    realizedPnl: amount(dto.realizedPnlCents, true),
    unrealizedPnl: amount(dto.unrealizedPnlCents, true),
    fees: amount(dto.feesCents),
    buys: dto.buyCount,
    sells: dto.sellCount,
    fills: dto.fillCount,
    inventory: dto.openInventory,
    duration: dto.duration,
    coverage: dto.coverage,
    verification: dto.verification
  };
}
