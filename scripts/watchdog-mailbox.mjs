/** R130: delivery classification only. This module never grants review/merge authority. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const isSha = value => typeof value === 'string' && SHA.test(value);
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OWNER = Object.freeze({ login: 'Achi1984', id: 319562141, type: 'User' });
const REVIEWER = Object.freeze({ login: 'claude[bot]', id: 209825114, type: 'Bot' });
const VERDICTS = new Set(['GREEN_LIGHT', 'CHANGES_REQUIRED', 'STALE_HEAD', 'NEEDS_MORE_EVIDENCE', 'ROOT_CAUSE_CONFIRMED', 'ALTERNATIVE_CAUSE']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const trusted = (c, who) => Object.keys(who).every(k => c.user[k] === who[k]);
const fail = message => { throw new TypeError(message); };
const at = v => {
  const ms = typeof v === 'string' && ISO.test(v) ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace('.000Z','Z') !== v) fail('invalid API timestamp');
  return ms;
};

/** Input is explicitly the --paginate --slurp shape; never silently accept an API error. */
function flatten(pages, label) {
  if (!Array.isArray(pages) || !pages.length || !pages.every(Array.isArray)) fail(`invalid ${label} page shape`);
  return pages.flat();
}
function commentsFrom(pages) {
  const byId = new Map();
  for (const c of flatten(pages, 'mailbox')) {
    if (!c || !positive(c.id) || typeof c.body !== 'string' ||
        !c.user || typeof c.user.login !== 'string' || !positive(c.user.id) ||
        !['User', 'Bot'].includes(c.user.type)) fail('invalid comment API shape');
    at(c.created_at);
    if (byId.has(c.id)) {
      const prior = byId.get(c.id);
      // Overlapping pages are acceptable only for identical relevant record content.
      if (JSON.stringify([prior.body, prior.created_at, prior.user]) !== JSON.stringify([c.body, c.created_at, c.user])) fail('conflicting comment snapshots');
    }
    byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
function prsFrom(pages) {
  const byNumber = new Map();
  for (const p of flatten(pages, 'PR')) {
    if (!p || !positive(p.number) || p.state !== 'open' || !isSha(p.head?.sha || '') ||
        !isSha(p.base?.sha || '') || typeof p.head?.ref !== 'string' ||
        typeof p.title !== 'string' || typeof p.draft !== 'boolean') fail('invalid open PR API shape');
    at(p.updated_at);
    const row = { number:p.number, title:p.title, headRefName:p.head.ref, headRefOid:p.head.sha,
      baseRefOid:p.base.sha, isDraft:p.draft, updatedAt:p.updated_at };
    if (byNumber.has(p.number) && JSON.stringify(byNumber.get(p.number)) !== JSON.stringify(row)) fail('conflicting PR snapshots');
    byNumber.set(p.number, row);
  }
  return [...byNumber.values()].sort((a,b) => a.number-b.number);
}

/** Only a record header at the start, or the known Claude action envelope, is accepted. */
function record(body, kind) {
  let text = body.replaceAll('\r\n', '\n');
  if (text.includes('\r')) return null;
  if (kind === 'CROSS_MODEL_REQUEST') {
    if (!text.startsWith('@claude\n\n')) return null;
    text = text.slice(9);
  } else {
    text = text.replace(/^\*\*Claude finished [^\n]*\n\n---\n/, '');
  }
  const [header, ...lines] = text.split('\n');
  const prefix = `${kind} `;
  if (!header.startsWith(prefix)) return null;
  const id = header.slice(prefix.length);
  let rest = lines;
  // The watchdog prompt permits this one trailing decision section. Parse only
  // the initial status metadata; never accept another status or borrow fields
  // from the trailer. Request/response record strictness remains unchanged.
  if (kind === 'CROSS_MODEL_STATUS' && id === 'CLAUDE-DEVELOPMENT-WATCHDOG') {
    const trailer = rest.indexOf('CROSS_MODEL_STATUS NEEDS_USER_DECISION');
    if (trailer !== -1) {
      if (rest.slice(trailer + 1).some(line => line.startsWith(prefix))) return null;
      rest = rest.slice(0, trailer);
    }
  }
  if (!KEY.test(id) || rest.some(line => line.startsWith(prefix))) return null;
  const firstMetadata = rest.find(line => line.trim());
  if (firstMetadata && !/^[A-Za-z_][A-Za-z0-9_-]*:/.test(firstMetadata)) return null;
  return { id, text:rest.join('\n') };
}
function field(text, name) {
  const hits = [...text.matchAll(new RegExp(`^${name}:[ \\t]*([^\\n]*)$`, 'gm'))];
  if (hits.length > 1) return { valid:false, value:null };
  return { valid:true, value:hits.length ? hits[0][1].trim() : null };
}
function metadata(text, names) {
  const out = {};
  for (const name of names) {
    const f = field(text,name);
    if (!f.valid) return null;
    out[name] = f.value;
  }
  return out;
}
function request(c, nowMs) {
  if (!trusted(c,OWNER)) return null;
  const r = record(c.body,'CROSS_MODEL_REQUEST');
  if (!r) return null;
  const f = metadata(r.text,['exact_head_sha','exact_base_sha','pr','supersedes']);
  if (!f || !isSha(f.exact_head_sha || '') || (f.exact_base_sha !== null && !isSha(f.exact_base_sha))) return null;
  if (f.pr !== null && !/^#?[1-9][0-9]*$/.test(f.pr)) return null;
  const pr = f.pr === null ? null : Number(f.pr.replace('#',''));
  if (pr !== null && !positive(pr)) return null;
  if (f.supersedes !== null && !KEY.test(f.supersedes)) return null;
  const time = at(c.created_at);
  if (time > nowMs) return null;
  return { id:r.id, head:f.exact_head_sha, base:f.exact_base_sha, pr, supersedes:f.supersedes, time, commentId:c.id };
}
function response(c, nowMs) {
  if (!trusted(c,REVIEWER)) return null;
  const r = record(c.body,'CROSS_MODEL_RESPONSE');
  if (!r) return null;
  const f = metadata(r.text,['reviewed_head','reviewed_base','verdict']);
  if (!f || f.verdict === null || (f.reviewed_base !== null && !isSha(f.reviewed_base))) return null;
  // Permit explanatory parentheses, not arbitrary trailing records or an invented verdict.
  const v = /^([A-Z_]+)(?: \([^\n]*\))?$/.exec(f.verdict)?.[1];
  if (!VERDICTS.has(v)) return null;
  const staleWithoutHead = v === 'STALE_HEAD' && f.reviewed_head === 'none';
  if (!staleWithoutHead && !isSha(f.reviewed_head || '')) return null;
  const time = at(c.created_at);
  if (time > nowMs) return null;
  return { id:r.id, head:f.reviewed_head, base:f.reviewed_base, verdict:v, time, commentId:c.id };
}
const tuple = r => `${r.id}@${r.head}@${r.base || 'NONE'}`;
const later = (a,b) => a.commentId > b.commentId && a.time >= b.time;

export function seenFingerprint({ pages, fingerprint, nowMs }) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint || '') || (!Number.isSafeInteger(nowMs) || nowMs < 0)) fail('invalid fingerprint input');
  return commentsFrom(pages).some(c => {
    if (!trusted(c,REVIEWER) || at(c.created_at) > nowMs) return false;
    const r = record(c.body,'CROSS_MODEL_STATUS');
    if (r?.id !== 'CLAUDE-DEVELOPMENT-WATCHDOG') return false;
    const f = metadata(r.text,['fingerprint','main','active_pr','verdict']);
    return !!f && f.fingerprint === fingerprint && isSha(f.main || '') &&
      /^(?:NONE|[1-9][0-9]*)$/.test(f.active_pr || '') && ['GREEN','CHALLENGE','NEXT_STEP'].includes(f.verdict);
  });
}

