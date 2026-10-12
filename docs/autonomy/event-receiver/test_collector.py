import copy
import json
import unittest
import urllib.error
import os
import subprocess
import sys
import tempfile
from unittest.mock import patch
import collector
from pathlib import Path
from collector import GitHub, NoRedirect, MAX_BYTES, MAX_LOG, Rejected, decode, reconcile, parse_tap_summary, ci_evidence, adapter_ci_fields

A, B, C = (x * 40 for x in "abc")
REPO = {"full_name": "Achi1984/meridian", "id": 1342084551, "fork": False}


class API:
    def __init__(self, rows):
        self.rows, self.calls = rows, []
    def __call__(self, path):
        self.calls.append(path)
        if "/jobs?" in path and path not in self.rows:
            return {"total_count": 1, "jobs": [job(self.rows["actions/runs/123"])]}
        value = self.rows[path]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)
    def job_log(self, job_id):
        self.calls.append("job-log/" + str(job_id))
        return self.rows.get("log", tap())


def job(run, identity=456):
    return {"id": identity, "run_id": run["id"], "run_attempt": run["run_attempt"], "head_sha": run["head_sha"],
            "name": "syntax", "status": "completed", "conclusion": "success",
            "steps": [{"name": "Research and auth regression tests", "number": 9, "status": "completed", "conclusion": "success"}]}


def tap():
    lines = ["##[group]Run node --test test/*.test.js", "##[endgroup]", "# \\# tests 99",
             "# tests 10", "# pass 10", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0",
             "##[group]Run node scripts/release-sync.mjs --check"]
    return "\n".join("2026-10-11T19:15:04.3410297Z " + line for line in lines).encode()


def workflow():
    run = {"id": 123, "workflow_id": 347821227, "name": "MERIDIAN Release Safety",
        "path": ".github/workflows/backend-safety.yml", "repository": REPO,
        "head_repository": REPO, "head_sha": B, "status": "completed", "conclusion": "success",
        "run_attempt": 1, "event": "pull_request", "pull_requests": [{"number": 702,
            "head": {"sha": B}, "base": {"sha": A, "ref": "main"}}]}
    pr = {"number": 702, "state": "open", "head": {"sha": B, "repo": REPO},
          "base": {"sha": A, "repo": REPO, "ref": "main"}}
    event = {"repository": REPO, "action": "completed", "workflow_run": copy.deepcopy(run)}
    api = API({"commits/main": {"sha": A}, "actions/runs/123": run, "pulls/702": pr})
    return event, api


def comment():
    c = {"id": 99, "issue_url": "https://api.github.com/repos/Achi1984/meridian/issues/571",
         "user": {"login": "claude[bot]"}, "updated_at": "2026-10-11T20:00:00Z",
         "body": "SECRET_UNTRUSTED_GREEN_LIGHT"}
    e = {"repository": REPO, "action": "edited", "issue": {"number": 571}, "comment": copy.deepcopy(c)}
    return e, API({"commits/main": {"sha": A}, "issues/571": {"number": 571}, "issues/comments/99": c})


