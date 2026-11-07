import {isSpotPaperDashboardDto} from '../scripts/spot-paper-report-bridge/contract.mjs?v=B16-M11-FIX12';

function amount(value, signed = false) {
  if (value === null) return {label: 'UNKNOWN · missing is not zero', tone: 'tone-muted'};
  if (!signed || value === '0') return {label: `${value} cents`, tone: 'tone-muted'};
  const negative = value.startsWith('-');
  return {
    label: `${negative ? '−' : '+'}${negative ? value.slice(1) : value} cents`,
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
