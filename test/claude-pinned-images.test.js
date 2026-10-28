import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {
  DIRECTORY, FILE_LIMIT, JSON_LIMIT, NAMES, REPOSITORY, TOTAL_LIMIT,
  githubApi, parseRequest, prepareImages,
} from '../scripts/claude-pinned-images.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HEAD = 'a'.repeat(40);
const oid = (type, data) => createHash('sha1').update(`${type} ${data.length}\0`).update(data).digest('hex');
const sha256 = data => createHash('sha256').update(data).digest('hex');

function png(seed, padding = 0) {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, seed, 0, 0]))),
    ...(padding ? [chunk('tEXt', Buffer.concat([Buffer.from('fixture\0'), Buffer.alloc(padding - 8, 120)]))] : []),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function request(body = `@claude CROSS_MODEL_REQUEST\nPINNED_PR_IMAGES PR=975 HEAD=${HEAD}`) {
  return {
    action: 'created', repository: {full_name: REPOSITORY}, issue: {number: 942},
    comment: {user: {login: 'Achi1984'}, body},
  };
}

async function fixture(t, sizes) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pinned-images-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const temp = path.join(root, 'runner');
  const workspace = path.join(root, 'checkout');
  await mkdir(temp);
  await mkdir(workspace);
  await writeFile(path.join(temp, 'pre-existing-scratch'), 'preserve');
  await writeFile(path.join(workspace, 'tracked.txt'), 'unchanged');
  const routes = new Map();
  const images = NAMES.map((name, index) => {
    const bytes = sizes ? png(index, sizes[index] - png(index).length - 12) : png(index);
    const sha = oid('blob', bytes);
    routes.set(`git/blobs/${sha}`, bytes);
    return {path: name, mode: '100644', type: 'blob', sha, size: bytes.length};
  });
  let entries = images;
  for (const component of [null, ...DIRECTORY.split('/')].reverse()) {
    const data = Buffer.concat(entries.map(item => Buffer.concat([
      Buffer.from(`${item.mode === '040000' ? '40000' : item.mode} ${item.path}\0`),
      Buffer.from(item.sha, 'hex'),
    ])));
    const sha = oid('tree', data);
    routes.set(`git/trees/${sha}`, {sha, truncated: false, tree: entries});
    entries = [{path: component, mode: '040000', type: 'tree', sha}];
  }
  routes.set(`git/commits/${HEAD}`, {sha: HEAD, tree: {sha: entries[0].sha}});
  const metadata = {number: 975, head: {sha: HEAD, repo: {full_name: REPOSITORY}}, base: {repo: {full_name: REPOSITORY}}};
  routes.set('pulls/975', metadata);
  const calls = [];
  const transport = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, undefined, 'GET only');
    assert.ok(options.signal instanceof AbortSignal);
    const prefix = `https://api.github.com/repos/${REPOSITORY}/`;
    assert.ok(url.startsWith(prefix), 'fixed host/repository');
    const route = url.slice(prefix.length);
    calls.push(route);
    assert.ok(routes.has(route), `Unexpected API route: ${route}`);
    const value = routes.get(route);
    assert.equal(options.headers.Accept, Buffer.isBuffer(value) ? 'application/vnd.github.raw+json' : 'application/vnd.github+json');
    return new Response(Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  const options = {temp, workspace, api: githubApi('fixture-token', transport)};
  return {root, routes, images, metadata, calls, transport, options};
}

