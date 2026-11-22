// Named engineering fixture only. No market data, caller parameters or clock.
export const GENERATED_ARENA_FIXTURE_ID = 'eight-symbol-daily-240-v1';
export function generatedArenaFixture() {
  const day = 86400000, start = Date.UTC(2025, 0, 1);
  const symbols = ['BTC', 'ETH', 'SOL', 'XRP', 'HBAR', 'LINK', 'AVAX', 'SUI'];
  const data = Object.fromEntries(symbols.map((symbol, index) => [symbol,
    Array.from({ length: 240 }, (_, i) => {
      const open = 100 + index * 10 + i * 0.2;
      const close = open + 0.1;
      return { openTime: start + i * day, open, high: close + 1, low: open - 1,
        close, closeTime: start + (i + 1) * day - 1 };
    })]));
  return { data, asOf: start + 240 * day - 1, sourceKind: 'SYNTHETIC',
    quoteCurrency: 'USDT', liquidateAtEnd: false };
}
