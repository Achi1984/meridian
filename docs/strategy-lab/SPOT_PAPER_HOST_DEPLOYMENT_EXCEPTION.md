# BTC/EUR eight-hour host egress exception

## Owner-accepted, one-run exception

On 2026-11-08 the owner accepted
[`NOT_ENFORCED_EXCEPTION_ACCEPTED`](https://github.com/Achi1984/meridian/issues/1279#issuecomment-6721607500)
for exactly one `BTC_EUR_PAPER_HOST_8H_V1` run on
`meridian-btc-paper-host-8h`. Container egress will not be independently
filtered for this run. This status is an accepted policy exception, never
`NETWORK_PASS`, host readiness, or evidence that a run has started or completed.

The only permitted provider operations remain the reviewed fixed public Kraken
GET operations, with the reviewed redirect rejection and existing request,
response-byte, total-byte, cycle, duration, and request-time bounds unchanged.
No actual trading, credentials, auto-retry, continuous operation, scheduler, or
additional provider is permitted. Before launch, the operator must confirm
that the **whole Job** has no attached or inherited secrets, including exchange,
database, and report credentials, without exposing or logging any secret values.

This narrow decision does not waive any other launch condition. Reviewed source
and image, storage verification, independently prepared expected context,
authenticated full-evidence retrieval, and offline assessment remain required.
The host run remains unlaunched by this documentation change.

The general requirement in
[`SPOT_PAPER_HOST.md`](SPOT_PAPER_HOST.md) for restricted egress to the fixed
Kraken endpoints remains unchanged for every other run, host, profile, and
deployment. This exception is not reusable or inheritable.