test('exact eight pinned blobs materialize with digests, leaving tracked tree and scratch intact', async t => {
  const f = await fixture(t);
  const before = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: ROOT}).toString();
  const result = await prepareImages(request(), f.options);
  assert.equal(result.status, 'prepared');
  assert.ok(result.directory.startsWith(`${f.options.temp}/claude-pinned-images-`));
  assert.match(result.context, /Read .*manifest\.json, then use image Read on all eight/);
  assert.ok(!/["'$`\n\r]/.test(result.context), 'safe inside existing quoted claude_args');
  const manifest = JSON.parse(await readFile(path.join(result.directory, 'manifest.json')));
  assert.equal(manifest.repository, REPOSITORY);
  assert.equal(manifest.pr, 975);
  assert.equal(manifest.head, HEAD);
  assert.equal(manifest.files.length, 8);
  for (const [index, file] of manifest.files.entries()) {
    const expected = f.images[index];
    const bytes = await readFile(file.path);
    assert.equal(file.source, `${DIRECTORY}/${NAMES[index]}`);
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.blob, oid('blob', bytes));
    assert.equal(file.sha256, sha256(bytes));
    assert.deepEqual(bytes, f.routes.get(`git/blobs/${expected.sha}`));
    assert.equal((await stat(file.path)).mode & 0o777, 0o600);
  }
  assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(result.directory), ['images', 'manifest.json']);
  assert.deepEqual((await readdir(path.join(result.directory, 'images'))).sort(), [...NAMES].sort());
  assert.equal(f.calls[0], 'pulls/975');
  assert.equal(f.calls.at(-1), 'pulls/975');
  assert.equal(f.calls.filter(route => route.startsWith('git/blobs/')).length, 8);
  assert.equal(await readFile(path.join(f.options.temp, 'pre-existing-scratch'), 'utf8'), 'preserve');
  assert.equal(await readFile(path.join(f.options.workspace, 'tracked.txt'), 'utf8'), 'unchanged');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: ROOT}).toString(), before);
});

test('non-image requests do not call the API or write anything', async t => {
  const f = await fixture(t);
  assert.deepEqual(await prepareImages(request('@claude CROSS_MODEL_REQUEST ordinary review'), f.options), {status: 'skipped', context: ''});
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await readdir(f.options.temp), ['pre-existing-scratch']);
});

test('inclusive per-file and total byte ceilings materialize successfully', async t => {
  const sizes = [FILE_LIMIT, FILE_LIMIT, FILE_LIMIT, FILE_LIMIT, FILE_LIMIT / 2, FILE_LIMIT / 2, FILE_LIMIT / 2, FILE_LIMIT / 2];
  assert.equal(sizes.reduce((a, b) => a + b), TOTAL_LIMIT);
  const f = await fixture(t, sizes);
  const result = await prepareImages(request(), f.options);
  const manifest = JSON.parse(await readFile(path.join(result.directory, 'manifest.json')));
  assert.deepEqual(manifest.files.map(file => file.bytes), sizes);
  for (const file of manifest.files) assert.equal(sha256(await readFile(file.path)), file.sha256);
});

test('strict marker rejects missing, ambiguous, shell/path/URL injection and non-full pins', () => {
  const valid = `PINNED_PR_IMAGES PR=975 HEAD=${HEAD}`;
  for (const marker of [
    'PINNED_PR_IMAGES', `${valid}\n${valid}`, `${valid} $(touch /tmp/injected)`,
    `${valid} PATH=../../secret`, `${valid} URL=https://example.com/image.png`,
    valid.replace('975', '975;id'), valid.replace('975', '../975'),
    valid.replace(HEAD, 'a'.repeat(39)), valid.replace(HEAD, 'a'.repeat(41)),
    valid.replace(HEAD, '$(env)'), valid.replace(HEAD, 'A'.repeat(40)),
    `prefix ${valid}`, `${valid}\nPINNED_PR_IMAGES PR=976 HEAD=${HEAD}`,
  ]) {
    assert.throws(() => parseRequest(request(`@claude CROSS_MODEL_REQUEST\n${marker}`)), /invalid_request/);
  }
  for (const mutate of [
    e => { e.action = 'edited'; }, e => { e.issue.number = 975; },
    e => { e.comment.user.login = 'someone-else'; },
    e => { e.comment.body = valid; },
  ]) {
    const event = request();
    mutate(event);
    assert.throws(() => parseRequest(event), /invalid_request/);
  }
  const wrong = request();
  wrong.repository.full_name = 'other/meridian';
  assert.throws(() => parseRequest(wrong), /wrong_repository/);
});

