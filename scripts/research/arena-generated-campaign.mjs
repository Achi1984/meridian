// One manually invoked generated demonstration; no scheduler or execution authority.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, runArenaBundle, sha256 } from '../run-strategy-paper-arena.mjs';
import { GENERATED_ARENA_FIXTURE_ID, generatedArenaFixture } from '../../test/fixtures/arena-generated-campaign.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const GENERATED_CAMPAIGN_LIMITS = Object.freeze({ bundles: 1, symbols: 8,
  rowsPerSymbol: 240, maxInputBytes: 1048576, maxBundleBytes: 8388608,
  providerCalls: 0, modelCalls: 0 });
const authority = () => ({ evidence: 'ENGINEERING_ONLY', historicalRemainingBudget: 'UNKNOWN',
  executionAuthorized: false, autoPromotion: false, paperReadiness: false, liveAuthorized: false });
const bytes = value => Buffer.from(canonicalJSON(value) + '\n');
async function writeOnce(path, value) { await writeFile(path, bytes(value), { flag: 'wx' }); }
async function boundedRead(path, max) {
  if ((await stat(path)).size > max) throw Error('BUNDLE_BYTE_LIMIT');
  const data = await readFile(path);
  if (data.length > max) throw Error('BUNDLE_BYTE_LIMIT');
  return data;
}

export async function runGeneratedArenaCampaign(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
      Reflect.ownKeys(options).length !== 3 ||
      !['experimentId', 'fixtureId', 'outDir'].every(key =>
        Object.getOwnPropertyDescriptor(options, key)?.value !== undefined)) {
    throw Error('EXACT_GENERATED_OPTIONS_REQUIRED');
  }
  const { experimentId, fixtureId, outDir } = options;
  if (typeof experimentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(experimentId)) throw Error('INVALID_EXPERIMENT_ID');
  if (fixtureId !== GENERATED_ARENA_FIXTURE_ID) throw Error('UNKNOWN_GENERATED_FIXTURE');
  if (typeof outDir !== 'string' || !outDir.trim()) throw Error('NEW_OUTPUT_DIRECTORY_REQUIRED');
  const directory = resolve(outDir);
  // No recursive creation or overwrite: even an incomplete earlier attempt is terminal.
  await mkdir(directory);
  let proposalSealed = false;
  try {
    const input = generatedArenaFixture(), inputBytes = bytes(input);
    if (inputBytes.length > GENERATED_CAMPAIGN_LIMITS.maxInputBytes) throw Error('INPUT_BYTE_LIMIT');
    if (input.sourceKind !== 'SYNTHETIC' || input.quoteCurrency !== 'USDT' ||
        Object.keys(input.data).length !== 8 || Object.values(input.data).some(rows => rows.length !== 240)) {
      throw Error('GENERATED_FIXTURE_CONTRACT');
    }
    const paths = ['research/strategy-paper-arena.js', 'scripts/run-strategy-paper-arena.mjs',
      'docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md', 'test/fixtures/arena-generated-campaign.mjs',
      'scripts/research/arena-generated-campaign.mjs'];
    const identities = Object.fromEntries(await Promise.all(paths.map(async path =>
      [path, sha256(await readFile(join(ROOT, path)))])));
    const proposal = { schemaVersion: 'MERIDIAN_GENERATED_CAMPAIGN_V1', experimentId, fixtureId,
      sourceKind: 'SYNTHETIC', quoteCurrency: 'USDT', inputSha256: sha256(inputBytes), asOf: input.asOf,
      identities, candidates: ['H1-B', 'H1-E', 'H7-B', 'H7-R'], blocked: ['H9'],
      costsBps: [8, 16], controls: ['BUY_AND_HOLD', 'CASH'], limits: GENERATED_CAMPAIGN_LIMITS,
      trialAccounting: 'ONE_BUNDLE_FOUR_DEPENDENT_CELLS_TWO_COST_VIEWS_NOT_CONFIRMATIONS', ...authority() };
    await writeFile(join(directory, 'generated-input.json'), inputBytes, { flag: 'wx' });
    await writeOnce(join(directory, 'proposal.json'), proposal);
    proposalSealed = true;
    const bundle = await runArenaBundle({ inputPath: join(directory, 'generated-input.json'),
      outDir: join(directory, 'arena') });
    const bundleBytes = await boundedRead(join(directory, 'arena', 'bundle.json'), GENERATED_CAMPAIGN_LIMITS.maxBundleBytes);
    const receiptBytes = await boundedRead(join(directory, 'arena', 'receipt.json'), GENERATED_CAMPAIGN_LIMITS.maxInputBytes);
    if (bundle.receipt.inputSha256 !== proposal.inputSha256 ||
        bundle.receipt.engineSha256 !== identities[paths[0]] ||
        bundle.receipt.protocolSha256 !== identities[paths[2]] ||
        !bundleBytes.equals(bytes(bundle))) throw Error('BUNDLE_IDENTITY_MISMATCH');
    if (!(await readFile(join(directory, 'proposal.json'))).equals(bytes(proposal))) throw Error('PROPOSAL_CHANGED');
    const completion = { schemaVersion: 'MERIDIAN_GENERATED_CAMPAIGN_COMPLETION_V1',
      experimentId, status: 'COMPLETE', proposalSha256: sha256(bytes(proposal)),
      bundleFile: 'arena/bundle.json', bundleSha256: sha256(bundleBytes),
      receiptFile: 'arena/receipt.json', receiptSha256: sha256(receiptBytes),
      resultSha256: sha256(bytes(bundle.result)), ...authority() };
    await writeOnce(join(directory, 'completion.json'), completion);
    return { proposal, completion, bundle };
  } catch (error) {
    // Retain the attempt. Never remove partial files, retry, or fabricate completion.
    try { await writeOnce(join(directory, 'failure.json'), { status: 'FAILED_CLOSED',
      proposalSealed, error: String(error.message), ...authority() }); }
    catch (receiptError) { throw new AggregateError([error, receiptError], 'FAILURE_RECEIPT_UNAVAILABLE'); }
    throw error;
  }
}
