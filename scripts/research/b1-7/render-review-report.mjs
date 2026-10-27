import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  HISTORICAL_EXPORT_SCHEMA, MAX_HISTORICAL_EXPORT_BYTES, parseArenaHistoricalExport
} from '../../../v11/arena-historical-export.js';
import {
  HISTORICAL_EXPORT_V2_SCHEMA, parseArenaHistoricalExportV2
} from '../../../v11/arena-historical-export-v2.js';

export const MAX_REVIEW_REPORT_BYTES = 1024 * 1024;
const PATH_FIELDS = [
  'attempts','computed','rows','dailyReturnCount','dailyReturnSd','startEquity','endEquity',
  'meanHeldTarget','meanRealizedExposure','meanTargetRealizedMismatch','meanAbsoluteTargetMismatch',
  'maxAbsoluteTargetMismatch','maxConcentration','maxDrawdownDuration','netReturn','sampledDrawdown',
  'totalCosts','turnoverNotional','turnoverOnInitialEquity','targetExposure','fillCostCount',
  'cancelledInstructionCount','diagnosticRescaling','observationClass','tradeCRV'
];
const AUTHORITY_FIELDS = [
  'executionAuthorized','promotionAuthorized','profitabilityInferred','strategyPnlAuthorized',
  'discoveryAuthorized','validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized'
];
const REPORT_ERRORS = new Set([
  'REPORT_ARGUMENTS_INVALID','REPORT_INPUT_LIMIT','REPORT_INPUT_INVALID',
  'REPORT_OUTPUT_LIMIT','REPORT_IO_FAILED'
]);

function stableJson(value, depth = 0, budget = {nodes: 0}) {
  if (depth > 16 || ++budget.nodes > 100_000) throw new Error('REPORT_INPUT_INVALID');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('REPORT_INPUT_INVALID');
    return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item, depth + 1, budget)).join(',')}]`;
  }
  if (typeof value === 'object' &&
      [Object.prototype,null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableJson(value[key], depth + 1, budget)}`).join(',')}}`;
  }
  throw new Error('REPORT_INPUT_INVALID');
}

function escapeText(value) {
  const text = typeof value === 'string' ? value : String(value);
  return text.replace(/[\u0000-\u001f\u007f]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/[!"#$%'()*+,\-./:;=?@[\\\]^_`{|}~]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function valueText(value) {
  return escapeText(value === undefined ? 'NOT_SUPPLIED' :
    value !== null && typeof value === 'object' ? stableJson(value) :
      value === null ? 'null' : String(value));
}

function table(headers, rows) {
  const line = cells => `| ${cells.join(' | ')} |`;
  return [
    line(headers.map(escapeText)),
    line(headers.map(() => '---')),
    ...rows.map(row => line(row.map(valueText)))
  ].join('\n');
}

function descriptorText(pathResult) {
  if (!pathResult) return 'NO_RESULT_RECORD; descriptor not supplied';
  return [pathResult.kind, pathResult.variantId, pathResult.scenarioId, pathResult.segmentId].join(' / ');
}

function pathFields(pathResult) {
  const values = {};
  for (const key of PATH_FIELDS) {
    if (Object.hasOwn(pathResult, key)) values[key] = pathResult[key];
  }
  return values;
}

function inventoryRows(job, result) {
  return job.pathIds.map((pathId, index) => {
    const pathResult = result?.paths?.[index] ?? null;
    return [
      index + 1,
      pathId,
      descriptorText(pathResult),
      pathResult?.status ?? 'NO_RESULT_RECORD',
      pathResult ? pathFields(pathResult) : 'NOT_SUPPLIED',
      pathResult?.quarterlyReturns ?? 'NOT_SUPPLIED'
    ];
  });
}

function progressRows(job) {
  return job.paths.map(item => [
    item.ordinal,item.pathId,item.phase,item.state,item.startedAt,
    item.completedAt,item.payloadSha256
  ]);
}

function resultRows(result) {
  if (!result) return [];
  return Object.keys(result).filter(key => key !== 'paths').sort().map(key => [key, result[key]]);
}

