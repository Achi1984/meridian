export const PROTOCOL_ID = 'MERIDIAN-B1-7-PROTOCOL-R2-20261018';
export const PROTOCOL_SHA256 = '7fda5993dffa298183e3c4b757e4cdaace4754f8a7ff11b4538e1d39dd9e1aed';
export const IMPLEMENTATION_ID = 'MERIDIAN-B1-7-ENGINE-R2';
export const ASSETS = Object.freeze([
  'XBTUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LINKUSD', 'AVAXUSD', 'SUIUSD'
]);
export const INPUT = Object.freeze({
  sourceCommit: '1c7b6dccd886f57e866c7d359c091b1e72a193ea',
  firstTimestamp: '2024-02-19T00:00:00Z',
  rowCount: 955,
  normalizedHashes: Object.freeze({
    XBTUSD: 'f2e94a03fbe61f37295b2249d5c3a4d324d13fcfb5d5b41f2ed4d7dfe2183bb9',
    ETHUSD: 'fbb7915af33d3c32db1cf368a171ed633090406c39da38aae90ac0d3876754bb',
    SOLUSD: 'caff8ea08d3548b2d8c704cc17a940754a70e23f60e44716324c464929bc18ca',
    XRPUSD: 'bd006dfcbf052fb516e2d5e5a97d0570cf093e577c3c83752f2f3b7310fc52a7',
    LINKUSD: '82682634f645ab5ca1dac4065cc0d490d343ea24b61463bcc2b6406894785518',
    AVAXUSD: 'a4350bf73b44a45770bb173541133e4a04e847a07d74231ad6b5bbd7d6d06887',
    SUIUSD: '0b35eb5598a336d8d4485b15adc2a4b4a716c967ff700eff3802386c31beda79'
  })
});
export const SEGMENTS = Object.freeze({
  development: Object.freeze({
    id: 'development',
    startIndex: 410,
    endIndex: 589,
    firstTimestamp: '2025-04-04T00:00:00Z',
    lastTimestamp: '2025-09-30T00:00:00Z',
    rows: 180
  }),
  diagnostic: Object.freeze({
    id: 'diagnostic',
    startIndex: 590,
    endIndex: 954,
    firstTimestamp: '2025-10-01T00:00:00Z',
    lastTimestamp: '2026-09-30T00:00:00Z',
    rows: 365
  })
});
export const VARIANTS = Object.freeze([
  Object.freeze({id: 'primary-n30-f25', window: 30, floor: 0.25}),
  Object.freeze({id: 'neighbour-n20-f25', window: 20, floor: 0.25}),
  Object.freeze({id: 'neighbour-n45-f25', window: 45, floor: 0.25}),
  Object.freeze({id: 'neighbour-n30-f20', window: 30, floor: 0.20}),
  Object.freeze({id: 'neighbour-n30-f35', window: 30, floor: 0.35})
]);
export const SCENARIOS = Object.freeze([
  Object.freeze({id: 'base-85bp', costRate: 0.0085, delayDays: 0}),
  Object.freeze({id: 'stress-160bp', costRate: 0.0160, delayDays: 0}),
  Object.freeze({id: 'stress-160bp-delay-1d', costRate: 0.0160, delayDays: 1})
]);
export const BUDGET = Object.freeze({
  paths: 44,
  pathMs: 60000,
  totalMs: 1800000,
  outputBytes: 1048576,
  attemptsPerPath: 1
});

