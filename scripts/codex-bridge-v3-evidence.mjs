// Offline-only evidence validation. This module never grants authorization.
export class EvidenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function validateEvidence(evidence, expected) {
  if (!evidence || !expected || typeof evidence !== 'object' || typeof expected !== 'object') throw new EvidenceError('INVALID_INPUT');
  for (const field of ['requestId', 'headSha', 'baseSha', 'repository']) {
    if (typeof expected[field] !== 'string' || evidence[field] !== expected[field]) throw new EvidenceError('SCOPE_MISMATCH');
  }
  if (!/^[0-9a-f]{40}$/.test(expected.headSha) || !/^[0-9a-f]{40}$/.test(expected.baseSha)) throw new EvidenceError('INVALID_SHA');
  if (evidence.ciStatus !== 'completed' || evidence.ciConclusion !== 'success') throw new EvidenceError('CI_NOT_GREEN');
  if (evidence.reviewHead !== expected.headSha || evidence.reviewVerdict !== 'GREEN_LIGHT') throw new EvidenceError('REVIEW_NOT_GREEN');
  return Object.freeze({offlineValid: true, authenticated: false, authorized: false, mergeAllowed: false, dispatchAllowed: false});
}
export function requireAuthenticatedTransport() { throw new EvidenceError('AUTHENTICATED_TRANSPORT_UNAVAILABLE'); }
