# Approved one-shot activation packet

Owner explicitly approved installation, existing-token identity check and one documentation assignment at 2026-10-12 19:40:09 Europe/Vienna, recorded in mailbox #571 comment 6129451717. This records scoped authorization, not proof of technical token permissions.

Approved scope: installation of `.github/workflows/native-assignment-pilot-once-20261012.yml`,
one owner-only manual run number 1 / attempt 1, and use of existing secret
MERIDIAN_NATIVE_AGENT_TOKEN for one bounded account-identity check and at most
one native Copilot assignment to one newly created documentation-only issue.
No recurring automation, second issue, retries, claim cleanup or extra spending.
Three-minute job budget; three source GETs, one GET /user, dispatcher maximum
12 requests (normally 8), so maximum 16 HTTP requests overall (normally 12).
The permanent claim is retained even on failure/uncertainty. Lead reviews and
merges resulting work separately. Stop if outcome is unclear.

Owner reported repo-only seven-day fine-grained PAT creation and secret setup.
That is provenance evidence from the owner, not a technical permissions audit.
The approval follows the reported setup of the described user token,
reported to belong to Achi1984, target only Meridian, and have the previously specified
metadata/actions/contents/issues/pull-request permissions and sufficient expiry.
The live bounded GET /user verifies account identity only; it never proves all
permissions, expiry, or eligibility. No token content is displayed or logged.
Any failed account check blocks assignment. No credential check has yet run.

## Exact completion sequence after approval

1. Review/test/merge this single workflow installation; do not dispatch yet.
2. Confirm all required postchecks green. Record final main SHA and successful
   main-push Release Safety run ID, actual attempt, workflow ID, actors and SHA.
3. Create one fresh issue using the reviewed documentation-only body in
   docs/autonomy/native-assignment-pilot-issue.txt. Read back body and assignees;
   hash exact stored UTF-8 body. Confirm no prior SQLite or GitHub claim for issue.
4. Fill existing exact-schema config on an isolated commit (not main): issue,
   digest, final main, successful source run pins, exact assignees and owner-set
   concrete short expiry. Have lead independently review the exact config SHA.
5. Owner-authorized lead dispatch supplies that immutable config_commit_sha.
   Strict 40-hex and fixed config path; source code stays pinned to fc706326.
   Config/main comparison runs before user-token exposure and again before runtime.
6. Observe assignment result and resulting Copilot draft. Preserve claim and stop
   on ambiguity. Disable the one-shot workflow afterward; do not rerun or change
   receiver run number to recover. Further native assignment needs another approval.

Remaining pins are intentionally not invented before installation: fresh issue
number/bodydigest, installed main/source Safety run/attempt/workflow ID, expiry,
and final config commit. The supplied config SHA is trusted because the
owner-authorized lead selects the reviewed exact commit; syntax validation alone
is not authorization. Source safety attempt is separate from receiver attempt 1.

This approved source packet requires independent review and CI before merge. It has not been dispatched or used to read the secret. Existing event listeners/external webhook and permanent-retention
assumptions still require the lead's preflight check.
