import {createHash} from 'node:crypto';

export const SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA =
  'SPOT_PAPER_PAIRED_REPORT_ENVELOPE_V1';
export const SPOT_PAPER_PAIRED_REPORT_MAX_BYTES = 256 * 1024;

export function canonicalSpotPaperPairedReportJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError('invalid_json_number');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSpotPaperPairedReportJson).join(',')}]`;
  }
  if (!value || typeof value !== 'object') throw new TypeError('invalid_json_value');
  return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalSpotPaperPairedReportJson(value[key])}`)
    .join(',')}}`;
}

export function spotPaperPairedReportDigest(envelope) {
  const canonical = canonicalSpotPaperPairedReportJson(envelope);
  const bytes = Buffer.from(canonical, 'utf8');
  if (bytes.length > SPOT_PAPER_PAIRED_REPORT_MAX_BYTES) {
    throw new RangeError('paired_report_too_large');
  }
  return createHash('sha256').update(bytes).digest('hex');
}
