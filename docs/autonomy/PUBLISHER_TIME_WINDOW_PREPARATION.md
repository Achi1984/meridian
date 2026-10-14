# Publication time window — inactive host integration prerequisite

PR772 is merged at4eefa87205dd7072031c6344c7dad421097a6bdf with all required
post-merge checks successful. This packet remains source-only, with no live host,
credential acquisition, actual POST, new database run or activation.

Capture now requires a separate host dependency `publicationWindow` containing
exactly `reservedAtMs`, `sendStartedAtMs`, `responseReceivedAtMs`. Missing or invalid
metadata fails closed before admission. Times are copied before awaiting admission.
The reservation must precede send, send must precede receive, reservation-to-send
is bounded to900seconds and transport duration to4500milliseconds. After fresh
admission, capture requires receive not in the future and at most30seconds old.
The pinned `publicationClock` supplies epoch milliseconds (default `Date.now`),
separate from admission's epoch-second clock. Rounding admission seconds cannot be
used for receive freshness: it would reject valid subsecond responses as future.
These are conservative engineering limits, not permission to execute a send.

The unedited comment creation second must fall within send/receive second buckets.
This rejects old matching responses outside that interval; GitHub's second precision
cannot distinguish an earlier comment within the same second. There is no invented
millisecond precision and no clock-skew allowance. Misaligned host/GitHub clocks fail
closed and require reconciliation, never resend. The host must maintain a trusted,
coherent clock; time checks alone do not establish authenticity or monotonic time.

The future host must derive reservation time from the acknowledged reservation for
the exact admission binding and capture send/receive times around the real transport.
This packet validates supplied metadata; it does NOT implement that authenticated
derivation, binding, durable orchestration or production storage. Host metadata must
never come from an HTTP request. A forged trusted window can still pass checks.
Post-response rejection leaves the reservation consumed: no retry or settlement.
All authority/durability flags remain false; no production readiness is claimed.
