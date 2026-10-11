"""Inactive read-only review snapshot collector with trusted injected GET transport.

No network, subprocess, file writes or import-time IO. API facts do not prove
which base/tests a workflow executed: collection always remains BLOCKED until
an independently authenticated execution attestation exists (not implemented).
"""
import base64
import difflib
import hashlib
import json
import re
import urllib.parse

REPO = 'Achi1984/meridian'
PREFIX = '/repos/' + REPO + '/'
ACTIVE = False


def require(value, reason):
    if not value:
        raise ValueError(reason)


def integer(value):
    return type(value) is int and 0 < value <= 9007199254740991


def sha(value):
    return type(value) is str and re.fullmatch(r'[0-9a-f]{40}', value)


def name(value):
    return type(value) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', value)


def safe_path(value):
    return (type(value) is str and 0 < len(value.encode('utf-8')) <= 256 and not value.startswith('/')
            and '\\' not in value and not any(ord(c) < 32 for c in value)
            and all(part not in ('', '.', '..') for part in value.split('/')))


def own(value):
    return (type(value) is dict and value.get('full_name') == REPO and value.get('fork') is False
            and value.get('id') == 1342084551 and value.get('owner', {}).get('id') == 319562141
            and value.get('owner', {}).get('login') == 'Achi1984' and value.get('owner', {}).get('type') == 'User')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def collect(fetch, *, pr, head_sha, base_sha, request_id, policy, implementer_family):
    """fetch(path) must authenticate GET replies and bound raw bodies externally.

    policy is the explicit #665 policy; model execution is not part of collection.
    Candidate checks stay empty rather than inventing run base or audit results.
    """
    require(callable(fetch) and integer(pr) and sha(head_sha) and sha(base_sha) and head_sha != base_sha
            and name(request_id) and implementer_family == 'gpt', 'Malformed requested identity or implementer binding')
    require(type(policy) is dict and set(policy) == {'model_id', 'allowed_model_ids', 'required_checks'}, 'Explicit policy required')
    models = policy['allowed_model_ids']; model = policy['model_id']; required = policy['required_checks']
    require(type(models) is list and 0 < len(models) <= 8 and all(name(m) and m.startswith('claude-')
            and not {'auto', 'default', 'latest'}.intersection(re.split(r'[._-]', m.lower())) for m in models)
            and len(set(models)) == len(models) and model in models, 'Reviewer model pin missing')
    require(type(required) is dict and 0 < len(required) <= 16
            and all(name(k) and integer(v) for k, v in required.items()), 'Required workflows missing')
    def get(path):
        value = fetch(PREFIX + path)
        require(len(canonical(value)) <= 524288, 'API response exceeds bound')
        return value
    def current():
        item = get('pulls/' + str(pr))
        require(type(item) is dict and type(item.get('number')) is int and item['number'] == pr
                and item.get('state') == 'open' and item.get('merged') is False
                and item.get('head', {}).get('sha') == head_sha and own(item['head'].get('repo'))
                and item.get('base', {}).get('sha') == base_sha and item['base'].get('ref') == 'main'
                and own(item['base'].get('repo')), 'PR head/base/repository changed')
        require(get('git/ref/heads/main').get('object', {}).get('sha') == base_sha, 'Current main changed')
        require(integer(item.get('changed_files')) and item['changed_files'] <= 64, 'Changed file count exceeds bound')
        return item['changed_files']
    count = current()
    files = []
    for page in range(1, 4):
        if len(files) == count:
            break
        batch = get('pulls/' + str(pr) + '/files?per_page=30&page=' + str(page))
        require(type(batch) is list and len(batch) == min(30, count - len(files)), 'Incomplete changed-file pagination')
        files.extend(batch)
    require(len(files) == count, 'Changed-file pagination incomplete')
    seen = set()
    for item in files:
        require(type(item) is dict and safe_path(item.get('filename')) and item['filename'] not in seen
                and item.get('status') in ('added', 'modified', 'removed', 'renamed') and sha(item.get('sha')),
                'Unsafe or duplicate changed-file entry')
        seen.add(item['filename'])
        if item['status'] == 'renamed':
            require(safe_path(item.get('previous_filename')), 'Unsafe rename preimage')
    comparison = get('compare/' + base_sha + '...' + head_sha)
    require(comparison.get('base_commit', {}).get('sha') == base_sha
            and comparison.get('merge_base_commit', {}).get('sha') == base_sha
            and comparison.get('status') == 'ahead', 'Head must be based on exact current base; rebase review required')
    compared = comparison.get('files')
    signature = lambda entries: [(f.get('filename'), f.get('status'), f.get('sha'), f.get('previous_filename')) for f in entries]
    require(type(compared) is list and len(compared) == count and signature(compared) == signature(files),
            'Compare inventory differs or is truncated')
    inventory = []; total = 0; diffs = []
    def contents(path, ref, side):
        nonlocal total
        value = get('contents/' + urllib.parse.quote(path, safe='/') + '?ref=' + ref)
        require(type(value) is dict and value.get('type') == 'file' and value.get('path') == path
                and value.get('encoding') == 'base64' and sha(value.get('sha'))
                and type(value.get('size')) is int and 0 <= value['size'] <= 65536
                and type(value.get('content')) is str, 'Unsupported immutable source')
        raw = base64.b64decode(value['content'].replace('\n', ''), validate=True)
        require(len(raw) == value['size'] and b'\0' not in raw, 'Binary or truncated immutable source')
        blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        require(blob == value['sha'], 'Source blob hash mismatch')
        total += len(raw); require(total <= 262144, 'Source inventory exceeds bound')
        text = raw.decode('utf-8')
        inventory.append({'path':path, 'side':side, 'ref':ref, 'blob_sha':blob,
                          'sha256':hashlib.sha256(raw).hexdigest(), 'bytes':len(raw), 'text':text})
        return text, blob
    for item in files:
        path = item['filename']; old_path = item.get('previous_filename', path)
        before = '' if item['status'] == 'added' else contents(old_path, base_sha, 'base')[0]
        after = ''
        if item['status'] != 'removed':
            after, blob = contents(path, head_sha, 'head')
            require(blob == item['sha'], 'PR file differs from pinned head source')
        # Complete local diff, never trust GitHub's possibly omitted/truncated patch field.
        lines = difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                    fromfile='a/' + old_path, tofile='b/' + path)
        diff = ''.join(line if line.endswith('\n') else line + '\n\\ No newline at end of file\n' for line in lines)
        if not diff and item['status'] == 'renamed':
            diff = 'rename from ' + old_path + '\nrename to ' + path + '\n'
        require(bool(diff), 'No content diff; metadata-only change requires separate evidence')
        diffs.append(diff)
    diff = '\n'.join(diffs); require(len(diff.encode('utf-8')) <= 65536, 'Complete diff exceeds review bound')
    observations = []
    for check_name, workflow in required.items():
        listing = get('actions/workflows/' + str(workflow) + '/runs?event=pull_request&head_sha=' + head_sha + '&per_page=100&page=1')
        runs = listing.get('workflow_runs')
        require(type(runs) is list and 0 < len(runs) <= 100 and type(listing.get('total_count')) is int
                and listing['total_count'] == len(runs) and all(integer(r.get('id')) for r in runs), 'Missing/truncated CI inventory')
        run_id = max(r['id'] for r in runs)
        def run_state():
            r = get('actions/runs/' + str(run_id))
            require(r.get('id') == run_id and r.get('workflow_id') == workflow and r.get('head_sha') == head_sha
                    and r.get('event') == 'pull_request' and r.get('status') == 'completed' and r.get('conclusion') == 'success'
                    and integer(r.get('run_attempt')) and own(r.get('repository')) and own(r.get('head_repository'))
                    and any(v.get('number') == pr for v in r.get('pull_requests', [])), 'CI run mismatched or not successful')
            return r
        run = run_state(); attempt = run['run_attempt']
        jobs = get('actions/runs/' + str(run_id) + '/attempts/' + str(attempt) + '/jobs?per_page=100&page=1')
        items = jobs.get('jobs')
        require(type(items) is list and 0 < len(items) <= 100 and type(jobs.get('total_count')) is int
                and jobs['total_count'] == len(items), 'Missing/truncated CI jobs')
        require(all(integer(j.get('id')) and j.get('run_id') == run_id and j.get('head_sha') == head_sha
                    and j.get('status') == 'completed' and j.get('conclusion') == 'success' for j in items),
                'CI job mismatched or not successful')
        require(run_state()['run_attempt'] == attempt, 'CI attempt changed while collecting')
        observations.append({'name':check_name, 'workflow_id':workflow, 'run_id':run_id, 'run_attempt':attempt,
            'head_sha':head_sha, 'reported_conclusion':'success', 'job_ids':[j['id'] for j in items],
            'api_snapshot_sha256':hashlib.sha256(canonical({'run':run, 'jobs':jobs})).hexdigest(),
            'base_execution_attested':False, 'mandatory_audit_execution_attested':False})
    require(current() == count, 'PR changed during collection')
    candidate = {'repository':REPO, 'pr':pr, 'head_sha':head_sha, 'base_sha':base_sha, 'request_id':request_id,
                 'implementer_family':implementer_family, 'changed_paths':[f['filename'] for f in files],
                 'diff':diff, 'diff_truncated':False, 'checks':[]}
    return {'active':False, 'status':'BLOCKED', 'evidence_ready':False, 'merge_authorized':False,
            'blockers':['Missing authenticated exact-base and independently executed mandatory-audit attestations'],
            'candidate_evidence':candidate, 'source_inventory':inventory, 'ci_observations':observations,
            'snapshot_sha256':hashlib.sha256(canonical({'candidate':candidate, 'sources':inventory, 'ci':observations})).hexdigest()}