test('stale head, foreign head/base repository and mismatched PR number are blocked', async t => {
  for (const mutate of [
    f => { f.metadata.head.sha = 'b'.repeat(40); },
    f => { f.metadata.head.repo.full_name = 'outsider/meridian'; },
    f => { f.metadata.base.repo.full_name = 'Achi1984/elsewhere'; },
    f => { f.metadata.number = 976; },
    f => { f.metadata.head.repo = null; },
  ]) {
    const f = await fixture(t);
    mutate(f);
    await assert.rejects(prepareImages(request(), f.options), /stale_head|wrong_repository/);
    assert.deepEqual(f.calls, ['pulls/975']);
    assert.deepEqual(await readdir(f.options.temp), ['pre-existing-scratch']);
  }
});

test('head changing while blobs are read is blocked before materialization', async t => {
  const f = await fixture(t);
  const original = f.options.api;
  let reads = 0;
  f.options.api = async (...args) => {
    if (args[0] === 'pulls/975' && ++reads === 2) f.metadata.head.sha = 'b'.repeat(40);
    return original(...args);
  };
  await assert.rejects(prepareImages(request(), f.options), /stale_head/);
  assert.deepEqual(await readdir(f.options.temp), ['pre-existing-scratch']);
});

test('fixed path, unambiguous trees, regular blobs and bounded metadata are required', async t => {
  for (const [mutate, reason] of [
    [f => { f.images[0].path = '../../secret.png'; }, 'invalid_path'],
    [f => { f.images.push({...f.images[0]}); }, 'invalid_path'],
    [f => { f.images[0].type = 'tree'; }, 'invalid_type'],
    [f => { f.images[0].mode = '120000'; }, 'invalid_type'],
    [f => { f.images[0].type = 'commit'; f.images[0].mode = '160000'; }, 'invalid_type'],
    [f => { f.images[0].sha = '../secret'; }, 'invalid_metadata'],
    [f => { f.images[0].sha = [f.images[0].sha]; }, 'invalid_metadata'],
    [f => { [...f.routes.values()].find(x => x?.tree?.[0]?.path === 'docs').tree[0].mode = '120000'; }, 'invalid_type'],
    [f => { [...f.routes.values()].find(x => x?.tree).truncated = true; }, 'invalid_metadata'],
    [f => { f.routes.get(`git/commits/${HEAD}`).sha = 'b'.repeat(40); }, 'invalid_metadata'],
    [f => { f.routes.get(`git/commits/${HEAD}`).tree.sha = 'not-a-sha'; }, 'invalid_metadata'],
    [f => { f.images[0].size = FILE_LIMIT + 1; }, 'size_limit'],
    [f => { f.images[0].size = -1; }, 'size_limit'],
    [f => { f.images[0].size = '100'; }, 'size_limit'],
    [f => { for (const image of f.images) image.size = FILE_LIMIT; }, 'size_limit'],
  ]) {
    const f = await fixture(t);
    mutate(f);
    await assert.rejects(prepareImages(request(), f.options), new RegExp(reason));
    assert.equal(f.calls.filter(route => route.startsWith('git/blobs/')).length, 0);
    assert.deepEqual(await readdir(f.options.temp), ['pre-existing-scratch']);
  }
  assert.ok(TOTAL_LIMIT < FILE_LIMIT * NAMES.length);
});

test('bad PNG signatures, corrupt blob digests, short and oversized responses fail closed', async t => {
  for (const [change, reason] of [
    [data => { data[0] = 0; return data; }, 'invalid_png'],
    [data => { data[data.length - 1] ^= 1; return data; }, 'digest_mismatch'],
    [data => data.subarray(0, data.length - 1), 'size_limit'],
    [data => Buffer.concat([data, Buffer.alloc(1)]), 'size_limit'],
  ]) {
    const f = await fixture(t);
    const route = `git/blobs/${f.images[0].sha}`;
    f.routes.set(route, change(Buffer.from(f.routes.get(route))));
    await assert.rejects(prepareImages(request(), f.options), new RegExp(reason));
    assert.deepEqual(await readdir(f.options.temp), ['pre-existing-scratch']);
  }
});

