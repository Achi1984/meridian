"""Complete read-only observation, never approval, dispatch or merge authority."""
import sys
if __name__ == '__main__':
    sys.dont_write_bytecode = True
    if not sys.flags.isolated:
        print('{"status":"BLOCKED","reason":"ISOLATED_LAUNCH_REQUIRED"}')
        raise SystemExit(1)
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    # Private transport hooks must see this exact budget class under isolated CLI.
    sys.modules['native_review_packet'] = sys.modules[__name__]
import json
import os
import time
from collector import GitHub, ci_evidence, integer, need, obj, run_pr_binding
from review_handoff import check_ci
from native_review_observation import validate_expected, observe_native_review
from native_review_transport import NativeReviewGitHub
from native_review_inventory_transport import observe_inventory
from native_review_thread_transport import observe_threads

MAX_CALLS = 49
MAX_BYTES = 22 * 1024 * 1024
MAX_SECONDS = 120
MAX_RECEIPT = 4096
FLAGS = dict(authenticated=False, provenanceVerified=False, authorized=False,
             dispatchAllowed=False, mergeAllowed=False, durable=False,
             fullReviewEvidence=False, transportPaginationVerified=False)
REMAINING_GATES = ('INDEPENDENT_FULL_REVIEW_AND_OWNER_APPROVAL',
                   'TRUSTED_EXECUTED_CHECK_PROVENANCE',
                   'DURABLE_FENCED_CONTINUATION_AND_FRESH_MUTATION_PREFLIGHT')


class _PacketBudget:
    """Process-local budget capability, never deserialized from caller receipts.

    Read counts include the overflow detection byte. Elapsed checks and socket
    timeouts do not promise hard cancellation of a slow in-flight socket read.
    """
    def __init__(self):
        self.deadline = time.monotonic() + MAX_SECONDS
        self.calls, self.bytes = 0, 0

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        need(remaining > 0, 'PACKET_TIME')
        return remaining

    def wrap_opener(self, opener):
        budget = self

        class Response:
            def __init__(self, response):
                self.response = response

            def __enter__(self):
                self.response.__enter__()
                return self

            def __exit__(self, *args):
                return self.response.__exit__(*args)

            def __getattr__(self, name):
                return getattr(self.response, name)

            def read(self, limit):
                budget.remaining()
                need(type(limit) is int and limit > 0, 'READ_LIMIT')
                remaining = MAX_BYTES - budget.bytes
                need(remaining >= 0, 'PACKET_BYTES')
                raw = self.response.read(min(limit, remaining + 1))
                need(type(raw) is bytes, 'READ_BYTES')
                budget.bytes += len(raw)
                need(len(raw) < limit and budget.bytes <= MAX_BYTES, 'READ_OVERFLOW')
                budget.remaining()
                return raw

        class Opener:
            def open(self, request, timeout):
                remaining = budget.remaining()
                need(budget.calls < MAX_CALLS and budget.bytes < MAX_BYTES, 'PACKET_BUDGET')
                budget.calls += 1
                # Redirect attempts count even when open raises HTTPError.
                response = opener.open(request, timeout=min(timeout, 15, remaining))
                return Response(response)

        return Opener()


class _PacketGitHub(NativeReviewGitHub):
    """Only the pinned observer paths plus its exact attempt's jobs/log."""
    def __init__(self, token, expected, budget):
        need(type(budget) is _PacketBudget, 'BUDGET_TYPE')
        self.scope = expected['scope']
        ci = self.scope['ci']
        super().__init__(token, pr_number=self.scope['prNumber'],
                         run_id=ci['runId'], review_id=expected['review']['id'])
        self._job_paths = frozenset('actions/runs/' + str(ci['runId']) + '/attempts/'
            + str(ci['runAttempt']) + '/jobs?per_page=50&page=' + str(page) for page in range(1, 4))
        self._log_ids = set()
        self.opener = budget.wrap_opener(self.opener)

    def _allowed_path(self, path):
        return super()._allowed_path(path) or (type(path) is str and path in self._job_paths)

    def __call__(self, path):
        result = super().__call__(path)
        if path in self._job_paths:
            ci = self.scope['ci']
            rows = result.get('jobs')
            need(type(rows) is list and len(rows) <= 50, 'JOBS')
            for row in rows:
                obj(row)
                if (integer(row.get('id')) and type(row.get('run_id')) is int
                    and type(row.get('run_attempt')) is int and row['run_id'] == ci['runId']
                    and row['run_attempt'] == ci['runAttempt'] and row.get('head_sha') == ci['headSha']
                    and row.get('name') == 'syntax' and row.get('status') == 'completed'
                    and row.get('conclusion') == 'success'):
                    self._log_ids.add(row['id'])
        return result

    def job_log(self, job_id):
        need(integer(job_id) and job_id in self._log_ids, 'LOG_IDENTITY')
        # Consume the capability before transport; no second log attempt.
        self._log_ids.remove(job_id)
        return GitHub.job_log(self, job_id)


