# Inactive publisher token broker

This source-only R2 extends #662's separate publisher credential boundary. Trial3 remains the existing live proof. No workflow, claim, source SHA, deadline, activation setting or successor descriptor is changed.

`scripts/copilot-publisher-broker.py` has no executable entry point or import-time IO. `PINS = None` fails closed. The verified account ID `319562141` and repository ID `1342084551` bind Achi1984/meridian; actual App ID, slug, bot login and installation ID remain unconfigured. The bot login must equal the reviewed slug plus `[bot]`; the final PR author is verified by the existing publisher. The built-in github-actions identity is rejected.

Before minting, the broker checks GitHub's `/app`, `/app/installations/{id}` and exact repository installation responses, including owner, unsuspended installation and selected-repository mode. It requests exactly `repository_ids: [1342084551]` and `permissions: {pull_requests: write}`. The returned token must identify only this repository and PR-write (optional implicit metadata-read); a separate installation-repositories read confirms its effective repository scope. Other grants and all-repository mode fail closed.

GitHub issues installation tokens for up to one hour; a local pilot deadline does not shorten that server lifetime. Expiry validation uses the post-mint clock, allows ordinary identity-check latency and requires over 30 seconds of remaining lifetime. This broker does not implement token refresh, retries or a new pilot deadline. The trusted publishing caller must still enforce the existing pilot deadline.

`publisher_token(...)` yields to the trusted publisher and revokes in `finally`, including consumer exceptions and interruption exceptions. Decoded malformed mint responses containing a usable token trigger revocation. If transport failure, invalid raw JSON, duplicate JSON keys or response bounds prevent extraction of the token, the mint outcome is unknown: no retry, no claimed revocation, explicit reconciliation required. A revocation failure is surfaced together with the failed stage, without raw exception or response text. Python objects may retain sensitive data in memory; do not expose traceback locals or pass broker objects to untrusted code.

Concrete adapters are included but unwired. `github_http` restricts requests to GitHub HTTPS, refuses redirects, bounds responses, applies a timeout and never retries. `rsa_signer` signs RS256 using `/usr/bin/openssl`, a private 0600 temporary file, sanitized subprocess environment, no shell and no key in argv/environment. It removes temporary material on success and failure. The signing closure retains key bytes while needed; use it only in the separate publisher job. Never make the key, JWT, token or broker environment available to the model/generator, artifact or logs.

Unwired integration sequence (documentation only):

1. Trusted publish job loads this broker and the reviewed pilot helper from their pinned control commit.
2. Load the reviewed App pins and private key through the approved publisher-only secret channel; build `rsa_signer(key)`.
3. Enter `publisher_token(http=github_http, sign=signer, pins=reviewed_pins)`.
4. Inside that context only, provide the yielded token to the existing fixed Draft POST boundary; pin the same reviewed bot login. Keep ordinary reads/Git writes on the original job token. Pass the token as an in-memory argument to that single POST; never bind it to an environment variable.
5. Reconcile failures instead of retrying the consumed one-shot claim. The context attempts revocation before returning.

Required activation inventory: actual dedicated App and installation identity; owner-approved PR-write-only selected-repository installation (scope recorded below); publisher-only private-key storage; reviewed mint/publish/revoke workflow wiring; effective verified branch protections covering the original Contents-write job token without bypass; chosen approved packet and active time window; subsequent live CI-without-manual-approval evidence. The latest root observation found main unprotected and no rulesets, so leaving current protections unchanged is insufficient. The broker proves the minted token is restricted to one repository; selected-installation mode alone does not prove the installation itself contains only Meridian. The owner must verify the separately approved installation scope; it must not be confused with the narrower runtime token scope. PR-write is broader than creation, and the broker's checks do not make it intrinsically create-only. No App installation, credential storage, workflow activation or new automatic follow-on packet is provided by this patch.

Validation: `node --test test/copilot-publisher-broker.test.js` passes 10 tests. HTTP/signing are mocked for failure cases; a local ephemeral RSA key additionally verifies the actual OpenSSL signature path. No network or paid model calls are used.

Official references:
- https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
- https://docs.github.com/en/rest/apps/installations#revoke-an-installation-access-token
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app

## Concrete wiring proposal — 2026-10-11 (inactive, not an activation approval)

Base inspected: `d4b4a82b16d1b9ec0e9b1ebcf9494dbbfb77b1db`. This document changes no executable pins, workflow, secret, repository setting, packet, deadline or claim.

### Provisioning evidence and candidate pins

| Item | Value | Evidence |
| --- | --- | --- |
| App ID | 5272026 | Registration observed by lead in GitHub UI |
| App slug | meridian-draft-publisher | Registration observed by lead |
| Expected bot login | meridian-draft-publisher[bot] | Derived candidate; verify actual Draft author before accepting success |
| Installation ID | 170212503 | Owner supplied settings URL at 11:32:14 Europe/Vienna; authenticated verification pending |
| Owner | Achi1984 / 319562141 | Existing broker owner pin; revalidate at runtime |
| Runtime repository | Achi1984/meridian / 1342084551 | Existing broker repository pin |
| Installation scope | meridian and achi-meridian, selected mode | Owner screenshot IMG_0123 and explicit retention approval at 11:30:09 Europe/Vienna |
| Permissions | pull_requests:write, metadata:read | Owner installation screenshot |

The original provisioning approval limited installation to Meridian. The later explicit owner decision supersedes only that installation scope. It authorizes no work on achi-meridian and no broader runtime token. The existing mint payload and both one-repository token checks stay unchanged. No source change to those checks is needed.

### Smallest implementation packet for review