function composition(projection) {
  const {job, result, provenance} = projection;
  const historicalV2 = projection.schema === HISTORICAL_EXPORT_V2_SCHEMA;
  const lines = [
    '# Offline B1 review report',
    '',
    historicalV2
      ? '> HISTORICAL V2 · UNVERIFIED CALLER ASSERTIONS · NOT AUTHENTICATED EVIDENCE'
      : '> SYNTHETIC-ONLY EXPORT CONTRACT · UNVERIFIED CALLER ASSERTIONS · NOT D2 EVIDENCE',
    '',
    ...(historicalV2 ? [
      'This report formats caller-supplied historical-result bytes only. Provenance and source bindings',
      'remain unverified assertions. It does not replay paths, recalculate metrics, rank candidates,',
      'attribute causality, or grant research or trading authority.'
    ] : [
      'This report formats a parser-accepted export only. It does not authenticate source or caller,',
      'recompute metrics, replay paths, rank candidates, or grant research or trading authority.',
      'The current importer accepts generated-profile bindings only; genuine D2 import is unsupported.'
    ]),
    '',
    '## Export provenance',
    '',
    table(['Field','Returned value'], [
      ['schema',projection.schema ?? HISTORICAL_EXPORT_SCHEMA],
      ['purpose',projection.purpose ?? projection.envelopePurpose],
      ['source',provenance.source],
      ['assertionStatus',provenance.assertionStatus],
      ['sourceAuthenticity',provenance.sourceAuthenticity],
      ...(historicalV2
        ? [['assertedDatasetClass',provenance.assertedDatasetClass],
          ['generatedFixture',provenance.generatedFixture]]
        : [['syntheticFixture',provenance.syntheticFixture]])
    ]),
    ...(historicalV2 ? [
      '',
      '## Byte and binding verification',
      '',
      'Verification is limited to supplied bytes and internal structural consistency; it is not authenticity.',
      '',
      table(['Check','Outcome'],Object.entries(projection.verification)),
      '',
      'The original journal daily budget, global active fence, launcher receipt, approval, profile bundle,',
      'execution checkout, and source-map digest were not supplied by inspect_b1 and are NOT_SUPPLIED.',
      'Progress payload hashes are NOT_VERIFIED because original payload bytes were not supplied.'
    ] : []),
    '',
    '## Lifecycle and attempt',
    '',
    table(['Field','Returned value'], [
      ...[
        'trialId','trialKey','state','attempts','owner','fence','profile',
        'protocolSha256','sourceSha256','dataSha256','manifestSha256',
        'resultSha256','summarySha256','reason','unresolved',
        'executionAuthorized','promotionAuthorized','profitabilityInferred'
      ].filter(key => Object.hasOwn(job, key)).map(key => [key,job[key]]),
      ...Object.entries(job.timestamps).map(([key,value]) => [`timestamp.${key}`,value])
    ]),
    '',
    '## Development control calibration and bindings',
    '',
    'Only caller-supplied values are shown; bindings do not authenticate the source.',
    '',
    table(['Field','Returned value'], [
      ['controls',job.controls],
      ['controlBindings',job.controlBindings]
    ]),
    '',
    'Lifecycle state, engine result status, and screen status are separate returned fields.',
    '',
    '## Authority and result fields',
    '',
    result ? table(['Field','Returned value'], [
      ['engineStatus',result.status],
      ['screenStatus',result.screen?.status],
      ['sourceAuthenticity',result.evidence?.sourceAuthenticity],
      ...AUTHORITY_FIELDS.map(key => [key,result.authority?.[key]])
        .filter(([,value]) => value !== undefined),
      ...resultRows(result)
    ]) : 'No result object was supplied; no engine or screen status is inferred.',
    '',
    '## Path identity inventory — manifest order',
    '',
    'All 44 profile-bound inventory IDs are listed independently from progress and result records.',
    'A missing result remains `NO_RESULT_RECORD`; no completion or metric is manufactured.',
    '',
    table(
      ['Slot','Path ID','Descriptor (when returned)','Result record status','Returned scalar fields','Quarterly returns'],
      inventoryRows(job, result)
    ),
    '',
    '## Computation order',
    '',
    table(['Ordinal','Path ID'],job.computationPathIds.map((id,index) => [index + 1,id])),
    '',
    '## Returned progress observations',
    '',
    job.paths.length
      ? table(['Ordinal','Path ID','Phase','State','Started','Completed','Payload SHA-256'],progressRows(job))
      : 'No progress observations were supplied.',
    '',
    '## Evidence limitations',
    '',
    ...(historicalV2 ? [
      '- This is a bounded offline review of caller-supplied historical-shaped evidence, not independent acceptance.',
      '- Hash consistency binds supplied bytes; it does not authenticate the source, caller, or execution checkout.',
      '- The diagnostic window has already been seen; no holdout, prospective, profitability, or causal claim follows.',
      '- Missing budget, fence, approval, and launcher facts remain NOT_SUPPLIED, not inferred from other fields.',
      '- No thresholds are changed; screen checks and returned statuses are displayed, never recomputed.',
      '- Costs, returns, quarters, control bindings, and lifecycle values are copied from supplied records.',
      '- Daily return/held-target series and fill/cancel detail arrays are omitted from this compact report.'
    ] : [
      '- The export contract is synthetic-only; genuine D2 exports are unsupported.',
      '- Source authenticity remains NOT_ESTABLISHED; hashes bind bytes/identities, not provenance.',
      '- Historical diagnostic is not a holdout; no forward, Paper, or Live conclusion follows.',
      '- Costs are assumptions, not verified execution costs.',
      '- No finite trade stop exists; returned CRV is not inferred or recalculated.',
      '- Trial-ledger state and all authority flags remain exactly as returned; no permission is inferred.',
      '- Daily return/held-target series and fill/cancel detail arrays are omitted from this compact report.',
      '  Scalar fields and quarterly returns shown above are copied from the accepted result unchanged.'
    ]),
    ''
  ];
  return lines.join('\n');
}

