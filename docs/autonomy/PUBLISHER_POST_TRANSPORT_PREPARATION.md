# Bounded POST transport — inactive preparation

The transport factory requires explicit host fetch injection. Nothing imports it
into a production route, workflow or sender. Tests use fake tokens and simulated
fetch only. No new credentials, actual comments, DB runs or activation are requested.

The primitive fixes the repository and mailbox571 POST URL, rejects redirects,
limits body to8192 UTF-8 bytes and response to128KiB, and bounds the whole operation
to4.5seconds including response streaming.

An optional Content-Length header is checked before acquiring a stream reader;
malformed or oversized declarations reject early. The streaming cap always remains
mandatory because the header can be absent or inaccurate and compression can change
the decoded size. A single transport chunk can still be materialized before checking.
It returns a captured201 response for
`capturePublicationResponse`; that service still checks comment identity, actor,
body and fresh admission before conditional record retention. JSON capture is not
proof of authenticity: fetch injection is a trusted-host dependency.

One instance permits one attempt, consumed synchronously before awaiting network
work. This is local exclusion only, not durable replay protection. Recreating an
instance never grants another attempt. The future authenticated host must obtain
fresh admission and an acknowledged durable reservation BEFORE using the primitive,
and must retain that consumed reservation after any uncertain outcome. Any network,
HTTP, response or timeout failure after the attempt starts is UNCERTAIN, never a
retry signal or proof that GitHub published nothing. Late responses are discarded
and cancelled. Cancellation cannot undo a server-side write.

No automatic retry, storage settlement or admission is hidden in this transport.
All authority and durability flags stay false. Host bootstrap, authentication,
credential acquisition, atomic admission/reservation orchestration, production DB
durability and signed receipts remain separate unresolved integration work.
Capture's temporal validation is now prepared separately in
`PUBLISHER_TIME_WINDOW_PREPARATION.md`; the transport does not itself generate or
authenticate that reservation/send/receive metadata.

PR772's prior-head CI38524976030 failed in the existing V10 keyboard test because
Chrome DevTools startup timed out. CI38524903156 passed. The new source head must
receive its own CI and review; no unrelated browser source is changed on that basis.
