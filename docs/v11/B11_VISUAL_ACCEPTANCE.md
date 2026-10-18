# Meridian 11 B11 Bot cockpit acceptance

## Evidence provenance

The committed PNGs in `evidence/b11/` and the original local execution results
below were produced for the worker proposal ending at
`b52de431e9d0121c362119581806419db0b8f4fb`. They are **pre-fix evidence**, not
screenshots or execution proof of the subsequent acceptance corrections.
The original Command/Bots captures mainly show the upper page and do not prove
that the cockpit controls and populated cards are visible within those captures.
The original files ending `-locked.png` were captured after expiry and actually
show the **stale** state; their filenames are retained only as historical evidence.

## Original worker execution

The worker reported an actual V11-shell Chromium/CDP run at 320×568, 375×667,
390×844 and 1440×900, with five synthetic bots and ten explicit mock reads per
viewport. The fixture included duplicate BTC symbols, but only one BTC loss.
Search, filters, source-P/L sorting, a keyboard Enter card jump and state clearing
were exercised. Overflow checks were initially locked and finally stale; those
checks do **not** prove populated or expanded-card layout.

Original reported commands/results:

- B11 actual-shell browser suite: passed at four viewport sizes.
- Model/view suites: 27 passed.
- Focused V11 suites: 128 passed.
- Full local suite: 2,551 passed and 11 failed; this was not a full-CI pass.
- Frozen terminal baseline reversal: passed.

These are historical worker results, not a claim that the corrected candidate
has passed exact-head hosted CI or independent review.

## Acceptance corrections requiring fresh browser evidence

- Command loss actions include direction and the full validated bot reference,
  making equal-symbol/equal-loss actions distinguishable visually and by accessible name.
- The actual-shell fixture now contains six bots: two BTC bots with the same
  negative P/L, a separate zero-P/L bot, missing values and all four direction states.
- Tests assert both equal-loss actions have unique labels and navigate with Enter
  to their own exact cards without extra requests.
- Populated collapsed and expanded cards receive explicit horizontal-clipping,
  document-overflow and fixed-navigation bottom-clearance checks.
- Future captures scroll to the cockpit controls, Command overview or stale-state
  content rather than photographing only the page header. Future expired-state
  images are named `-stale.png`.

The corrected view unit suite passed locally: **20/20**, including the new
same-symbol/equal-loss action-label test. The corrected browser test passed Node
syntax checking. Chromium/Chrome is unavailable in this local environment, so
browser execution and new screenshots remain pending exact-candidate CI.

## Limits

All fixtures are synthetic; no account data or private credentials are used.
Nothing here establishes real Pionex-account behavior, physical-device or
Safari/PWA acceptance, deployment, production readiness or operational authority.