export function renderParsedReviewReport(projection) {
  if (!projection || projection.status !== 'PRESENT_UNVERIFIED' ||
      !projection.job || !Array.isArray(projection.job.pathIds) ||
      projection.job.pathIds.length !== 44 ||
      !Array.isArray(projection.job.computationPathIds) ||
      projection.job.computationPathIds.length !== 44 ||
      !projection.provenance || typeof projection.provenance !== 'object') {
    throw new Error('REPORT_INPUT_INVALID');
  }
  const report = composition({
    ...projection,
    envelopePurpose: projection.purpose ?? 'B1_RESULT_EXPORT_NOT_AUTHENTICITY_RECEIPT'
  });
  if (Buffer.byteLength(report, 'utf8') > MAX_REVIEW_REPORT_BYTES) {
    throw new Error('REPORT_OUTPUT_LIMIT');
  }
  return report;
}

export async function renderReviewReport(inputBytes) {
  if (!(inputBytes instanceof Uint8Array)) throw new Error('REPORT_INPUT_INVALID');
  if (inputBytes.byteLength > MAX_HISTORICAL_EXPORT_BYTES) throw new Error('REPORT_INPUT_LIMIT');
  const digest = async bytes =>
    createHash('sha256').update(bytes).digest('hex');
  let projection = await parseArenaHistoricalExportV2(inputBytes,digest);
  if(projection.status!=='PRESENT_UNVERIFIED')
    projection=await parseArenaHistoricalExport(inputBytes,digest);
  if (projection.status !== 'PRESENT_UNVERIFIED') throw new Error('REPORT_INPUT_INVALID');
  return renderParsedReviewReport(projection);
}

async function readStdinBounded() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.byteLength;
    if (total > MAX_HISTORICAL_EXPORT_BYTES) throw new Error('REPORT_INPUT_LIMIT');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function runCli() {
  if (process.argv.length !== 2) throw new Error('REPORT_ARGUMENTS_INVALID');
  const bytes = await readStdinBounded();
  const report = await renderReviewReport(bytes);
  process.stdout.write(report);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli().catch(error => {
    const code = REPORT_ERRORS.has(error?.message) ? error.message : 'REPORT_IO_FAILED';
    process.stderr.write(`ERROR ${code}\n`);
    process.exitCode = 1;
  });
}
