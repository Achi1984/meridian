# B11 bot presentation delivery

The collapsed card leads with symbol, direction/leverage badges and signed P/L.
Capital is secondary; USD amounts use German two-decimal formatting, with an
explicit signed `<0,01` for nonzero values below one cent. Existing USD/USDT
capital units remain unchanged. Native Details disclosures expose the technical
reference and original numeric precision. Source values, sort inputs, snapshot
count semantics, and read-only behavior are unchanged.

## Synthetic visual comparison

Before and after images use the same six-bot synthetic fixture, including
duplicate BTC symbols, unavailable and zero P/L, and a tiny nonzero P/L.

| Viewport | Before | After |
| --- | --- | --- |
| 320×568 | [before](evidence/b11-bots-presentation/before-320x568.png) | [after](evidence/b11-bots-presentation/after-320x568.png) |
| 390×844 | [before](evidence/b11-bots-presentation/before-390x844.png) | [after](evidence/b11-bots-presentation/after-390x844.png) |

[After at 320×568 with enlarged text](evidence/b11-bots-presentation/after-320x568-enlarged-text.png)

Actual-shell Chromium checks passed at 320×568, 375×667, 390×844, 430×932
and 1440×900. The largest collapsed card measured 148.39px at 320px width;
maximums at 375px, 390px and 430px were 117.28px, and all cards measured
110.64px at 1440px. Enlarged text grew naturally without overlap, clipping or
horizontal overflow. Visible filter/action controls and disclosures meet the
44px touch-target minimum. The run covered keyboard Command jump/return,
same-snapshot disclosure persistence, filters without extra reads, and clearing
on new, locked, stale and error states.

All screenshots and browser data are synthetic. These checks do not establish
real-account behavior, physical-device/browser coverage, deployment, activation,
or operational readiness.
