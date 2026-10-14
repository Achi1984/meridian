import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {probePostgresTls} from '../docs/autonomy/event-adapter/review-binding/scripts/publication-postgres-tls-probe.mjs';

const HOST = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const script = new URL('../docs/autonomy/event-adapter/review-binding/scripts/publication-postgres-tls-probe.mjs', import.meta.url);
class Socket extends EventEmitter {
  writes = []; destroyed = false;
  write(bytes) { this.writes.push(Buffer.from(bytes)); }
  pause() { this.paused = true; }
  resume() { this.resumed = true; }
  destroy() { this.destroyed = true; }
}
function fixture(t) {
  const plain = new Socket(), secure = new Socket();
  secure.authorized = true;
  secure.getProtocol = () => 'TLSv1.3';
  secure.getPeerCertificate = () => ({subjectaltname: `DNS:${HOST}`});
  const connect = t.mock.method(net, 'connect', (options) => {
    assert.deepEqual(options, {host: HOST, port: 5432}); return plain;
  });
  const wrap = t.mock.method(tls, 'connect', (options) => {
    assert.deepEqual(options, {socket: plain, servername: HOST,
      rejectUnauthorized: true, minVersion: 'TLSv1.2', checkServerIdentity: tls.checkServerIdentity});
    return secure;
  });
  t.mock.timers.enable({apis: ['setTimeout']});
  const promise = probePostgresTls();
  return {plain, secure, connect, wrap, promise,
    negotiate() { plain.emit('connect'); plain.emit('data', Buffer.from('S')); }};
}
function sanitized(result, success) {
  assert.deepEqual(Object.keys(result), ['success', 'tlsProtocol', 'elapsedMs']);
  assert.equal(result.success, success);
  assert.equal(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0, true);
  if (!success) assert.equal(result.tlsProtocol, null);
}

test('import is inert and CLI rejects all implicit runs and overrides', () => {
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import net from 'node:net'; import tls from 'node:tls';
     net.connect = tls.connect = () => { throw new Error('UNEXPECTED_IO'); };
     await import(${JSON.stringify(script.href)});`], {timeout: 2000, encoding: 'utf8'});
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
  for (const args of [[], ['--host=localhost'], ['--probe', '--host=localhost']]) {
    const cli = spawnSync(process.execPath, [fileURLToPath(script), ...args], {timeout: 2000, encoding: 'utf8'});
    assert.equal(cli.status, 2); assert.equal(cli.stdout, '');
  }
});

test('CLI deadline exits despite a synthetic lingering DNS handle, with sanitized output', () => {
  // Preload prevents all real networking and simulates a native lookup that
  // cannot be cancelled by destroying its socket. Shorten only test timers.
  const preload = `import net from 'node:net'; import {EventEmitter} from 'node:events';
    const nativeTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms / 100, ...args);
    net.connect = () => { const s = new EventEmitter(); s.destroy = () => {};
      setInterval(() => {}, 1000); return s; };`;
  const cli = spawnSync(process.execPath, ['--import',
    'data:text/javascript,' + encodeURIComponent(preload), fileURLToPath(script), '--probe'],
    {timeout: 2000, encoding: 'utf8'});
  assert.equal(cli.status, 1); assert.equal(cli.stderr, '');
  sanitized(JSON.parse(cli.stdout), false);
});

test('SSLRequest only, strict verified TLS, immediate teardown without login or SQL', async (t) => {
  const f = fixture(t); f.negotiate(); f.secure.emit('secureConnect');
  const result = await f.promise; sanitized(result, true);
  assert.equal(result.tlsProtocol, 'TLSv1.3');
  assert.deepEqual(f.plain.writes, [Buffer.from([0,0,0,8,4,210,22,47])]);
  assert.deepEqual(f.secure.writes, []);
  assert.equal(f.wrap.mock.callCount(), 1);
  assert.equal(f.plain.destroyed && f.secure.destroyed, true);
});

for (const response of ['N', 'E', 'SS', 'Sgarbage']) {
  test(`rejects nonconforming SSLRequest response ${response}`, async (t) => {
    const f = fixture(t); f.plain.emit('connect'); f.plain.emit('data', Buffer.from(response));
    sanitized(await f.promise, false); assert.equal(f.wrap.mock.callCount(), 0);
    assert.equal(f.plain.destroyed, true);
  });
}
for (const failure of ['untrusted', 'hostname', 'protocol', 'certificate-throws', 'tls-error']) {
  test(`fails closed on ${failure}`, async (t) => {
    const f = fixture(t); f.negotiate();
    if (failure === 'untrusted') f.secure.authorized = false;
    if (failure === 'hostname') f.secure.getPeerCertificate = () => ({subjectaltname: 'DNS:wrong.example'});
    if (failure === 'protocol') f.secure.getProtocol = () => 'TLSv1.1';
    if (failure === 'certificate-throws') f.secure.getPeerCertificate = () => { throw new Error('SECRET'); };
    f.secure.emit(failure === 'tls-error' ? 'error' : 'secureConnect', new Error('SECRET'));
    sanitized(await f.promise, false); assert.equal(f.secure.destroyed, true);
    assert.deepEqual(f.secure.writes, []);
  });
}
for (const phase of ['dns-tcp', 'ssl-request', 'tls']) {
  test(`total deadline closes stalled ${phase} and ignores late events`, async (t) => {
    const f = fixture(t);
    if (phase === 'ssl-request') f.plain.emit('connect');
    if (phase === 'tls') f.negotiate();
    t.mock.timers.tick(5000);
    sanitized(await f.promise, false);
    assert.equal(f.plain.destroyed, true);
    const writes = f.plain.writes.length;
    f.plain.emit('connect'); f.plain.emit('data', Buffer.from('S'));
    f.secure.emit('secureConnect');
    assert.equal(f.plain.writes.length, writes);
    assert.equal(f.wrap.mock.callCount(), phase === 'tls' ? 1 : 0);
  });
}
for (const event of ['error', 'end', 'close']) {
  test(`sanitizes and tears down TCP ${event}`, async (t) => {
    const f = fixture(t); f.plain.emit(event, new Error('SECRET connection details'));
    sanitized(await f.promise, false); assert.equal(f.plain.destroyed, true);
  });
}
