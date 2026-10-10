/** Candidate offline eligibility only; never authentication or merge authority. */
import { types } from 'node:util';
export class RoutinePolicyError extends Error {
  constructor(code) { super(code); this.name = 'RoutinePolicyError'; this.code = code; }
}
const need = (ok, code) => { if (!ok) throw new RoutinePolicyError(code); };
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(x);
const path = x => typeof x === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(x)
  && x.split('/').every(p => p !== '.' && p !== '..');
function copy(v, depth = 0, seen = new Set(), budget = {remaining: 10000}) {
  need(--budget.remaining >= 0 && depth <= 10, 'INPUT_LIMIT');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') { need(v.length <= 1024, 'INPUT_LIMIT'); return v; }
  if (typeof v === 'number') { need(Number.isSafeInteger(v) && v >= 0, 'INVALID_NUMBER'); return v; }
  need(v && typeof v === 'object' && !types.isProxy(v) && !seen.has(v), 'INVALID_OBJECT');
  const array = Array.isArray(v);
  need(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype), 'INVALID_OBJECT');
  const keys = Reflect.ownKeys(v); need(keys.length <= 129, 'INPUT_LIMIT');
  if (array) need(v.length <= 128 && keys.length === v.length + 1, 'INVALID_ARRAY');
  seen.add(v); const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    need(typeof key === 'string' && !['__proto__','constructor','prototype'].includes(key), 'INVALID_KEY');
    if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < v.length, 'INVALID_ARRAY');
    const d = Object.getOwnPropertyDescriptor(v,key);
    need(d.enumerable && Object.hasOwn(d,'value'), 'INVALID_DESCRIPTOR');
    result[key] = copy(d.value,depth+1,seen,budget);
  }
  seen.delete(v); return result;
}
function shape(v, keys) {
  need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length
    && keys.every(k => Object.hasOwn(v,k)), 'INVALID_SCHEMA');
}
function list(v, validate, nonempty = true) {
  need(Array.isArray(v) && (!nonempty || v.length > 0) && v.every(validate)
    && new Set(v).size === v.length, 'INVALID_COLLECTION');
}
function pin(v) { need(sha(v.headSha) && sha(v.baseSha) && v.headSha !== v.baseSha,'INVALID_PINS'); }
const reserved = ['architecture','direction','costs','permissions','policy','workflows','releaseCadence',
  'productionActivation','researchStage','tradingStage','security','deployment'];
// Conservative backstop, not semantic proof. All automation scripts are reserved.
const protectedPath = p => /^(?:\.github|scripts|research|docs\/autonomy)(?:\/|$)/i.test(p)
  || /(?:^|[\/_.-])(?:agents?|autonomy|auth(?:ority|entication|orization)?|security|deploy(?:ment)?|research|trad(?:e|ing)|paper|bot|policy|checkpoint|protocol|resume|lease|release|workflow|orchestrat\w*|merge|codex|claude|mailbox|secret|credential)(?:[\/_.-]|$)/i.test(p)
  || /^(?:MERIDIAN_GO\.md|MERIDIAN_LIVE_CHECKPOINT\.json|package(?:-lock)?\.json|Dockerfile|sw\.js|manifest\.webmanifest|manifest\.json|index\.html|version\.json|vercel\.json|netlify\.toml)$/i.test(p);
const result = (eligible, reason) => Object.freeze({eligibleForStandingApproval:eligible,reason,
  authorized:false,authenticated:false,provenanceVerified:false,mergeAllowed:false,dispatchAllowed:false});
