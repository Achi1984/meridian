# MERIDIAN Codex Bridge V2 — isolated implementation draft

Status: OFFLINE_ONLY_CONTRACT; no agent activation, independent review, workflow, permissions or token changes.

Issue: https://github.com/Achi1984/meridian/issues/627
Target branch: feat/codex-bridge-v2-contract-20261009
Target repo paths:
- scripts/codex-bridge-contract.mjs
- test/codex-bridge-contract.test.js
- docs/autonomy/CODEX_BRIDGE_V2_627.md

Run: `node --test test/codex-bridge-contract.test.js`

32 deterministic local tests (Node 22.16.0) passed on 2026-10-09. This is NOT independent Claude review, repo-wide CI, or a signed agent ACK. An authenticated `observed` object MUST come from an independently trusted GitHub API integration; passing `trustedSource: true` from self-asserted agent text is insecure. The library is pure and cannot authenticate an actor by itself. Agent model selection, billing quota checks, native launch API, GitHub writes and the full transport are NOT implemented or authorized.

Publication/review protocol: follow MERIDIAN_GO.md; require exact-head verification, canonical stream-safe-preflight, guarded CAS, re-fetch and source SHA checks. No merge or activation without explicit approvals and independent exact-head review.