export function resolveMailbox({ pages, prPages, mainSha, nowMs }) {
  if (!isSha(mainSha || '') || (!Number.isSafeInteger(nowMs) || nowMs < 0)) fail('invalid live state');
  const comments = commentsFrom(pages), prs = prsFrom(prPages);
  const targets = new Map(prs.map(p => [p.number,p]));
  const parsedRequests = comments.map(c => request(c,nowMs));
  // Count rejected owner request-headed records without echoing untrusted text.
  // Diagnostics are not part of unresolved keys or the state fingerprint.
  const diagnostics = { rejectedOwnerRequestCount:comments.filter((c,i) =>
    !parsedRequests[i] && trusted(c,OWNER) &&
    c.body.replaceAll('\r\n','\n').startsWith('@claude\n\nCROSS_MODEL_REQUEST ')).length };
  const allRequests = parsedRequests.filter(Boolean);
  // Most recent retry owns its tuple; do not reuse a response predating the retry.
  const requests = [...new Map(allRequests.map(r => [tuple(r),r])).values()];
  const responses = comments.map(c => response(c,nowMs)).filter(Boolean);
  const live = r => r.pr === null ? r.head === mainSha :
    targets.get(r.pr)?.headRefOid === r.head && (!r.base || targets.get(r.pr)?.baseRefOid === r.base);
  const items = requests.map(r => {
    const exact = responses.find(s => s.id === r.id && s.head === r.head && (!r.base || s.base === r.base) && later(s,r));
    // A head-less stale response can retire delivery ONLY when its ID has one scope.
    // It can never grant review authority; require the requested base when present.
    const scopes = new Set(requests.filter(q => q.id === r.id).map(tuple));
    const stale = responses.find(s => s.id === r.id && s.verdict === 'STALE_HEAD' && s.head === 'none' &&
      (!r.base || s.base === r.base) && later(s,r) && scopes.size === 1);
    // Renames are explicit and same-target. A matching PR alone is never sufficient.
    const successor = requests.find(q => q.supersedes === r.id && q.id !== r.id && q.head === r.head &&
      q.base === r.base && q.pr === r.pr && later(q,r) && live(q));
    const state = exact ? 'ANSWERED' : stale ? 'STALE_RESPONSE' : successor ? 'SUPERSEDED_DELIVERY' :
      !live(r) ? 'RETIRED_TARGET' : nowMs-r.time < 600000 ? 'YOUNG' : nowMs-r.time > 86400000 ? 'EXPIRED' : 'UNRESOLVED';
    return { id:r.id, head:r.head, base:r.base, pr:r.pr, state, commentId:r.commentId,
      responseCommentId:exact?.commentId ?? stale?.commentId ?? null };
  });
  const unresolved = [...new Set(items.filter(x => x.state === 'UNRESOLVED').map(tuple))].sort().join('|');
  if (/[\r\n]/.test(unresolved) || unresolved.length > 16384) fail('invalid unresolved output');
  return { schema:'MERIDIAN-WATCHDOG-MAILBOX-V1', reviewAuthorization:false, executionImpact:false, unresolved, items, prs, diagnostics };
}

function cli(args) {
  const [mode,...a] = args;
  const json = file => JSON.parse(readFileSync(file,'utf8'));
  if (mode === 'resolve' && a.length === 4) {
    console.log(JSON.stringify(resolveMailbox({pages:json(a[0]),prPages:json(a[1]),mainSha:a[2],nowMs:Number(a[3])*1000})));
  } else if (mode === 'seen' && a.length === 3) {
    console.log(seenFingerprint({pages:json(a[0]),fingerprint:a[1],nowMs:Number(a[2])*1000}));
  } else fail('invalid CLI invocation');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { cli(process.argv.slice(2)); }
  catch { console.error('watchdog mailbox validation failed; no Claude call is authorized'); process.exitCode=1; }
}
