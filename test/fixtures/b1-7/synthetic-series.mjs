import {ASSETS, INPUT} from '../../../scripts/research/b1-7/validate.mjs';

export function createSyntheticSeries() {
  const series = Object.fromEntries(ASSETS.map(asset => [asset, []]));
  const previousClose = new Array(ASSETS.length).fill(100);
  const firstDay = Date.parse(INPUT.firstTimestamp);

  for (let index = 0; index < INPUT.rowCount; index++) {
    const timestamp = new Date(firstDay + index * 86400000).toISOString().replace('.000Z', 'Z');
    for (let assetIndex = 0; assetIndex < ASSETS.length; assetIndex++) {
      const asset = ASSETS[assetIndex];
      const prior = previousClose[assetIndex];
      const dailyReturn = 0.0002 +
        0.0017 * Math.sin(index * 0.079 + assetIndex * 0.61) +
        0.0008 * Math.cos(index * 0.033 + assetIndex * 0.37);
      const close = prior * (1 + dailyReturn);
      const open = prior * (1 + 0.0005 * Math.sin(index * 0.21 + assetIndex));
      const high = Math.max(open, close) * 1.004;
      const low = Math.min(open, close) * 0.996;
      series[asset].push({
        timestamp,
        open,
        high,
        low,
        close,
        volume: 1000 + index + assetIndex,
        trades: 10 + ((index + assetIndex) % 100)
      });
      previousClose[assetIndex] = close;
    }
  }
  return series;
}

export function createZeroVolatilityVariantSeries() {
  const series = createSyntheticSeries();
  for (let index = 460; index < 480; index++) {
    for (const asset of ASSETS) {
      const row = series[asset][index];
      const previousClose = series[asset][index - 1].close;
      row.open = previousClose;
      row.close = previousClose * 1.001;
      row.high = row.close * 1.004;
      row.low = row.open * 0.996;
    }
  }
  return series;
}
