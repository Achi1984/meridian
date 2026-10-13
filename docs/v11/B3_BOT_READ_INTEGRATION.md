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

Validation: 34 selected nonbrowser tests plus the historical reversal test passed
for the initial draft. The authentication-rejection correction passed 15 targeted
tests and independent local review. At source head
00fca5e9bfe1a5f121e3784f599396ac16a380fd, CI run 38349996422 passed 2322/2322
tests, including integrated Chrome acceptance. Artifact 11790571086 has SHA256
56708726b31cec1b1a81b0d3c09d8ee1f14e3edf5557672ab86bc22d626e0fa9.
The lead inspected all four integrated fresh screenshots (320/375/390/430):
readable controls and no visible horizontal overflow. These use synthetic data;
real-account and iPhone/Safari validation remain outstanding.
Review 5499081564 reports zero open findings but is COMMENTED, not APPROVED;
it requests exact-head CI and human validation. The complete PR now spans
14 files after adding the B3 history-browser expectation correction.
No local browser was run. This documentation-only follow-up changes the head,
so its own exact-head CI/review must still be checked before activation.

ENGINE_BRIDGE_READINESS.md's historical BLOCKED engine assessment is unchanged.
This isolated bot consumer proves neither V9 engine parity nor Safari/iPhone/PWA
acceptance. CI, independent review, visual acceptance and concrete activation
approval remain required. Token access memory module is new to this packet and
ships its eight existing tests. No workflow or account provisioning changes.