test('transport bounds streaming data, rejects redirects/errors/invalid JSON without leaking details', async () => {
  for (const [response, reason] of [
    [() => new Response('PRIVATE', {status: 302, headers: {Location: 'https://example.com'}}), 'api_unavailable'],
    [() => new Response('PRIVATE', {status: 403}), 'api_unavailable'],
    [() => new Response('{PRIVATE'), 'api_unavailable'],
    [() => new Response(Buffer.alloc(JSON_LIMIT + 1)), 'size_limit'],
    [() => { throw new Error('PRIVATE credential'); }, 'api_unavailable'],
  ]) {
    const api = githubApi('fixture-token', async () => response());
    await assert.rejects(api('pulls/975'), error => error.message === reason);
  }
});

test('temp directory cannot be the checkout or a checkout descendant', async t => {
  const f = await fixture(t);
  for (const temp of [f.options.workspace, path.join(f.options.workspace, 'nested')]) {
    await mkdir(temp, {recursive: true});
    await assert.rejects(prepareImages(request(), {...f.options, temp}), /unsafe_temp/);
    assert.ok(!(await readdir(temp)).some(name => name.startsWith('claude-pinned-images-')));
  }
});

test('CLI reads JSON event data, emits only fixed blocking reason, and preserves scratch', async t => {
  const f = await fixture(t);
  const event = path.join(f.root, 'event.json');
  const output = path.join(f.root, 'output');
  const injected = path.join(f.root, 'injected');
  await writeFile(event, JSON.stringify(request(`@claude CROSS_MODEL_REQUEST\nPINNED_PR_IMAGES PR=975 HEAD=${HEAD} $(touch ${injected}) PRIVATE`)));
  const env = {...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, RUNNER_TEMP: f.options.temp, GITHUB_WORKSPACE: f.options.workspace};
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts/claude-pinned-images.mjs')], {env, encoding: 'utf8', timeout: 5000});
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Pinned image preparation: blocked\n');
  assert.equal(result.stderr, '');
  const receipt = await readFile(output, 'utf8');
  assert.match(receipt, /status=blocked\ncontext=PINNED_IMAGES_BLOCKED reason=invalid_request\./);
  assert.match(receipt, /NEEDS_MORE_EVIDENCE/);
  assert.doesNotMatch(receipt, /PRIVATE|touch/);
  assert.ok(!(await readdir(f.root)).includes('injected'));
  assert.deepEqual(await readdir(f.options.temp), ['pre-existing-scratch']);
  await writeFile(event, JSON.stringify(request('@claude CROSS_MODEL_REQUEST not an image request')));
  await writeFile(output, '');
  assert.equal(run().status, 0);
  assert.equal(await readFile(output, 'utf8'), 'status=skipped\ncontext=\n');
});

test('workflow keeps original reviewer policy and authority, using supported claude_args context', async () => {
  const workflow = await readFile(path.join(ROOT, '.github/workflows/claude-mailbox-review.yml'), 'utf8');
  const step = /      - name: Prepare explicitly pinned review images\n[\s\S]*?(?=      - name: Run Claude mailbox reviewer)/;
  assert.ok(workflow.indexOf('Prepare explicitly pinned review images') < workflow.indexOf('Run Claude mailbox reviewer'));
  // Trusted main 1afdbf9, without requiring that history in CI's shallow checkout.
  assert.equal(sha256(workflow.replace(step, '').replace(' ${{ steps.pinned_images.outputs.context }}', '')), '3cfcc51189d2d1dabef0cf0cc3a5b69a190f313ed393709fd941c2d50d2cdaf3');
  assert.doesNotMatch(workflow, /\$\{\{\s*github\.event\.comment\.body\s*\}\}/);
});
