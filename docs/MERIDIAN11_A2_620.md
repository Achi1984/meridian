# MERIDIAN 11 A2 — mobile quality block (#620)

Base: `8a8a43fc8df4e440294bf7ef5747510b6c6a44d0` (live main verified 2026-10-09).
Branch: `codex/meridian11-a2-ui-quality-620-20261009`.
Implementation op: `MERIDIAN11-A2-620-QUALITY-20261009-004`.
The exact candidate head is recorded in the Draft PR and its single lead-status comment.

The existing static public-safe `/v11/` preview now distinguishes unknown, loading
and failed evidence with explicit text and accessible status colors. The state
examples are contained in the existing collapsed source disclosure and labelled
as presentation examples. Changing an example never changes portfolio, risk,
source verification or the single decision owner. There is no engine connection.

Navigation moves focus to the named destination heading. A skip link targets main;
the disclosure and state buttons support native keyboard activation. Narrow card
headings wrap, the 320px source cells stack, long state messages wrap, and safe-area
insets are respected. Reduced-motion and forced-colors presentation are covered.

## Existing PR reconciliation

- #599 head `b9d62d30a1c59005bcbcf63a36c64733a44ea9de`: open, no longer Draft,
  Release Safety and v10 Visual QA successful. Its changes are in v10 and its own
  regression tests; no paths or implementation are copied into A2.
- #605 head `a7bea4d5f8e442c1785a2059efd1ca9ade305b22`: Draft, Release Safety failed.
  A1 owns category colors and the 10px navigation labels, plus its separate CDP
  fetch timeout. A2 retains main's navigation typography and adds state semantics
  separately. `git apply --check` of the complete A1 patch succeeds on A2 without
  applying it or modifying the A1 branch.
- #605 annotations report only exit code 1 and runner notices. Its detailed log
  host is unavailable under the environment's network policy. A2 does not claim
  to have diagnosed or fixed the A1 CI failure.
- Autonomy V2 remains an independent lane; none of its files or PRs are modified.

## Executed local validation

Targeted suite: **11 tests passed, 0 failed, 0 skipped**. This includes existing
A0 contracts and browser coverage plus five A2 VM/contract tests and one A2 real
Chrome test. The browser test checks all five views through 20 cycles at each
actual viewport width: **320 / 375 / 390 / 430 px**. It also sends native Enter and
Space key events, checks heading/control focus, skip-link focus, one current
destination, 44px actions, unclipped labels, no horizontal overflow, bottom content
clearance, long messages, protected-data parity, reduced motion and forced colors.
Status heading contrast against solid backgrounds is 10.49:1 (unknown), 10.90:1
(loading) and 8.17:1 (error); this is not a whole-page WCAG conformance claim.

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory .
V11_TEST_URL=http://127.0.0.1:4173/v11/index.html \
  node --test --test-isolation=none test/v11*.test.js
```

`--test-isolation=none` is a local Node 24 execution option; it is not required or
added to CI. On Node 20, use the repository's existing `node --test` invocation;
the tests retain the WebSocket-enabled child fallback. Without `V11_TEST_URL`,
the existing file-URL CI default remains. Managed Chrome here disallows file URLs;
the normal loopback HTTP preview is permitted, with no browser policy change.

The CDP helper now verifies both target URL and completed load, reports navigation
errors, emulates page focus for native input, and permits a probe callback. This
prevents false evidence from the initial empty `about:blank` page. A1's separate
fetch-timeout change is not incorporated.

Guards passed: frozen research (140 checked, 0 mismatches), release sync/check,
continuity audit, v10 UI regression, public privacy, secret scan, and orchestration
validator. No release identity changed. The broader suite result is reported
separately in the PR; targeted evidence is not presented as full-suite CI evidence.
The broad local invocation `timeout 90s node --test --test-concurrency=1
test/*.test.js` did not finish (exit 124), after emitting 695 passing test lines
without an assertion failure in that log. That is an incomplete run, not a PASS
or a count of the full suite. Existing dependencies were reused without an install.
Exact-head Release Safety CI remains the required full-suite verifier.

Optional screenshot capture:

```sh
V11_TEST_URL=http://127.0.0.1:4173/v11/index.html \
V11_A2_EVIDENCE_DIR=/tmp/meridian-a2-evidence \
  node --test test/v11-a2-chrome.test.js
```

Sixteen local PNGs were generated and visually inspected at 320px (Command) and
390px (error example). They contain only the static public preview. Screenshots
are local evidence, not a deployed site or a private account fixture.

## Boundaries and rollback

This is a non-production static UI candidate. Loading/error are demonstration
states, not exchange responses; live lifecycle, stale/partial snapshots, bfcache,
and engine freshness integration remain later gates under #603. No v9/v10 engine,
API, token, storage, timer, order, workflow, runner, permission, secret, subscription,
paid service, release identity or research-stage changes are included.

Existing Release Safety runs the test glob. The v10 Visual QA path filter does not
cover v11, so its absence is not a v11 PASS; no workflow coverage has been added.
Independent exact-head Claude review is required. No merge or deployment is
authorized by this Draft PR.

Rollback while unmerged: close this Draft PR and retain live main. If ever
separately authorized and merged, revert the single A2 commit to restore the prior
static v11 shell and test helper. Root entry, v10, PWA identity and backend are
unchanged; no data migration or account operation is needed.
