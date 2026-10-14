import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import tls from 'node:tls';
import {openPublicationPools} from '../scripts/publication-actions-pools.mjs';

const host = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const config = () => ({host, database: 'publisher_test',
  reservation: {user: 'publisher_ledger', password: 'synthetic-ledger'},
  senderRecord: {user: 'publisher_sender', password: 'synthetic-sender'},
  sendRecordRead: {user: 'publisher_reader', password: 'synthetic-reader'}});
function fixture({failAt, failClose, hangClose} = {}) {
  const instances = [];
  class Pool extends EventEmitter {
    constructor(options) {
      super();
      if (instances.length === failAt) throw new Error('SECRET construction credentials');
      this.options = options; this.ended = 0; instances.push(this);
    }
    query() { throw new Error('No queries permitted by these synthetic tests'); }
    async end() {
      this.ended++;
      if (failClose) throw new Error('SECRET close failure');
      if (hangClose) await new Promise(() => {});
    }
  }
  return {Pool, instances};
}
const generic = error => error.message === 'PUBLICATION_POOLS_UNAVAILABLE' && !error.cause;

test('explicit independent pools, verified TLS and finite operation bounds', async () => {
  const f = fixture(), pools = await openPublicationPools(config(), f);
  assert.equal(new Set([pools.reservationPool, pools.senderRecordPool, pools.sendRecordReadPool]).size, 3);
  assert.deepEqual(f.instances.map(p => p.options.user), ['publisher_ledger','publisher_sender','publisher_reader']);
  for (const {options} of f.instances) {
    assert.equal(options.host, host); assert.equal(options.database, 'publisher_test');
    assert.equal(options.port, 5432); assert.equal(options.max, 1);
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.ssl.servername, host); assert.equal(options.ssl.minVersion, 'TLSv1.2');
    assert.equal(options.ssl.checkServerIdentity, tls.checkServerIdentity);
    assert.ok(options.ssl.checkServerIdentity(host, {subjectaltname: 'DNS:wrong.example'}));
    for (const key of ['connectionTimeoutMillis','statement_timeout','query_timeout','lock_timeout','idleTimeoutMillis']) {
      assert.equal(Number.isFinite(options[key]) && options[key] > 0 && options[key] <= 2500, true);
    }
    assert.equal(options.options, '-c statement_timeout=2000 -c lock_timeout=1000 -c search_path=pg_catalog');
    assert.equal(options.application_name, 'meridian-publication-test');
  }
  f.instances[0].emit('error', new Error('SECRET idle error'));
  const first = pools.close(); assert.equal(pools.close(), first); await first;
  assert.deepEqual(f.instances.map(p => p.ended), [1,1,1]);
});

const invalidCases = {
  missing: () => undefined,
  host: c => ({...c, host: 'financial.example'}),
  connectionString: c => ({...c, connectionString: 'postgres://SECRET'}),
  envFallback: c => ({...c, DATABASE_URL: 'postgres://SECRET'}),
  sslOverride: c => ({...c, ssl: false}),
  missingPassword: c => { delete c.reservation.password; return c; },
  emptyPassword: c => { c.reservation.password = ''; return c; },
  passwordProvider: c => { c.reservation.password = () => 'SECRET'; return c; },
  admin: c => { c.reservation.user = 'neondb_owner'; return c; },
  defaultUser: c => { c.reservation.user = 'postgres'; return c; },
  duplicateUser: c => { c.senderRecord.user = c.reservation.user; return c; },
  duplicatePassword: c => { c.senderRecord.password = c.reservation.password; return c; },
  extraRoleOption: c => { c.reservation.ssl = false; return c; },
  databaseUri: c => ({...c, database: 'postgres://SECRET'}),
};
for (const [name, mutate] of Object.entries(invalidCases)) {
  test(`rejects ${name} before constructing any pool`, async () => {
    const f = fixture(); await assert.rejects(openPublicationPools(mutate(config()), f), generic);
    assert.equal(f.instances.length, 0);
  });
}
test('requires explicit Pool dependency', async () => {
  await assert.rejects(openPublicationPools(config()), generic);
});
for (const failAt of [0,1,2]) {
  test(`partial constructor failure ${failAt} closes every created pool`, async () => {
    const f = fixture({failAt}); await assert.rejects(openPublicationPools(config(), f), generic);
    assert.equal(f.instances.length, failAt);
    assert.ok(f.instances.every(p => p.ended === 1));
  });
}
test('close attempts all pools and sanitizes errors', async () => {
  const f = fixture({failClose: true}), pools = await openPublicationPools(config(), f);
  await assert.rejects(pools.close(), generic);
  assert.deepEqual(f.instances.map(p => p.ended), [1,1,1]);
});
test('close deadline rejects a hanging driver without claiming cleanup succeeded', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture({hangClose: true}), pools = await openPublicationPools(config(), f);
  const closed = pools.close(); const rejection = assert.rejects(closed, generic);
  t.mock.timers.tick(2000); await rejection;
  assert.deepEqual(f.instances.map(p => p.ended), [1,1,1]);
});
