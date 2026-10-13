# B3 bot-read integration candidate

Prepared against main78c694256a2b0da8f79c02733bcd9e18568aca02. Not activated.

The page accepts an existing Meridian read credential only into memory. It does
not read V10 storage, exchange credentials, URLs or cookies. Provision clears
the input and does not fetch; only the explicit refresh action reads the fixed
existing protected endpoint. Lock, pagehide and hidden visibility clear access
and abort in-flight work. Focus/pageshow revalidate without fetching.

The validated model now supplies expiresAt from its actual source freshness
limit. A single cancellable deadline invalidates foreground data at expiresAt+1;
it does not poll or fetch. New states, lock and disposal cancel the old deadline.

The original navigation owner remains unchanged. Shell checks permit exactly
one added local bootstrap module; inline network, storage, engine, forms, iframe
and PWA guards remain. The historical terminal-entry test reverses ten exact B3
source deltas to the unchanged B2 blob and original older baseline hash.

Integrated Chrome acceptance is prepared using the existing helper. Its local
test server serves exactly five named modules and two actual documents. Only
the served copy of the fixed client endpoint is substituted with a synthetic
same-origin GET fixture; test CSP permits those exact paths. Production sources
retain the fixed gateway URL. No production CSP or backend CORS change is claimed.
Browser assertions cover manual fresh reads, absence of mount/provision reads,
lock, synthetic hidden-event abort, focus without fetching, and four widths.
Fresh-state screenshots use the existing V11_A2_EVIDENCE_DIR artifact route.

Validation:34 selected nonbrowser tests plus the historical reversal test pass.
Browser-test syntax passes; integrated browser assertions and screenshots have
not run. One overly broad test-name filter also selected the browser test, which
stopped before launch because no Chrome binary exists; no local browser was run.

ENGINE_BRIDGE_READINESS.md's historical BLOCKED engine assessment is unchanged.
This isolated bot consumer proves neither V9 engine parity nor Safari/iPhone/PWA
acceptance. CI, independent review, visual acceptance and concrete activation
approval remain required. Token access memory module is new to this packet and
ships its eight existing tests. No workflow or account provisioning changes.