const ROW_KEYS = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'trades'];
const PLAIN = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function exactDataObject(value, keys) {
  if (!PLAIN(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
}

function failure(code, path, detail = null) {
  return {code, path, detail};
}

export function validateSeries(seriesByAsset) {
  const errors = [];
  try {
    if (!exactDataObject(seriesByAsset, ASSETS)) {
      return {ok: false, errors: [failure('ASSET_SET_INVALID', 'seriesByAsset')]};
    }
    const firstTimestamp = INPUT.firstTimestamp;
    const expectedLength = INPUT.rowCount;
    const expectedStart = Date.parse(firstTimestamp);
    const dayMs = 86400000;
    let referenceTimestamps = null;

    for (const asset of ASSETS) {
      const descriptor = Object.getOwnPropertyDescriptor(seriesByAsset, asset);
      const rows = descriptor.value;
      if (!Array.isArray(rows) || rows.length !== expectedLength) {
        errors.push(failure('ROW_COUNT_INVALID', asset, {expected: expectedLength}));
        continue;
      }
      const arrayKeys = Reflect.ownKeys(rows);
      if (arrayKeys.length !== rows.length + 1 ||
        arrayKeys.some(key => key !== 'length' &&
          (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))) {
        errors.push(failure('ARRAY_SHAPE_INVALID', asset));
        continue;
      }
      const timestamps = [];
      for (let index = 0; index < rows.length; index++) {
        const rowDescriptor = Object.getOwnPropertyDescriptor(rows, String(index));
        const row = rowDescriptor?.value;
        if (!rowDescriptor?.enumerable || !Object.hasOwn(rowDescriptor, 'value') ||
          !exactDataObject(row, ROW_KEYS)) {
          errors.push(failure('ROW_SCHEMA_INVALID', `${asset}[${index}]`));
          break;
        }
        if (!validTimestamp(row.timestamp)) {
          errors.push(failure('TIMESTAMP_INVALID', `${asset}[${index}].timestamp`));
          break;
        }
        const timestamp = Date.parse(row.timestamp);
        const expectedTimestamp = expectedStart + index * dayMs;
        if (timestamp !== expectedTimestamp) {
          errors.push(failure(
            timestamp <= expectedStart + (index - 1) * dayMs ? 'TIMESTAMP_ORDER_INVALID' : 'CALENDAR_GAP',
            `${asset}[${index}].timestamp`,
            {expected: new Date(expectedTimestamp).toISOString(), actual: row.timestamp}
          ));
          break;
        }
        timestamps.push(row.timestamp);
        const values = ['open', 'high', 'low', 'close', 'volume', 'trades'].map(key => row[key]);
        if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
          errors.push(failure('OHLC_NUMBER_INVALID', `${asset}[${index}]`));
          break;
        }
        const [open, high, low, close, volume, trades] = values;
        if (open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
          high < Math.max(open, close) || low > Math.min(open, close) || high < low ||
          volume < 0 || trades < 0 || !Number.isInteger(trades)) {
          errors.push(failure('OHLC_RANGE_INVALID', `${asset}[${index}]`));
          break;
        }
      }
      if (timestamps.length === rows.length) {
        if (referenceTimestamps === null) referenceTimestamps = timestamps;
        else if (timestamps.some((timestamp, index) => timestamp !== referenceTimestamps[index])) {
          errors.push(failure('ASSET_CALENDAR_MISMATCH', asset));
        }
      }
    }

    if (errors.length === 0) {
      for (const segment of Object.values(SEGMENTS)) {
        if (referenceTimestamps[segment.startIndex] !== segment.firstTimestamp ||
          referenceTimestamps[segment.endIndex] !== segment.lastTimestamp) {
          errors.push(failure('SEGMENT_CALENDAR_MISMATCH', segment.id));
        }
      }
    }
  } catch {
    errors.push(failure('UNSAFE_INPUT_SHAPE', 'seriesByAsset'));
  }
  return {ok: errors.length === 0, errors};
}

export function validateSourceIdentity(source) {
  if (!PLAIN(source) || !Object.hasOwn(source, 'kind')) {
    return {ok: false, error: failure('SOURCE_IDENTITY_INVALID', 'source')};
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(source, 'kind');
  if (!kindDescriptor?.enumerable || !Object.hasOwn(kindDescriptor, 'value')) {
    return {ok: false, error: failure('SOURCE_IDENTITY_INVALID', 'source.kind')};
  }
  const kind = kindDescriptor.value;
  if (kind === 'SYNTHETIC_FIXTURE') {
    return exactDataObject(source, ['kind'])
      ? {ok: true}
      : {ok: false, error: failure('SOURCE_IDENTITY_INVALID', 'source')};
  }
  if (kind === 'FROZEN_RESEARCH_INPUT') {
    if (!exactDataObject(source, ['kind', 'commit', 'files']) ||
      source.commit !== INPUT.sourceCommit ||
      !exactDataObject(source.files, ASSETS) ||
      ASSETS.some(asset => source.files[asset] !== INPUT.normalizedHashes[asset])) {
      return {ok: false, error: failure('FROZEN_IDENTITY_MISMATCH', 'source')};
    }
    return {ok: true};
  }
  return {ok: false, error: failure('SOURCE_KIND_INVALID', 'source.kind')};
}