def _validated(raw):
    expected = validate_expected(raw)
    need(expected['scope']['prNumber'] <= 2147483647, 'GRAPHQL_INT')
    return expected


def observe_packet(expected_raw, token):
    """One bounded operation; no partial receipt survives any failed component."""
    blocked = dict(status='BLOCKED', reason='INVALID_CHANGED_OR_INCOMPLETE_OBSERVATION',
                   **FLAGS, plannerResponse=None, observation=None,
                   remainingGates=list(REMAINING_GATES))
    try:
        expected = _validated(expected_raw)
        need(type(token) is str and 0 < len(token) <= 4096
             and all(33 <= ord(c) <= 126 for c in token), 'TOKEN')
        budget = _PacketBudget()
        api = _PacketGitHub(token, expected, budget)

        def approval():
            result = observe_native_review(expected_raw, api)
            need(result['status'] == 'OBSERVED_APPROVAL_INCOMPLETE', 'APPROVAL')

        def inventory():
            result = observe_inventory(expected_raw, token, _budget=budget)
            need(result['status'] == 'OBSERVED_INVENTORY_INCOMPLETE', 'INVENTORY')
            data = result['observation']
            need(data['adverseReviewCount'] == 0, 'ADVERSE_REVIEW')
            return data

        def threads():
            result = observe_threads(expected_raw, token, _budget=budget)
            need(result['status'] == 'OBSERVED_THREADS_INCOMPLETE', 'THREADS')
            data = result['observation']
            need(data['unresolvedCount'] == 0, 'UNRESOLVED_THREADS')
            return data

        approval()
        first_reviews, first_threads = inventory(), threads()
        ci = expected['scope']['ci']
        run = api('actions/runs/' + str(ci['runId']))
        # Recheck this exact intermediate snapshot, not only the surrounding reads.
        check_ci(lambda path: run, expected['scope'])
        need(run_pr_binding(run, 'CI_DRIFT') == (expected['scope']['prNumber'],
             expected['scope']['headSha'], expected['scope']['baseSha'], 'main'), 'CI_DRIFT')
        evidence = ci_evidence(api, run)
        last_reviews, last_threads = inventory(), threads()
        need(first_reviews == last_reviews and first_threads == last_threads, 'PACKET_DRIFT')
        approval()
        budget.remaining()
        result = dict(status='OBSERVED_PACKET_INCOMPLETE', reason='AUTHORITY_AND_EXECUTION_PROVENANCE_MISSING',
            **FLAGS, plannerResponse=None, remainingGates=list(REMAINING_GATES),
            observation=dict(scope=expected['scope'], review=expected['review'],
                reviewCount=first_reviews['reviewCount'], threadCount=first_threads['threadCount'],
                adverseReviewCount=0, unresolvedThreadCount=0,
                reviewInventoryDigest=first_reviews['inventoryDigest'],
                threadInventoryDigest=first_threads['inventoryDigest'],
                ciEvidence=evidence, requestsMade=budget.calls, responseBytes=budget.bytes))
        need(len(json.dumps(result, separators=(',', ':'), allow_nan=False).encode()) <= MAX_RECEIPT, 'RECEIPT')
        return result
    except Exception:
        return blocked


def main(argv=None):
    try:
        args = sys.argv[1:] if argv is None else argv
        need(len(args) == 2 and args[0] == '--allow-read-only-network', 'ARGS')
        with open(args[1], 'rb') as stream:
            raw = stream.read(16385)
        _validated(raw)  # Before accessing the explicitly existing GH_TOKEN.
        result = observe_packet(raw, os.environ.get('GH_TOKEN'))
        print(json.dumps(result, separators=(',', ':'), allow_nan=False))
        return 2 if result['status'] == 'OBSERVED_PACKET_INCOMPLETE' else 1
    except Exception:
        print('{"status":"BLOCKED","reason":"PACKET_NOT_COMPLETED"}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