1. Extend the existing trusted helper's publish phase to load the existing broker from the same immutable reviewed control commit. Load no executable artifact content. Candidate pins may be committed before authentication because the broker authenticates them at runtime using the key; any mismatch fails closed. They are not proof of verified identity. This source-only preparation keeps defaults unconfigured.
2. Add a narrowly scoped trusted runner boundary that enters `publisher_token`, supplies its result only around the existing fixed Draft POST, verifies the author and head/base response, never places the token in the environment, and exits the context to revoke. Avoid minting during artifact validation or branch construction: refactor the early `publisher_token()` preflight into a non-secret configuration check. The model/generator never receives App credentials.
3. In the existing publish job, reduce the ordinary job token from pull-requests:write to pull-requests:read once the dedicated POST path is wired. Keep only required contents:write and actions:read. Preserve separate claim/generate runners and no App secret in either job.
4. Introduce a dedicated environment `meridian-draft-publisher` and one environment secret `MERIDIAN_PUBLISHER_APP_PRIVATE_KEY`, subject to explicit owner approval and verified environment restrictions. Choose the whole existing publish job to wait for environment approval, including its Contents-write steps; do not split the job or imply a step-level environment approval. Proposed delivery: bind the secret only to the trusted publisher step's environment; immediately consume and remove it from the Python environment before any child process, preserve the signer's sanitized OpenSSL environment, and never interpolate it into shell source, argv, output, artifacts or generated code. This is a deliberate change from the earlier no-key-environment design, not an already approved guarantee. Removing an environment entry does not scrub the original process /proc environment or the runner's copy. Therefore the job must run no untrusted code, and only one step may bind the secret; that step execs only the hash-pinned helper. Review OS-level same-user/process access and choose another supported secret transport if this boundary is unacceptable. An environment name alone provides no security guarantee.
5. Load helper and broker by reviewed immutable SHA and SHA-256 hashes recorded as literals in that same reviewed workflow commit. Verify both with sha256sum -c before execution. Do not introduce arbitrary command inputs, manual dispatch, PR-controlled checkout, artifact imports, or reusable-workflow callers with secret access.
6. Keep the consumed Trial3 packet, branch, source event and deadline untouched. Any future finite trial requires a new reviewed packet identity, fresh branch, exact source event SHA, fixed active window and invocation budget, plus explicit owner approval. This proposal does not select or activate that packet. The source wiring keeps the existing fixed packet constants, consumed-claim check and expired deadline; it does not generalize packet selection. A separate fresh-packet change must also correct the stale Draft body text about manual CI approval.

### Required repository controls before secret storage or use

The previous observation of unprotected main is not a verified current protection inventory. Re-read effective rules using an authorized administrative surface. Proposed minimum: PR-only changes to main, no force pushes or deletion, required successful CI and independent exact-head review, and no bypass for the App or the original contents-write job token. Required check names and review enforcement must be chosen from live successful runs and actual account capabilities; do not invent settings or assume GitHub plan support. Before storing the secret, verify effective main protection without bypass, environment deployment-branch policy restricted to main, and absence of PR/fork-controlled entry points. Verify the effective rules and restricted environment branch/reviewer settings after configuration. These settings are separately owner-gated and are not changed here.

The App private key can authorize all owner-approved installed repositories; a runtime token limited to Meridian does not remove that key-level authority. Prevent unreviewed workflows from accessing the environment secret. A first finite trial may require environment reviewer approval; unattended operation remains a later authorization and design decision. Verify plan support and the real reviewer configuration: preventing self-review would block a sole owner who is also the triggering actor.

### Acceptance evidence

- Offline tests retain mismatch rejection for App, owner, installation, permissions and repository; a selected installation may cover both approved repositories while the mint request/response and token listing remain Meridian-only.
- Orchestration tests prove artifact-validation failures cause zero mints, the fixed POST receives the separate token, ordinary API calls retain the ordinary job token, and success/POST failure/interruption attempts revocation without logging credentials.
- Secret-isolation tests inspect the generator environment and child process environment; no App key/JWT/token reaches either or an artifact.
- No retry after ambiguous mint/POST/revocation. Consumed claims stay consumed. Abrupt runner termination cannot guarantee a finally block; server expiry and explicit reconciliation remain necessary.
- Reviewed exact implementation head/base plus required CI and independent review precede owner merge/activation decisions.
- A separately approved finite live run must produce one App-authored Draft and demonstrate required CI starts without a maintainer restarting CI. Environment approval, if used, is a distinct manual gate; do not call that unattended execution.
- Record mint time, server expiry, minted scope, PR identity and revocation outcome as non-secret evidence. Failed or unknown revocation stops subsequent work; never publish a token as proof.

### Remaining external gates

Authenticated verification of installation 170212503 and App identity; owner-controlled private-key storage; effective branch/environment protections; reviewed implementation; a concrete approved fresh trial. No live run or secret collection is authorized by merging this proposal.

## Source-only memory boundary prepared with this candidate

The helper now separates bot configuration from explicit token validation, accepts an injected context-manager factory in publish, and routes the yielded token as an in-memory API argument. No environment-token fallback remains. The factory is entered only after artifact validation and branch preparation. The CLI supplies no factory, the bot pin stays None, and the old packet/deadline is unchanged, so this does not make the pilot executable. Workflow wiring, key loading, configured App pins, environment/protection changes and fresh trial remain unimplemented gates above.

Focused tests use recording context managers and simulated credentials to exercise lifecycle ordering and cleanup on errors; they do not prove real token revocation. The existing broker suite separately covers revocation transport with mocked HTTP and signing. Only a later explicitly authorized live run can establish live App identity and revocation evidence.
