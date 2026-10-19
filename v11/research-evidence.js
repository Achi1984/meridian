// Read-only presentation of dated receipts. This is not a verifier or an authorization API.
export const RESEARCH_EVIDENCE_SCHEMA = 'MERIDIAN_M11_RESEARCH_EVIDENCE_V1';
const ASSETS = Object.freeze(['XBTUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LINKUSD', 'AVAXUSD', 'SUIUSD']);
export const B17_EVIDENCE_SNAPSHOT = Object.freeze({
  schemaVersion: RESEARCH_EVIDENCE_SCHEMA,
  subject: 'B1-7',
  asOf: '2026-10-19',
  source: Object.freeze({
    state: 'REVIEWED', pr: 892, commit: '6f720373af5439af70c54e6cb2f1c17abaf8b877',
    reviewRef: 'https://github.com/Achi1984/meridian/issues/639#issuecomment-6255139258'
  }),
  d1: Object.freeze({
    state: 'VERIFIED_NOT_FROZEN', assets: ASSETS, rowsPerAsset: 955,
    start: '2024-02-19', end: '2026-09-30',
    rawHashes: 'PASS', selectedSeriesHashes: 'PASS', schemaAndQuality: 'PASS', synchronizedDays: 'PASS',
    manifest: 'NOT_FROZEN', integration: 'PENDING', pr: 896,
    reviewRef: 'https://github.com/Achi1984/meridian/issues/895#issuecomment-6271222342'
  })
});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const reference = value => typeof value === 'string' && /^https:\/\/github\.com\/Achi1984\/meridian\/issues\/[1-9]\d*#issuecomment-[1-9]\d*$/.test(value);
const prNumber = value => Number.isSafeInteger(value) && value > 0;
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function unknown() {
  return {state: 'UNKNOWN', label: 'Unbekannt · Prüfbeleg fehlt oder ist widersprüchlich.', provenance: 'Kein gültiger Beleg.'};
}

export function projectResearchEvidence(evidence) {
  const result = {
    subject: 'B1-7', asOf: null, source: unknown(), d1: unknown(),
    execution: {state: 'BLOCKED', label: 'D2 / Strategieausführung gesperrt · separate Freigabe erforderlich.'},
    paper: {state: 'BLOCKED', label: 'Paper-Betrieb gesperrt · separate Freigabe erforderlich.'},
    live: {state: 'BLOCKED', label: 'Live-Betrieb gesperrt · separate Freigabe erforderlich.'}
  };
  if (!object(evidence) || Object.keys(evidence).some(key => !['schemaVersion', 'subject', 'asOf', 'source', 'd1'].includes(key)) || evidence.schemaVersion !== RESEARCH_EVIDENCE_SCHEMA ||
      evidence.subject !== 'B1-7' || !date(evidence.asOf)) return result;
  result.asOf = evidence.asOf;
  const source = evidence.source;
  if (exactKeys(source, ['state', 'pr', 'commit', 'reviewRef']) && source.state === 'REVIEWED' && prNumber(source.pr) &&
      typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit) && reference(source.reviewRef)) {
    result.source = {state: 'REVIEWED', label: 'Quellcode unabhängig geprüft laut datiertem Prüfbeleg · keine Strategievalidierung.',
      provenance: `PR #${source.pr} · Merge ${source.commit} · ${source.reviewRef}`};
  }
  const d1 = evidence.d1;
  if (exactKeys(d1, ['state', 'assets', 'rowsPerAsset', 'start', 'end', 'rawHashes', 'selectedSeriesHashes', 'schemaAndQuality', 'synchronizedDays', 'manifest', 'integration', 'pr', 'reviewRef']) && d1.state === 'VERIFIED_NOT_FROZEN' && Array.isArray(d1.assets) &&
      d1.assets.length === ASSETS.length && ASSETS.every((asset, index) => d1.assets[index] === asset) &&
      evidence.asOf >= d1.end && d1.rowsPerAsset === 955 && d1.start === '2024-02-19' && d1.end === '2026-09-30' &&
      ['rawHashes', 'selectedSeriesHashes', 'schemaAndQuality', 'synchronizedDays'].every(key => d1[key] === 'PASS') &&
      d1.manifest === 'NOT_FROZEN' && d1.integration === 'PENDING' && prNumber(d1.pr) && reference(d1.reviewRef)) {
    result.d1 = {state: 'VERIFIED_NOT_FROZEN',
      label: 'D1 technisch geprüft laut datiertem Prüfbeleg · 7 × 955 Tageswerte · 19.02.2024–30.09.2026 · Manifest NOT_FROZEN.',
      provenance: `Datei- und Selected-Series-Hashes, Schema, Datenqualität und Synchronität: PASS laut Prüfbeleg. ${d1.reviewRef} · PR #${d1.pr}: finale Abnahme und Integration zum Belegstand ausstehend.`};
  }
  return result;
}
