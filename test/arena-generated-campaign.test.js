import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runGeneratedArenaCampaign } from '../scripts/research/arena-generated-campaign.mjs';
import { GENERATED_ARENA_FIXTURE_ID } from './fixtures/arena-generated-campaign.mjs';
import { canonicalJSON, sha256 } from '../scripts/run-strategy-paper-arena.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const options = outDir => ({ experimentId: 'generated-001', fixtureId: GENERATED_ARENA_FIXTURE_ID, outDir });
async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'meridian-generated-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function isolated(root) {
  const paths = ['scripts/research/arena-generated-campaign.mjs', 'scripts/run-strategy-paper-arena.mjs',
    'test/fixtures/arena-generated-campaign.mjs', 'research/strategy-paper-arena.js',
    'docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md', 'package.json'];
  for (const path of paths) { await mkdir(dirname(join(root, path)), { recursive: true }); await cp(join(ROOT, path), join(root, path)); }
}
async function child(root, outDir, expectFailure = false) {
  const source = `import {runGeneratedArenaCampaign} from './scripts/research/arena-generated-campaign.mjs';
    try { await runGeneratedArenaCampaign(${JSON.stringify(options(outDir))});
      if (${expectFailure}) throw Error('EXPECTED_FAILURE');
    } catch(e) { if (!${expectFailure} || e.message === 'EXPECTED_FAILURE') throw e; console.log(e.message); }`;
  return exec(process.execPath, ['--input-type=module', '-e', source], { cwd: root, timeout: 20000, maxBuffer: 16384 });
}

test('generated campaign retains real Arena cells, costs, controls and sealed identities without promotion', { timeout: 20000 }, async t => {
  const root = await temporary(t), out = join(root, 'campaign');
  const { proposal, completion, bundle } = await runGeneratedArenaCampaign(options(out));
  assert.equal(proposal.sourceKind, 'SYNTHETIC');
  assert.equal(proposal.limits.bundles, 1);
  assert.deepEqual(bundle.result.candidates.map(c => c.id), ['H1-B', 'H1-E', 'H7-B', 'H7-R', 'H9']);
  assert.equal(bundle.result.candidates[4].status, 'BLOCKED_DATA');
  assert.deepEqual(Object.keys(bundle.result.controls), ['buyAndHold', 'cash']);
  for (const cell of [...bundle.result.candidates.slice(0, 4), ...Object.values(bundle.result.controls)]) {
    assert.equal(cell.baseline.costBps, 8); assert.equal(cell.stress.costBps, 16);
    for (const view of [cell.baseline, cell.stress]) {
      assert.equal(view.currency, 'USDT'); assert.equal(view.liveAuthorized, false);
      assert.equal(view.autoPromotion, false); assert.equal(view.paperReadiness, false);
    }
  }
  assert.equal(bundle.result.controls.cash.baseline.profitFactor, null);
  assert.equal(bundle.result.controls.cash.baseline.profitFactorReason, 'NO_CLOSED_TRADES');
  assert.equal(completion.historicalRemainingBudget, 'UNKNOWN');
  assert.equal(completion.evidence, 'ENGINEERING_ONLY');
  assert.equal(completion.executionAuthorized, false);
  assert.equal(completion.proposalSha256, sha256(await readFile(join(out, 'proposal.json'))));
  assert.equal(completion.bundleSha256, sha256(await readFile(join(out, 'arena/bundle.json'))));
  assert.equal(completion.receiptSha256, sha256(await readFile(join(out, 'arena/receipt.json'))));
  assert.equal(completion.resultSha256, sha256(Buffer.from(canonicalJSON(bundle.result) + '\n')));
  const original = await readFile(join(out, 'completion.json'));
  await assert.rejects(runGeneratedArenaCampaign(options(out)), { code: 'EEXIST' });
  assert.deepEqual(await readFile(join(out, 'completion.json')), original);
});

test('generated campaign rejects external inputs and authority options before creating output', async t => {
  const root = await temporary(t);
  const cases = [{ fixtureId: 'market' }, { inputPath: '/market.json' }, { collectBinance: true },
    { fetchImpl: () => {} }, { replay: () => {} }, { liveAuthorized: true }, { trials: 2 }, { sourceKind: 'MARKET_DIAGNOSTIC' }];
  for (const [i, extra] of cases.entries()) {
    const out = join(root, String(i));
    await assert.rejects(runGeneratedArenaCampaign({ ...options(out), ...extra }));
    await assert.rejects(readFile(join(out, 'proposal.json')), { code: 'ENOENT' });
  }
});

