import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMailbox } from '../scripts/watchdog-mailbox.mjs';

const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), OTHER = 'c'.repeat(40);
const ID = 'SYNTHETIC-COMPATIBILITY';
const OWNER = { login:'Achi1984', id:319562141, type:'User' };
const REVIEWER = { login:'claude[bot]', id:209825114, type:'Bot' };
const NOW = Date.parse('2026-10-10T12:00:00Z');
const KEY = `${ID}@${HEAD}@${BASE}`;
const ENVELOPE = '**Claude finished synthetic task in 1m**\n\n---\n';

function classify({ verdict='GREEN_LIGHT', head=HEAD, base=BASE, user=REVIEWER,
  owner=OWNER, envelope='', eol='\n', requestEol=eol, prose='' }={}) {
  const request = {
    id:1, user:owner, created_at:'2026-10-10T11:30:00Z',
    body:`@claude\n\nCROSS_MODEL_REQUEST ${ID}\nexact_head_sha: ${HEAD}\nexact_base_sha: ${BASE}\npr: 1`
      .replaceAll('\n', requestEol)
  };
  const response = {
    id:2, user, created_at:'2026-10-10T11:35:00Z',
    body:(`${envelope}CROSS_MODEL_RESPONSE ${ID}\nverdict: ${verdict}\nreviewed_head: ${head}\nreviewed_base: ${base}${prose}`)
      .replaceAll('\n', eol)
  };
  return resolveMailbox({
    pages:[[request],[response]],
    prPages:[[{ number:1, state:'open', head:{ sha:HEAD, ref:'synthetic-pilot' },
      base:{ sha:BASE }, title:'Synthetic compatibility fixture', draft:true,
      updated_at:'2026-10-10T11:00:00Z' }]],
    mainSha:OTHER, nowMs:NOW
  });
}

function assertDelivery(options, expected) {
  const result = classify(options);
  assert.equal(result.reviewAuthorization, false);
  assert.equal(result.executionImpact, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].state, expected);
  assert.equal(result.items[0].responseCommentId, expected === 'ANSWERED' ? 2 : null);
  assert.equal(result.unresolved, expected === 'ANSWERED' ? '' : KEY);
}

for (const verdict of ['GREEN_LIGHT', 'CHANGES_REQUIRED', 'STALE_HEAD',
  'NEEDS_MORE_EVIDENCE', 'ROOT_CAUSE_CONFIRMED', 'ALTERNATIVE_CAUSE']) {
  test(`canonical ${verdict}: delivery answered, never merge authority`, () => {
    assertDelivery({ verdict }, 'ANSWERED');
  });
}

// Characterization only: rejected human-facing formats are contract decisions,
// not assertions that losing a delivered review is desirable policy.
for (const [label, options, expected] of [
  ['spaced GREEN LIGHT', { verdict:'GREEN LIGHT' }, 'UNRESOLVED'],
  ['unsupported REVISION_REQUIRED', { verdict:'REVISION_REQUIRED' }, 'UNRESOLVED'],
  ['REVISION_REQUIRED with prose', { verdict:'REVISION_REQUIRED for integration readiness.' }, 'UNRESOLVED'],
  ['canonical token with arbitrary suffix', { verdict:'GREEN_LIGHT for this exact head.' }, 'UNRESOLVED'],
  ['canonical token with parentheses', { verdict:'GREEN_LIGHT (static review only)' }, 'ANSWERED'],
  ['negative token with parentheses', { verdict:'CHANGES_REQUIRED (integration pending)' }, 'ANSWERED'],
  ['unsupported token with parentheses', { verdict:'REVISION_REQUIRED (integration pending)' }, 'UNRESOLVED'],
  ['prose after closing parentheses', { verdict:'GREEN_LIGHT (static review) more text' }, 'UNRESOLVED'],
  ['separate-line review prose', { prose:'\n\nSynthetic review explanation. Not merge approval.' }, 'ANSWERED'],
  ['CRLF direct response', { eol:'\r\n' }, 'ANSWERED'],
  ['CRLF action envelope and explanation', { eol:'\r\n', envelope:ENVELOPE,
    verdict:'CHANGES_REQUIRED (integration pending)' }, 'ANSWERED'],
  ['bare CR is not CRLF', { eol:'\r', requestEol:'\n' }, 'UNRESOLVED'],
  ['matching head with annotation', { head:`${HEAD} (reviewed commit)` }, 'UNRESOLVED'],
  ['matching base with annotation', { base:`${BASE} (recorded base)` }, 'UNRESOLVED']
]) {
  test(`current-format characterization: ${label} => ${expected}`, () => {
    assertDelivery(options, expected);
  });
}

for (const [label, options] of [
  ['reviewer login', { user:{ ...REVIEWER, login:'synthetic-impostor' } }],
  ['reviewer numeric ID', { user:{ ...REVIEWER, id:1 } }],
  ['reviewer type', { user:{ ...REVIEWER, type:'User' } }],
  ['exact head', { head:OTHER }],
  ['exact base', { base:OTHER }]
]) {
  test(`parenthesized CRLF response cannot bypass ${label}`, () => {
    assertDelivery({ eol:'\r\n', envelope:ENVELOPE,
      verdict:'GREEN_LIGHT (synthetic explanation)', ...options }, 'UNRESOLVED');
  });
}

test('canonical CRLF response cannot authenticate a request with the wrong owner login', () => {
  const result = classify({ eol:'\r\n', owner:{ ...OWNER, login:'synthetic-impostor' } });
  assert.deepEqual(result.items, []);
  assert.equal(result.unresolved, '');
  assert.equal(result.reviewAuthorization, false);
  assert.equal(result.executionImpact, false);
});