function checks(rows, totals) {
  need(Array.isArray(rows), 'INVALID_CHECKS'); const names = new Set();
  for (const c of rows) {
    shape(c, totals ? ['name','status','conclusion','total','passed','failed'] : ['name','status','conclusion']);
    need(id(c.name) && !names.has(c.name) && ['QUEUED','RUNNING','COMPLETED'].includes(c.status)
      && ['SUCCESS','FAILURE','PENDING','CANCELLED','SKIPPED'].includes(c.conclusion), 'INVALID_CHECKS');
    if (totals) need([c.total,c.passed,c.failed].every(n=>Number.isSafeInteger(n)&&n>=0)
      && c.passed+c.failed===c.total,'INVALID_TOTALS');
    names.add(c.name);
  }
}
const green = c => c.status === 'COMPLETED' && c.conclusion === 'SUCCESS';
/** Every claim is untrusted; lead must authenticate scope, classification and evidence. */
export function classifyRoutineMerge(input) {
  const s = copy(input);
  shape(s,['policyAdopted','packet','candidate','ci','review','coordination','priorRelease','classification']);
  need(typeof s.policyAdopted === 'boolean','INVALID_POLICY');
  const p=s.packet,c=s.candidate;
  shape(p,['workId','owner','approved','repository','headSha','baseSha','allowedPaths','requiredChecks','priorRequiredChecks']);
  need(id(p.workId)&&p.owner==='CHATGPT'&&typeof p.approved==='boolean'&&p.repository==='Achi1984/meridian','INVALID_PACKET');
  pin(p);list(p.allowedPaths,path);list(p.requiredChecks,id);list(p.priorRequiredChecks,id);
  shape(c,['workId','owner','repository','headSha','baseSha','liveHeadSha','liveBaseSha','changes']);
  need(id(c.workId)&&id(c.owner)&&c.repository==='Achi1984/meridian'&&sha(c.liveHeadSha)&&sha(c.liveBaseSha),'INVALID_CANDIDATE');pin(c);
  need(Array.isArray(c.changes),'INVALID_DIFF');const changed = new Set();
  for(const f of c.changes){shape(f,['path','previousPath']);need(path(f.path)&&(f.previousPath===null||path(f.previousPath))&&!changed.has(f.path),'INVALID_DIFF');changed.add(f.path);}
  shape(s.ci,['runId','headSha','baseSha','checks']);pin(s.ci);need(s.ci.runId>0&&Number.isSafeInteger(s.ci.runId),'INVALID_CI');checks(s.ci.checks,true);
  shape(s.review,['commentId','headSha','baseSha','reviewer','verdict','independent','fullDiffReviewed','gaps','unresolvedBlockers']);pin(s.review);
  need(s.review.commentId>0&&Number.isSafeInteger(s.review.commentId)&&s.review.reviewer==='CLAUDE'
    &&['GREEN_LIGHT','REVISION_REQUIRED','NEEDS_MORE_EVIDENCE'].includes(s.review.verdict)
    &&typeof s.review.independent==='boolean'&&typeof s.review.fullDiffReviewed==='boolean'
    &&Number.isSafeInteger(s.review.gaps)&&s.review.gaps>=0&&Number.isSafeInteger(s.review.unresolvedBlockers)&&s.review.unresolvedBlockers>=0,'INVALID_REVIEW');
  shape(s.coordination,['unknownOutcome','conflictingWriter']);need(Object.values(s.coordination).every(v=>typeof v==='boolean'),'INVALID_COORDINATION');
  shape(s.priorRelease,['headSha','checks']);need(sha(s.priorRelease.headSha),'INVALID_PRIOR_RELEASE');checks(s.priorRelease.checks,false);
  shape(s.classification,['agreedProductScope',...reserved]);need(Object.values(s.classification).every(v=>typeof v==='boolean'),'INVALID_CLASSIFICATION');
  // Entire envelope validated before returning eligibility or a blocked reason.
  if(!s.policyAdopted) return result(false,'POLICY_NOT_ADOPTED');
  if(!p.approved||!s.classification.agreedProductScope) return result(false,'SCOPE_NOT_APPROVED');
  if(reserved.some(k=>s.classification[k])) return result(false,'RESERVED_OWNER_DECISION');
  if(['workId','owner','repository','headSha','baseSha'].some(k=>c[k]!==p[k])) return result(false,'PACKET_BINDING_MISMATCH');
  if(c.headSha!==c.liveHeadSha||c.baseSha!==c.liveBaseSha) return result(false,'STALE_LIVE_PINS');
  if(c.changes.length===0) return result(false,'EMPTY_DIFF');
  const paths=c.changes.flatMap(f=>f.previousPath===null?[f.path]:[f.path,f.previousPath]);
  if(paths.some(protectedPath)||p.allowedPaths.some(protectedPath)) return result(false,'PROTECTED_PATH');
  if(paths.some(f=>!p.allowedPaths.includes(f))) return result(false,'PATH_OUTSIDE_PACKET');
  if(s.coordination.unknownOutcome||s.coordination.conflictingWriter) return result(false,'RECONCILE_COORDINATION');
  if(s.priorRelease.headSha!==c.baseSha) return result(false,'STALE_PRIOR_RELEASE');
  if(s.priorRelease.checks.some(x=>!green(x))||p.priorRequiredChecks.some(n=>!s.priorRelease.checks.some(x=>x.name===n&&green(x)))) return result(false,'PRIOR_RELEASE_NOT_GREEN');
  if([s.ci,s.review].some(e=>e.headSha!==c.headSha||e.baseSha!==c.baseSha)) return result(false,'STALE_EVIDENCE');
  if(s.ci.checks.some(x=>!green(x)||x.failed>0)||p.requiredChecks.some(n=>!s.ci.checks.some(x=>x.name===n&&green(x)&&x.total>0&&x.total===x.passed))) return result(false,'CI_NOT_GREEN');
  if(s.review.verdict!=='GREEN_LIGHT'||!s.review.independent||!s.review.fullDiffReviewed||s.review.gaps!==0||s.review.unresolvedBlockers!==0) return result(false,'REVIEW_INCOMPLETE');
  return result(true,'OFFLINE_ELIGIBLE_REQUIRES_LEAD_VERIFICATION');
}