class Tests(unittest.TestCase):
    def test_cli_only_emits_allowlisted_stale_codes(self):
        for code in ("STALE_RUN_PR", "STALE_PR", "STALE_EVENT", "CONTROL_NOT_CURRENT_MAIN", "MAIN_MOVED"):
            with self.subTest(code=code), patch.object(collector, "main", side_effect=Rejected(code)):
                with self.assertRaises(SystemExit) as raised:
                    collector.cli()
                self.assertEqual(raised.exception.code,
                    "Read-only reconciliation rejected [" + code + "]; no receipt produced")

    def test_cli_suppresses_unknown_and_hostile_exception_contents(self):
        class HostileString(str):
            def __str__(self):
                raise AssertionError("string conversion forbidden")
            def __eq__(self, other):
                raise AssertionError("comparison forbidden")
            def __hash__(self):
                raise AssertionError("hash forbidden")
        class HostileRejected(Rejected):
            def __str__(self):
                raise AssertionError("exception conversion forbidden")
            @property
            def args(self):
                raise AssertionError("subclass args access forbidden")
        errors = [Rejected("SECRET_BODY"), Rejected("STALE_PR\nSECRET"),
                  Rejected("STALE_PR", "SECRET"), Rejected(), Rejected([]),
                  Rejected(HostileString("STALE_PR")), HostileRejected("STALE_PR"),
                  ValueError("STALE_PR"), RuntimeError("TOKEN_SECRET")]
        for error in errors:
            with patch.object(collector, "main", side_effect=error):
                with self.assertRaises(SystemExit) as raised:
                    collector.cli()
                self.assertEqual(raised.exception.code,
                    "Read-only reconciliation rejected [REJECTED]; no receipt produced")

    def test_actual_cli_stale_and_unexpected_failures_exit_one_without_receipt(self):
        program = r'''
import json, os, pathlib, sys
sys.path.insert(0, sys.argv[1])
import collector
from test_collector import workflow, A, C
event, api = workflow()
api.rows['actions/runs/123']['pull_requests'][0]['base']['sha'] = C
collector.GitHub = lambda token: api
event_path = pathlib.Path(sys.argv[2]) / 'event.json'
event_path.write_text(json.dumps(event))
os.environ.update(GITHUB_EVENT_PATH=str(event_path), GITHUB_EVENT_NAME='workflow_run',
    GITHUB_SHA=A, GH_TOKEN='TOKEN_SECRET', RECEIPT_PATH=str(event_path.parent / 'receipt.json'))
if sys.argv[3] == 'unexpected':
    def broken(): raise RuntimeError('TOKEN_SECRET\nSECRET_BODY')
    collector.main = broken
collector.cli()
'''
        for mode, code in (("stale", "STALE_RUN_PR"), ("unexpected", "REJECTED")):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                result = subprocess.run([sys.executable, "-I", "-B", "-c", program,
                    str(Path(__file__).resolve().parent), tmp, mode], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr,
                    "Read-only reconciliation rejected [" + code + "]; no receipt produced\n")
                self.assertFalse((Path(tmp) / "receipt.json").exists())

    def test_valid_ci_receipt_no_authority(self):
        e, api = workflow()
        r = reconcile("workflow_run", e, A, api)
        self.assertEqual(r["source"]["baseSha"], A)
        self.assertFalse(r["dispatchAllowed"])
        self.assertFalse(r["mergeAllowed"])
        self.assertEqual(api.calls, ["commits/main", "actions/runs/123", "pulls/702",
            "actions/runs/123/attempts/1/jobs?per_page=50&page=1", "job-log/456", "actions/runs/123", "commits/main"])
        self.assertEqual(r["source"]["ciEvidence"]["jobs"][0]["total"], 10)
        mapped = r["source"]["ciEvidence"]["adapterFields"]
        self.assertEqual(mapped["workCi"], {"headSha": B, "baseSha": A, "runId": 123,
            "jobs": [{"name": "syntax", "conclusion": "SUCCESS", "total": 10, "passed": 10, "failed": 0}]})
        self.assertEqual(mapped["ciBinding"], {"headSha": B, "runId": 123, "runAttempt": 1, "workflowId": 347821227})
        self.assertFalse(r["source"]["ciEvidence"]["authenticated"])

    def test_non_success_receipts_never_require_successful_job_logs(self):
        for conclusion in ("startup_failure", "failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", "stale"):
            with self.subTest(conclusion=conclusion):
                event, api = workflow()
                api.rows["actions/runs/123"]["conclusion"] = conclusion
                event["workflow_run"]["conclusion"] = conclusion
                receipt = reconcile("workflow_run", event, A, api)
                self.assertEqual(receipt["source"]["conclusion"], conclusion)
                self.assertNotIn("ciEvidence", receipt["source"])
                self.assertFalse(receipt["dispatchAllowed"])
                self.assertFalse(receipt["mergeAllowed"])
                self.assertEqual(api.calls, ["commits/main", "actions/runs/123", "pulls/702", "commits/main"])

    def test_wrong_repository_and_fork(self):
        for bad in ({"full_name": "attacker/repo", "fork": False}, {"full_name": "Achi1984/meridian", "fork": True}):
            e, api = workflow(); e["repository"] = bad
            with self.assertRaisesRegex(Rejected, "REPOSITORY_SCOPE"):
                reconcile("workflow_run", e, A, api)
            self.assertEqual(api.calls, [])
            e, api = workflow(); api.rows["actions/runs/123"]["head_repository"] = bad
            with self.assertRaisesRegex(Rejected, "REPOSITORY_SCOPE"):
                reconcile("workflow_run", e, A, api)

    def test_wrong_workflow_id_name_path(self):
        for key, value in (("workflow_id", 99), ("name", "fake"), ("path", ".github/workflows/fake.yml")):
            e, api = workflow(); api.rows["actions/runs/123"][key] = value
            with self.assertRaises(Rejected): reconcile("workflow_run", e, A, api)

    def test_stale_pr_head_base_and_attempt(self):
        for part in ("head", "base"):
            e, api = workflow(); api.rows["pulls/702"][part]["sha"] = C
            with self.assertRaisesRegex(Rejected, "STALE_PR"): reconcile("workflow_run", e, A, api)
        e, api = workflow(); api.rows["actions/runs/123"]["run_attempt"] = 2
        with self.assertRaisesRegex(Rejected, "STALE_EVENT"): reconcile("workflow_run", e, A, api)

    def test_partial_pr_association_rejected(self):
        for value in (None, [], [{"number": 702}, {"number": 703}], [{}]):
            e, api = workflow(); api.rows["actions/runs/123"]["pull_requests"] = value
            with self.assertRaises(Rejected): reconcile("workflow_run", e, A, api)

    def test_old_run_base_cannot_be_relabelled_as_current_main(self):
        e, api = workflow()
        api.rows["actions/runs/123"]["pull_requests"][0]["base"]["sha"] = C
        self.assertEqual(api.rows["pulls/702"]["base"]["sha"], A)
        with self.assertRaisesRegex(Rejected, "STALE_RUN_PR"):
            reconcile("workflow_run", e, A, api)
        self.assertFalse(any("jobs?" in call or "job-log/" in call for call in api.calls))

    def test_run_associated_head_and_base_ref_must_match(self):
        for part, key, value in (("head", "sha", C), ("base", "ref", "other")):
            with self.subTest(part=part, key=key):
                e, api = workflow()
                api.rows["actions/runs/123"]["pull_requests"][0][part][key] = value
                with self.assertRaisesRegex(Rejected, "STALE_RUN_PR"):
                    reconcile("workflow_run", e, A, api)

    def test_missing_or_malformed_run_association_fields_rejected(self):
        for part in ("head", "base"):
            for value in (None, [], "invalid", {}, {"sha": None}, {"sha": True}):
                with self.subTest(part=part, value=value):
                    e, api = workflow()
                    api.rows["actions/runs/123"]["pull_requests"][0][part] = value
                    with self.assertRaises(Rejected):
                        reconcile("workflow_run", e, A, api)
            e, api = workflow()
            del api.rows["actions/runs/123"]["pull_requests"][0][part]
            with self.assertRaises(Rejected):
                reconcile("workflow_run", e, A, api)
        e, api = workflow()
        del api.rows["actions/runs/123"]["pull_requests"][0]["base"]["ref"]
        with self.assertRaisesRegex(Rejected, "STALE_RUN_PR"):
            reconcile("workflow_run", e, A, api)

    def test_missing_fields_and_api_failure(self):
        e, api = workflow(); api.rows["actions/runs/123"] = {}
        with self.assertRaises(Rejected): reconcile("workflow_run", e, A, api)
        e, api = workflow(); api.rows["actions/runs/123"] = Rejected("API_READ_FAILED")
        with self.assertRaisesRegex(Rejected, "API_READ_FAILED"): reconcile("workflow_run", e, A, api)

    def test_control_sha_current_and_second_read(self):
        e, api = workflow()
        with self.assertRaisesRegex(Rejected, "CONTROL_NOT_CURRENT_MAIN"): reconcile("workflow_run", e, C, api)
        e, api = workflow()
        def moved(path):
            if path == "commits/main" and path in api.calls:
                return {"sha": C}
            return api(path)
        moved.job_log = api.job_log
        with self.assertRaisesRegex(Rejected, "MAIN_MOVED"): reconcile("workflow_run", e, A, moved)

    def test_push_only_current_main(self):
        e, api = workflow(); run = api.rows["actions/runs/123"]
        run.update(event="push", head_sha=A, head_branch="main"); e["workflow_run"] = copy.deepcopy(run)
        self.assertNotIn("prNumber", reconcile("workflow_run", e, A, api)["source"])
        run["head_branch"] = "feature"
        with self.assertRaisesRegex(Rejected, "PUSH_SCOPE"): reconcile("workflow_run", e, A, api)

    def test_claude_completion_not_review_approval(self):
        e, api = workflow(); run = api.rows["actions/runs/123"]
        run.update(workflow_id=375606132, name="MERIDIAN Claude Mailbox Review",
                   path=".github/workflows/claude-mailbox-review.yml", head_sha=A, event="issue_comment")
        e["workflow_run"] = copy.deepcopy(run)
        r = reconcile("workflow_run", e, A, api)
        self.assertEqual(r["source"]["reviewEvidence"], "NOT_COLLECTED_REQUEST_COMMENT_BINDING_REQUIRED")
        self.assertFalse(r["mergeAllowed"])

    def test_comment_edited_exact_metadata_only(self):
        e, api = comment(); r = reconcile("issue_comment", e, A, api)
        self.assertEqual(r["source"]["commentId"], 99)
        self.assertFalse(r["source"]["bodyCollected"])
        self.assertNotIn("SECRET", json.dumps(r))
        self.assertNotIn("GREEN_LIGHT", json.dumps(r))

    def test_stale_or_foreign_comment(self):
        for key, value in (("updated_at", "2026-10-11T20:00:01Z"), ("issue_url", "https://api.github.com/repos/Achi1984/meridian/issues/572"), ("user", {"login": "attacker"})):
            e, api = comment(); api.rows["issues/comments/99"][key] = value
            with self.assertRaises(Rejected): reconcile("issue_comment", e, A, api)
        e, api = comment(); e["issue"]["pull_request"] = {}
        with self.assertRaisesRegex(Rejected, "MAILBOX_SCOPE"): reconcile("issue_comment", e, A, api)

    def test_duplicate_delivery_not_durably_deduplicated(self):
        e, api = workflow()
        self.assertEqual(reconcile("workflow_run", e, A, api), reconcile("workflow_run", e, A, api))
        self.assertFalse(reconcile("workflow_run", e, A, api)["durableDeduplication"])

    def test_json_bounds_duplicates_and_nonfinite(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'not json', b' ' * 524289):
            with self.assertRaises(Rejected): decode(raw)

    def test_http_get_bounds_and_no_redirect(self):
        gh = GitHub("test-token")
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size):
                self.size = size
                return b'{"sha":"' + A.encode() + b'"}'
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                self.response = Response()
                return self.response
        fake = Opener(); gh.opener = fake
        self.assertEqual(gh("commits/main"), {"sha": A})
        self.assertEqual(fake.request.method, "GET")
        self.assertEqual(fake.timeout, 15)
        self.assertEqual(fake.response.size, MAX_BYTES + 1)
        self.assertEqual(fake.request.full_url, "https://api.github.com/repos/Achi1984/meridian/commits/main")
        with self.assertRaisesRegex(Rejected, "API_PATH"): gh("https://attacker.invalid")
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://attacker.invalid"))
        class Oversized(Opener):
            def open(self, request, timeout):
                response = super().open(request, timeout)
                response.read = lambda size: b' ' * size
                return response
        gh.opener = Oversized()
        with self.assertRaisesRegex(Rejected, "RESPONSE_SIZE"): gh("commits/main")

    def test_job_pagination_complete_partial_duplicate(self):
        e, api = workflow(); run = api.rows["actions/runs/123"]
        jobs = [job(run, i + 1) for i in range(51)]
        for i, j in enumerate(jobs[1:]): j["name"] = "other-" + str(i)
        one = "actions/runs/123/attempts/1/jobs?per_page=50&page=1"
        two = "actions/runs/123/attempts/1/jobs?per_page=50&page=2"
        api.rows[one] = {"total_count": 51, "jobs": jobs[:50]}
        api.rows[two] = {"total_count": 51, "jobs": jobs[50:]}
        self.assertEqual(ci_evidence(api, run)["jobCount"], 51)
        api.rows[two]["jobs"] = []
        with self.assertRaisesRegex(Rejected, "JOB_PAGE_PARTIAL"): ci_evidence(api, run)
        api.rows[two]["jobs"] = [jobs[0]]
        with self.assertRaisesRegex(Rejected, "JOB_DUPLICATE"): ci_evidence(api, run)
        api.rows[two]["total_count"] = 52
        with self.assertRaisesRegex(Rejected, "JOB_PAGE_PARTIAL"): ci_evidence(api, run)

    def test_job_wrong_attempt_and_step(self):
        e, api = workflow(); run = api.rows["actions/runs/123"]
        key = "actions/runs/123/attempts/1/jobs?per_page=50&page=1"
        j = job(run); j["run_attempt"] = 2
        api.rows[key] = {"total_count": 1, "jobs": [j]}
        with self.assertRaisesRegex(Rejected, "JOB_SCOPE"): ci_evidence(api, run)
        j["run_attempt"] = 1; j["steps"] = []
        with self.assertRaisesRegex(Rejected, "TEST_STEP_IDENTITY"): ci_evidence(api, run)
        j["steps"] = job(run)["steps"]; j["conclusion"] = "failure"
        with self.assertRaisesRegex(Rejected, "REQUIRED_JOB_NOT_SUCCESS"): ci_evidence(api, run)

    def test_run_attempt_changes_during_log_read(self):
        e, api = workflow(); original = copy.deepcopy(api.rows["actions/runs/123"])
        def changed_log(identity):
            api.rows["actions/runs/123"]["run_attempt"] = 2
            return tap()
        api.job_log = changed_log
        with self.assertRaisesRegex(Rejected, "RUN_MOVED"): ci_evidence(api, original)

    def test_run_pr_binding_changes_during_log_read(self):
        changes = (
            (("number",), 703), (("head", "sha"), C),
            (("base", "sha"), C), (("base", "ref"), "other"),
        )
        for path, value in changes:
            with self.subTest(path=path):
                event, api = workflow()
                def changed_log(identity):
                    associated = api.rows["actions/runs/123"]["pull_requests"][0]
                    target = associated
                    for key in path[:-1]:
                        target = target[key]
                    target[path[-1]] = value
                    return tap()
                api.job_log = changed_log
                with self.assertRaisesRegex(Rejected, "RUN_MOVED"):
                    reconcile("workflow_run", event, A, api)

    def test_pr_binding_snapshot_does_not_alias_run(self):
        _, api = workflow()
        run = api.rows["actions/runs/123"]
        def changed_log(identity):
            run["pull_requests"][0]["base"]["sha"] = C
            return tap()
        api.job_log = changed_log
        with self.assertRaisesRegex(Rejected, "RUN_MOVED"):
            ci_evidence(api, run)

    def test_malformed_fresh_run_pr_binding_rejected(self):
        malformed = (
            None, [], [{}],
            [{"number": True, "head": {"sha": B}, "base": {"sha": A, "ref": "main"}}],
            [{"number": 702, "head": {"sha": B}, "base": {"sha": A, "ref": True}}],
        )
        for association in malformed:
            with self.subTest(association=association):
                event, api = workflow()
                def changed_log(identity):
                    api.rows["actions/runs/123"]["pull_requests"] = association
                    return tap()
                api.job_log = changed_log
                with self.assertRaisesRegex(Rejected, "RUN_MOVED"):
                    reconcile("workflow_run", event, A, api)

    def test_adapter_mapping_does_not_promote_modified_claims(self):
        e, api = workflow(); evidence = ci_evidence(api, api.rows["actions/runs/123"])
        for key, value in (("conclusion", "failure"), ("total", 0), ("passed", 9), ("failed", None)):
            bad = copy.deepcopy(evidence); bad["jobs"][0][key] = value
            with self.assertRaises(Rejected): adapter_ci_fields(bad, A)
        bad = copy.deepcopy(evidence); bad["authenticated"] = True
        with self.assertRaises(Rejected): adapter_ci_fields(bad, A)

    def test_actual_sibling_adapter_consumes_collector_projection(self):
        default = Path(__file__).resolve().parent.parent / "event-adapter/scripts/event-continuation-adapter.mjs"
        adapter = Path(os.environ.get("MERIDIAN_TEST_ADAPTER", str(default))).resolve()
        self.assertTrue(adapter.is_file(), "stage sibling event-adapter or set MERIDIAN_TEST_ADAPTER for local tests")
        event, api = workflow()
        receipt = reconcile("workflow_run", event, A, api)
        program = r'''
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const location=process.argv[1];
const {reconcileContinuation}=await import(location);
const {normalizeEvent}=await import(new URL('../fixtures/scripts/event-continuation-intake.mjs',location));
const {initialLedger,advance}=await import(new URL('../fixtures/scripts/continuation-contract.mjs',location));
const {receipt,payload}=JSON.parse(readFileSync(0,'utf8'));
const A='a'.repeat(40),B='b'.repeat(40),repository='Achi1984/meridian';
const mapped=receipt.source.ciEvidence.adapterFields;
const expected={repository,prNumber:704,packetId:'first',requestId:'REQ001',opId:'OP001',headSha:B,baseSha:A,mainSha:A,now:1500,maxAgeSeconds:60,
 ci:{runId:123,runAttempt:1,workflowId:347821227,headSha:B},reviewVersion:null,reviewWake:null};
const paths=['docs/v11/first.md','test/v11-first.test.js'];
const manifest={schema:1,repository,baseSha:A,issuedAt:1000,expiresAt:2000,maxInvocations:1,ownerApprovalRef:'https://github.com/Achi1984/meridian/issues/571#issuecomment-123',packets:[{id:'first',paths,dependencies:[],dependencyGate:'draft',outputClass:'docs-with-trusted-test',templateDigest:'d'.repeat(64)}]};
let ledger=initialLedger(manifest);
for(const [type,sha] of [['CLAIM',A],['MODEL_STARTED',null],['DRAFT_OBSERVED',B]])ledger=advance(manifest,ledger,{type,sha,packetId:'first',expectedRevision:ledger.revision},1500);
const config={repository,mailboxIssue:571,workflowIds:[347821227]};
const trigger={name:'workflow_run',payloadJson:JSON.stringify(payload)};
const normalized=normalizeEvent(trigger.name,trigger.payloadJson,JSON.stringify(config));
const work={deliveryId:'EVT001',workId:'WORK001',repository,requestId:'REQ001',opId:'OP001',headSha:B,baseSha:A,paths,owner:'CODEX',execution:'PLANNED',ci:mapped.workCi,responses:[],inFlight:[]};
const snapshot={repository,observedAt:1495,mainSha:A,pr:{prNumber:704,headSha:B,baseSha:A,state:'open',mergeSha:null},work,eventBinding:{eventIdentity:normalized.eventIdentity,revisionDigest:normalized.revisionDigest},ciBinding:mapped.ciBinding,reviewBinding:null};
const result=reconcileContinuation({trigger,config,expected,snapshot,manifest,ledger,requiredJobs:['syntax']});
assert.equal(result.decision,'WAITING_REVIEW');assert.equal(result.ledger.packets[0].state,'REVIEW_WAIT');
for(const key of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'])assert.equal(result[key],false);
console.log('collector-to-existing-adapter: WAITING_REVIEW; authority false');
'''
        result = subprocess.run(["node", "--input-type=module", "-e", program, adapter.as_uri()],
            input=json.dumps({"receipt": receipt, "payload": event}), capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WAITING_REVIEW", result.stdout)

    def test_totals_missing_ambiguous_failed_and_nested(self):
        self.assertEqual(parse_tap_summary(tap())["total"], 10)
        for raw in (tap().replace(b"# pass 10", b"# pass 9"), tap().replace(b"# tests 10", b"# \\# tests 10"),
                    tap().replace(b"# skipped 0", b"# skipped 1"), tap() + b"\n" + tap(),
                    tap().replace(b"# tests 10", b"# tests 10\n2026-10-11T19:15:04Z # tests 10")):
            with self.assertRaises(Rejected): parse_tap_summary(raw)

    def test_job_logs_redirect_strips_token_bounds_and_rejects(self):
        gh = GitHub("secret-test-token")
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): self.size = size; return tap()
        class Opener:
            destination = "https://example.blob.core.windows.net/log?sig=opaque"
            def __init__(self): self.requests = []
            def open(self, req, timeout):
                self.requests.append(req)
                if len(self.requests) == 1:
                    raise urllib.error.HTTPError(req.full_url, 302, "redirect", {"Location": self.destination}, None)
                self.response = Response(); return self.response
        stub = Opener(); gh.opener = stub
        self.assertEqual(gh.job_log(456), tap())
        self.assertIn("Authorization", dict(stub.requests[0].header_items()))
        self.assertNotIn("Authorization", dict(stub.requests[1].header_items()))
        self.assertEqual(stub.response.size, MAX_LOG + 1)
        for destination in ("https://attacker.invalid/log", "http://a.blob.core.windows.net/log", "https://user:pass@a.blob.core.windows.net/log", "https://a.blob.core.windows.net:444/log"):
            stub = Opener(); stub.destination = destination; gh.opener = stub
            with self.assertRaises(Rejected): gh.job_log(456)
            self.assertEqual(len(stub.requests), 1)
        class Again(Opener):
            def open(self, req, timeout):
                raise urllib.error.HTTPError(req.full_url, 302, "redirect", {"Location": self.destination}, None)
        gh.opener = Again()
        with self.assertRaises(Rejected): gh.job_log(456)


if __name__ == "__main__":
    unittest.main()

