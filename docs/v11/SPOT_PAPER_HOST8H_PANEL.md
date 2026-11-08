# BTC/EUR host eight-hour status panel

## Scope

`v11/spot-paper-host8h-model.js` and `v11/spot-paper-host8h-view.js` are an
inert presentation boundary for explicitly supplied host status snapshots and
offline assessment results. They are separate from the existing spot-paper
terminal DTO, controller, connector, private endpoint, and gateway admission
rules. The panel is not mounted from `v11/index.html`, starts no request, and
does not poll or otherwise connect to the host.

The preview accepts a caller-injected `readSnapshot` function. It has no
default fixture or current-run data; without the function, it renders an
offline/unavailable state. Inputs must use
`SPOT_PAPER_HOST8H_PANEL_INPUT_V1` and fit within 256 KiB. They include the
observed timestamp, source label, pinned run/profile/source identity, a host
inspection snapshot, and optionally an offline assessment.

## Status and evidence

The adapter keeps `RUNNING_OBSERVED`, `VERIFIED_TERMINAL`,
`INCOMPLETE_UNKNOWN`, failed assessment, unavailable, stale, and out-of-order
states distinct. A running process observation is not a terminal report or
health check. A terminal display requires the host snapshot's
`verifiedTerminal: true`; summary metrics additionally require a matching
`SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1` whose nested assessment confirms the
run, profile, source fingerprint, and `terminalVerified: true`.

The completed presentation is limited to a completed assessment with bounded
termination. Partial duration and coverage remain partial; absent values remain
unknown, not zero. Monetary values are shown in EUR from the assessment's
integer-cent fields, and open BTC inventory is labeled in satoshis. PnL uses
the existing muted/red/green tone convention. All caller-supplied snapshots
remain unauthenticated by this UI, including ones whose status says
`VERIFIED_TERMINAL`; the source label and observed timestamp are provenance
fields, not attestations. Freshness is display-only, and the adapter rejects an
older observation after a newer one has been read within that adapter
instance.

The existing one-hour and four-hour gateway identifiers and their admission
rules are unchanged.

## Next wiring boundary

Live integration still requires a separately reviewed authenticated host8h
summary transport and an admission review for that transport. This panel alone
is not live integration, does not authenticate host data, and does not expand
the approved one-hour or four-hour gateway IDs. It does not read host volumes,
poll the current run, deploy anything, or affect pilot execution or post-run
assessment.

## Focused offline verification

```sh
node --test test/spot-paper-host8h.test.js
```

Tests use injected in-memory fixtures only; they do not call the host, a
provider, a private endpoint, or a gateway.
