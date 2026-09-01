import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReadTokenSecret, sha256 } from '../scripts/read-token-auth.mjs';

test('MERIDIAN_READ_TOKEN is hashed and removed from environment',()=>{
  const env={MERIDIAN_READ_TOKEN:'My own password'};
  const r=applyReadTokenSecret(env);
  assert.equal(r.mode,'PASSWORD_SECRET');
  assert.equal(env.MERIDIAN_READ_TOKEN,undefined);
  assert.equal(env.MERIDIAN_READ_TOKEN_SHA256,sha256('My own password'));
});

test('plain password takes precedence over an old hash',()=>{
  const env={MERIDIAN_READ_TOKEN:'new-password',MERIDIAN_READ_TOKEN_SHA256:'old-hash'};
  applyReadTokenSecret(env);
  assert.equal(env.MERIDIAN_READ_TOKEN_SHA256,sha256('new-password'));
});

test('existing SHA256 configuration remains supported',()=>{
  const env={MERIDIAN_READ_TOKEN_SHA256:'abc123'};
  const r=applyReadTokenSecret(env);
  assert.equal(r.mode,'SHA256_SECRET');
  assert.equal(env.MERIDIAN_READ_TOKEN_SHA256,'abc123');
});