test('generated campaign refuses even empty or partial pre-existing output', async t => {
  const root = await temporary(t), out = join(root, 'partial');
  await mkdir(out); await writeFile(join(out, 'proposal.json'), 'partial');
  await assert.rejects(runGeneratedArenaCampaign(options(out)), { code: 'EEXIST' });
  assert.equal(await readFile(join(out, 'proposal.json'), 'utf8'), 'partial');
  await assert.rejects(readFile(join(out, 'completion.json')), { code: 'ENOENT' });
});

test('proposal exists before actual engine evaluation and modified fixture changes identities/results', { timeout: 45000 }, async t => {
  const root = await temporary(t); await isolated(root);
  const engine = join(root, 'research/strategy-paper-arena.js');
  const original = await readFile(engine, 'utf8');
  const inject = `if (!existsSync(new URL('../run/proposal.json', import.meta.url))) throw Error('UNSEALED_PROPOSAL');`;
  await writeFile(engine, "import {existsSync} from 'node:fs';\n" + original.replace(
    'const length=validate({data,asOf,sourceKind,liquidateAtEnd,quoteCurrency});', inject + '\n  const length=validate({data,asOf,sourceKind,liquidateAtEnd,quoteCurrency});'));
  await child(root, join(root, 'run'));
  const first = JSON.parse(await readFile(join(root, 'run/completion.json')));
  const firstProposal = JSON.parse(await readFile(join(root, 'run/proposal.json')));
  // Change only a generated source fixture in this isolated test copy; retain the first output.
  const fixture = join(root, 'test/fixtures/arena-generated-campaign.mjs');
  await writeFile(fixture, (await readFile(fixture, 'utf8')).replace('i * 0.2', 'i * 0.3'));
  await child(root, join(root, 'changed'));
  const second = JSON.parse(await readFile(join(root, 'changed/completion.json')));
  const secondProposal = JSON.parse(await readFile(join(root, 'changed/proposal.json')));
  assert.notEqual(firstProposal.inputSha256, secondProposal.inputSha256);
  assert.notEqual(first.resultSha256, second.resultSha256);
  assert.notEqual(first.bundleSha256, second.bundleSha256);
});

test('input byte bound retains terminal failed receipt and refuses retry', { timeout: 25000 }, async t => {
  const root = await temporary(t); await isolated(root);
  const fixture = join(root, 'test/fixtures/arena-generated-campaign.mjs');
  await writeFile(fixture, (await readFile(fixture, 'utf8')).replace('return { data, asOf:', "return { padding: 'x'.repeat(1048576), data, asOf:"));
  const out = join(root, 'oversize'), result = await child(root, out, true);
  assert.match(result.stdout, /INPUT_BYTE_LIMIT/);
  const failure = JSON.parse(await readFile(join(out, 'failure.json')));
  assert.equal(failure.proposalSealed, false); assert.equal(failure.status, 'FAILED_CLOSED');
  await assert.rejects(readFile(join(out, 'completion.json')), { code: 'ENOENT' });
  assert.match((await child(root, out, true)).stdout, /EEXIST/);
});

test('engine failure retains both sealed proposal and failure without accepted completion', { timeout: 25000 }, async t => {
  const root = await temporary(t); await isolated(root);
  const engine = join(root, 'research/strategy-paper-arena.js');
  await writeFile(engine, (await readFile(engine, 'utf8')).replace(
    'const length=validate({data,asOf,sourceKind,liquidateAtEnd,quoteCurrency});', "throw Error('INJECTED_ENGINE_FAILURE');"));
  const out = join(root, 'failed');
  assert.match((await child(root, out, true)).stdout, /INJECTED_ENGINE_FAILURE/);
  assert.equal(JSON.parse(await readFile(join(out, 'failure.json'))).proposalSealed, true);
  assert.equal(JSON.parse(await readFile(join(out, 'arena/error.json'))).sealedBeforeEvaluation, true);
  await assert.rejects(readFile(join(out, 'completion.json')), { code: 'ENOENT' });
  assert.match((await child(root, out, true)).stdout, /EEXIST/);
});
