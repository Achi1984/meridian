"""Protected-job launcher. Import inert; no credentials or network until main()."""
import base64
import contextlib
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import sys
import signal
import time

WORKFLOW = '.github/workflows/trial4-artifact-recovery.yml'
ROOT = pathlib.Path(__file__).resolve().parent
FILES = ('recovery_core.py', 'recovery_http.py', 'recovery_launcher.py', 'publisher_broker.py',
         'evidence/validate_original_packet.py', 'evidence/original-pilot.py', 'workflow.template.yml')
BROKER_HASH = 'd82b29832dbbbf3d419e41b5a81f4f6ff54585e6cbca4f07be411f81b5f35c44'
PINS = {'app_id': 5272026, 'app_slug': 'meridian-draft-publisher', 'bot_login': 'meridian-draft-publisher[bot]',
        'installation_id': 170212503, 'account_id': 319562141, 'account_login': 'Achi1984',
        'repository_id': 1342084551, 'repository_full_name': 'Achi1984/meridian'}


def require(condition):
    if not condition:
        raise ValueError('LAUNCHER_CHECK_FAILED')


class ExecutionBudget:
    """Linux watchdog leaves cleanup time before native step/job termination."""
    WORK_SECONDS = 600
    CLEANUP_SECONDS = 60
    MINT_RESERVE_SECONDS = 240
    JOB_SECONDS = 1200
    NATIVE_MARGIN_SECONDS = 60

    def __init__(self):
        self.started = time.monotonic()
        self.job_end = None
        self.previous_handler = None
        self.cleanup_deadline = None
        self.alarm_deadline = self.started + self.WORK_SECONDS

    def expired(self, signum, frame):
        # A pending old work signal can arrive after cleanup mode was armed.
        remaining = self.alarm_deadline - time.monotonic()
        if remaining > 0:
            signal.setitimer(signal.ITIMER_REAL, remaining)
            return
        raise TimeoutError('RECOVERY_EXECUTION_BUDGET')

    def install(self):
        self.alarm_deadline = self.started + self.WORK_SECONDS
        self.previous_handler = signal.signal(signal.SIGALRM, self.expired)
        signal.setitimer(signal.ITIMER_REAL, max(.001, self.alarm_deadline - time.monotonic()))

    def close(self):
        signal.setitimer(signal.ITIMER_REAL, 0)
        if self.previous_handler is not None:
            signal.signal(signal.SIGALRM, self.previous_handler)

    def bind_job(self, timestamp):
        require(type(timestamp) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', timestamp))
        started = datetime.datetime.strptime(timestamp, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()
        require(started <= time.time() + 5)
        self.job_end = started + self.JOB_SECONDS
        remaining_work = self.WORK_SECONDS - (time.monotonic() - self.started)
        require(self.job_end - time.time() >= remaining_work + self.CLEANUP_SECONDS + self.NATIVE_MARGIN_SECONDS)
        self.check()

    def check(self, *, mint=False):
        remaining = self.WORK_SECONDS - (time.monotonic() - self.started)
        require(remaining > 0)
        if self.job_end is not None:
            require(self.job_end - time.time() > self.CLEANUP_SECONDS + self.NATIVE_MARGIN_SECONDS)
        if mint:
            require(self.job_end is not None and remaining >= self.MINT_RESERVE_SECONDS
                    and self.job_end - time.time() >= self.MINT_RESERVE_SECONDS + self.CLEANUP_SECONDS + self.NATIVE_MARGIN_SECONDS)

    def begin_cleanup(self):
        if self.cleanup_deadline is None:
            next_deadline = time.monotonic() + self.CLEANUP_SECONDS
            # Set the logical deadline first so stale pending signals cannot raise.
            self.alarm_deadline = next_deadline
            self.cleanup_deadline = next_deadline
            signal.setitimer(signal.ITIMER_REAL, max(.001, self.cleanup_deadline - time.monotonic()))

    @contextlib.contextmanager
    def cleanup(self):
        # Idempotent fallback for errors before the publisher context yielded.
        self.begin_cleanup()
        try:
            yield
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)


def load(name):
    path = ROOT / name
    require(path.is_file() and not path.is_symlink())
    raw = path.read_bytes()
    if name == 'publisher_broker.py':
        require(hashlib.sha256(raw).hexdigest() == BROKER_HASH)
    module = __import__('types').ModuleType(name.removesuffix('.py'))
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def render_workflow(source_sha):
    require(re.fullmatch('[0-9a-f]{40}', source_sha) is not None)
    text = (ROOT / 'workflow.template.yml').read_text()
    text = text.replace('__SOURCE_COMMIT__', source_sha)
    for index, name in enumerate(FILES):
        text = text.replace('__HASH_' + str(index) + '__', hashlib.sha256((ROOT / name).read_bytes()).hexdigest())
    require('__SOURCE_' not in text and '__HASH_' not in text)
    return text


def validate_failure_receipt(log_bytes, strict_json):
    require(type(log_bytes) is bytes and len(log_bytes) <= 1048576)
    lines = log_bytes.decode('utf-8', errors='strict').splitlines()
    records = []
    for line in lines:
        if 'MERIDIAN_PUBLISHER_RECEIPT ' in line:
            raw = line.split('MERIDIAN_PUBLISHER_RECEIPT ', 1)[1]
            require(len(raw.encode()) <= 4096)
            records.append(strict_json(raw))
    require(len(records) == 1)
    record = records[0]
    require(type(record) is dict and record.get('schema_version') == 1 and record.get('stage') == 'initial'
            and record.get('outcome') == 'stopped' and record.get('completed_at') == 1791729107
            and not any(record.get(key) for key in ('publication_attempted', 'mint_attempted', 'post_attempted')))


def authenticated_context(api, core, env):
    base = env.get('APPROVED_RECOVERY_BASE', '')
    require(core.sha(base) and env.get('GITHUB_SHA') == base and env.get('GITHUB_WORKFLOW_SHA') == base
            and env.get('GITHUB_ACTIONS') == 'true' and env.get('GITHUB_REPOSITORY') == core.REPO
            and env.get('GITHUB_REF') == 'refs/heads/main' and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and env.get('GITHUB_RUN_ATTEMPT') == '1' and env.get('GITHUB_TRIGGERING_ACTOR') == 'Achi1984'
            and env.get('GITHUB_WORKFLOW_REF') == core.REPO + '/' + WORKFLOW + '@refs/heads/main')
    run_id_text = env.get('GITHUB_RUN_ID', '')
    require(re.fullmatch('[1-9][0-9]{0,15}', run_id_text) is not None)
    run_id = int(run_id_text)
    run = api('actions/runs/' + run_id_text)
    workflow = api('actions/workflows/trial4-artifact-recovery.yml')
    require(run.get('id') == run_id and run.get('head_sha') == base and run.get('head_branch') == 'main'
            and run.get('event') == 'workflow_dispatch' and run.get('run_attempt') == 1
            and run.get('status') == 'in_progress' and run.get('conclusion') is None
            and run.get('path') == WORKFLOW and run.get('workflow_id') == workflow.get('id')
            and type(workflow.get('id')) is int and workflow.get('path') == WORKFLOW
            and core.own(run.get('repository')) and core.own(run.get('head_repository')))
    for field in ('actor', 'triggering_actor'):
        require(run.get(field, {}).get('login') == 'Achi1984' and run[field].get('id') == 319562141)
    jobs = api('actions/runs/' + run_id_text + '/attempts/1/jobs?per_page=100')
    require(type(jobs.get('total_count')) is int and jobs['total_count'] == 1
            and type(jobs.get('jobs')) is list and len(jobs['jobs']) == 1)
    job = jobs['jobs'][0]
    require(job.get('run_id') == run_id and job.get('run_attempt') == 1 and job.get('name') == 'recover'
            and job.get('status') == 'in_progress' and job.get('conclusion') is None)
    require(api('git/ref/heads/main')['object']['sha'] == base)
    # Compare all reviewed workflow bytes, including source hashes, environment and exact loader/entrypoint.
    workflow_file = api('contents/' + WORKFLOW + '?ref=' + base)
    require(workflow_file.get('encoding') == 'base64' and workflow_file.get('type') == 'file')
    actual = base64.b64decode(workflow_file['content'].replace('\n', ''), validate=True).decode('utf-8')
    require(actual == render_workflow(env.get('RECOVERY_SOURCE_COMMIT', '')))
    with pathlib.Path(env['GITHUB_EVENT_PATH']).open('rb') as stream:
        event = stream.read(65537)
    require(len(event) <= 65536)
    parsed_event = load('recovery_http.py').strict_json(event)
    require(parsed_event.get('inputs') == {'approved_base': base})
    approvals = api('actions/runs/' + run_id_text + '/approvals')
    require(type(approvals) is list)
    matching = [item for item in approvals if type(item) is dict and any(
        e.get('id') == 24007408163 or e.get('name') == 'meridian-draft-publisher'
        for e in item.get('environments', []) if type(e) is dict)]
    require(len(matching) == 1)
    approval = matching[0]
    require(approval.get('state') == 'approved' and approval.get('user', {}).get('login') == 'Achi1984'
            and approval['user'].get('id') == 319562141 and approval['user'].get('type') == 'User'
            and any(e.get('id') == 24007408163 and e.get('name') == 'meridian-draft-publisher'
                    and e.get('can_admins_bypass') is False for e in approval.get('environments', [])))
    return {'repository': core.REPO, 'ref': 'refs/heads/main', 'sha': base, 'event': 'workflow_dispatch',
            'actor': 'Achi1984', 'attempt': 1, 'run_id': run_id, 'environment_approved': True,
            'job_started_at': job.get('started_at')}


def key_transport(value):
    require(type(value) is str and 32 <= len(value) <= 32768)
    raw = value.encode('ascii')
    require(all(c in (10, 13) or 32 <= c <= 126 for c in raw))
    lines = value.splitlines()
    headers = tuple('-----' + 'BEGIN ' + label + '-----' for label in ('RSA PRIVATE KEY', 'PRIVATE KEY'))
    require(len(lines) >= 3 and lines[0] in headers and lines[-1] == lines[0].replace('BEGIN', 'END'))
    require(all(line and len(line) <= 76 for line in lines[1:-1]))
    require(len(base64.b64decode(''.join(lines[1:-1]), validate=True)) >= 32)
    return raw


class BrokerFactory:
    def __init__(self, broker, key, window, budget):
        self.broker = broker; self.key = key; self.window = window; self.budget = budget
        self.events = {}; self.used = False

    def observe(self, event, **fields):
        if event in {'cleanup_started', 'revocation_attempted'}:
            self.budget.begin_cleanup()
        if event == 'cleanup_started':
            require(not fields)
            return
        expected = {'app_verified': {'app_id'}, 'installation_verified': {'installation_id'},
                    'mint_attempted': {'mint_requested_at'}, 'mint_response_received': set(),
                    'scope_verified': {'repository_id', 'expires_at'}, 'revocation_attempted': set(),
                    'revocation_confirmed': set()}
        require(event in expected and event not in self.events and set(fields) == expected[event])
        require(all(type(v) is int and 0 < v < 9007199254740992 for v in fields.values()))
        self.events[event] = dict(fields)

    def bounded_http(self, method, url, credential, payload):
        # Expiry stops minting and identity requests, but never token cleanup.
        if method == 'DELETE' and url == 'https://api.github.com/installation/token' and payload is None:
            with self.budget.cleanup():
                return self.broker.github_http(method, url, credential, payload)
        self.window()
        self.budget.check(mint=(method == 'POST'))
        return self.broker.github_http(method, url, credential, payload)

    @contextlib.contextmanager
    def __call__(self):
        require(not self.used)
        self.used = True
        with self.broker.publisher_token(http=self.bounded_http, sign=self.broker.rsa_signer(self.key),
                                        pins=dict(PINS), observer=self.observe) as token:
            try:
                yield token
            finally:
                # Enter cleanup BEFORE control resumes inside broker.__exit__.
                self.budget.begin_cleanup()

    def receipt(self):
        expected = {'app_verified', 'installation_verified', 'mint_attempted', 'mint_response_received',
                    'scope_verified', 'revocation_attempted', 'revocation_confirmed'}
        require(set(self.events) == expected)
        return {'revocation_confirmed': True, 'app_id': self.events['app_verified']['app_id'],
                'installation_id': self.events['installation_verified']['installation_id'],
                'repository_id': self.events['scope_verified']['repository_id']}


def main():
    # Remove the secret before loading any sibling or spawning the existing signer's isolated OpenSSL process.
    value = os.environ.pop('MERIDIAN_PUBLISHER_APP_PRIVATE_KEY', None)
    report = {'outcome': 'stopped', 'stage': 'launcher', 'model_calls': 0}
    budget = ExecutionBudget()
    try:
        budget.install()
        require(len(sys.argv) == 1)
        core = load('recovery_core.py'); http = load('recovery_http.py')
        original_window = core.window
        def guarded_window():
            original_window(); budget.check()
        core.window = guarded_window
        core.window()
        key = key_transport(value); value = None
        api = http.GitHub(os.environ['GH_TOKEN'], core)
        context = authenticated_context(api, core, os.environ)
        budget.bind_job(context['job_started_at'])
        failure_log = api.signed_download('actions/jobs/114492680461/logs', 1048576)
        validate_failure_receipt(failure_log, http.strict_json)
        context['original_failure_reconciled'] = True
        archive = api.signed_download('actions/artifacts/11705462075/zip', 131072)
        helper = (ROOT / 'evidence/original-pilot.py').read_bytes()
        broker = load('publisher_broker.py')
        factory = BrokerFactory(broker, key, core.window, budget)
        report = core.recover_once(config={**core.CONFIGURED, 'base': context['sha']}, context=context, api=api,
            publisher_factory=factory, publisher_receipt=factory.receipt, archive=archive, helper_bytes=helper)
        return 0 if report.get('outcome') == 'prepared_draft' else 1
    except BaseException:
        return 1
    finally:
        budget.close()
        value = None
        print('MERIDIAN_RECOVERY_RECEIPT ' + json.dumps(report, sort_keys=True, separators=(',', ':')))


if __name__ == '__main__':
    raise SystemExit(main())
