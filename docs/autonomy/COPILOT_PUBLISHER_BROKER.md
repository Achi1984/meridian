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
4. Inside that context only, provide the yielded token to the existing fixed Draft POST boundary; pin the same reviewed bot login. Keep ordinary reads/Git writes on the original job token. Clear any temporary token environment binding before leaving the context.
5. Reconcile failures instead of retrying the consumed one-shot claim. The context attempts revocation before returning.

Required activation inventory: actual dedicated App and installation identity; owner-approved PR-write-only installation limited to Meridian; publisher-only private-key storage; reviewed mint/publish/revoke workflow wiring; effective verified branch protections covering the original Contents-write job token without bypass; chosen approved packet and active time window; subsequent live CI-without-manual-approval evidence. The latest root observation found main unprotected and no rulesets, so leaving current protections unchanged is insufficient. The broker proves the minted token is restricted to one repository; selected-installation mode alone does not prove the installation itself contains only Meridian. The owner must verify that separate installation constraint. PR-write is broader than creation, and the broker's checks do not make it intrinsically create-only. No App installation, credential storage, workflow activation or new automatic follow-on packet is provided by this patch.

Validation: `node --test test/copilot-publisher-broker.test.js` passes 10 tests. HTTP/signing are mocked for failure cases; a local ephemeral RSA key additionally verifies the actual OpenSSL signature path. No network or paid model calls are used.

Official references:
- https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
- https://docs.github.com/en/rest/apps/installations#revoke-an-installation-access-token
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
