"""Trusted, fixed-packet pilot. Import is inert; only explicit phases perform IO."""
import hashlib
import io
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPO = 'Achi1984/meridian'
SOURCE_SHA = '2b267ecc0f94565fe005156bf45e8f0ae139eb9b'
RELEASE_ID = 347821227
SOURCE_RUN = 38070967939
SOURCE_ATTEMPT = 2
DEADLINE = 1791654300  # 2026-10-10T17:45:00Z
BRANCH = 'pilot/version-history-ledger-20261010'
PATHS = ('docs/v11/VERSION_HISTORY.md', 'test/v11-version-history-ledger.test.js')
ARTIFACT = 'version-history-ledger-packet'
MAX_BYTES = 65536


def require(value, message):
    if not value:
        raise ValueError(message)


def remaining():
    value = DEADLINE - time.time()
    require(value >= 1, 'Pilot expired; no extension or retry')
    return value


def strict_json(raw):
    require(len(raw) <= MAX_BYTES, 'JSON exceeds bound')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON number')))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def api(path, method='GET', payload=None, expected=200):
    remaining()
    require(path and not path.startswith('/') and '..' not in path, 'Invalid API path')
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + path,
        data=None if payload is None else json.dumps(payload).encode(), method=method,
        headers={'Authorization':'Bearer ' + os.environ['GH_TOKEN'], 'Accept':'application/vnd.github+json', 'Content-Type':'application/json'})
    # Mutations are deliberately never retried, including uncertain network outcomes.
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=min(15, remaining())) as response:
        require(response.status == expected, 'Unexpected API status')
        raw = response.read(524289)
    require(len(raw) <= 524288, 'API response too large')
    return json.loads(raw)


def own(repo):
    return (isinstance(repo, dict) and repo.get('full_name') == REPO and repo.get('fork') is False
            and repo.get('owner', {}).get('login') == 'Achi1984' and repo.get('owner', {}).get('type') == 'User')


def sha(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{40}', value)


def identity():
    remaining()
    require(os.environ['GITHUB_REPOSITORY'] == REPO and os.environ['GITHUB_EVENT_NAME'] == 'workflow_run'
            and os.environ['GITHUB_REF'] == 'refs/heads/main' and os.environ['GITHUB_RUN_ATTEMPT'] == '1', 'Wrong control identity')
    event = strict_json(pathlib.Path(os.environ['GITHUB_EVENT_PATH']).read_bytes())
    hint = event['workflow_run']
    require(event.get('action') == 'completed' and own(event.get('repository')), 'Wrong event origin')
    require(hint.get('id') == SOURCE_RUN and hint.get('run_attempt') == SOURCE_ATTEMPT and hint.get('workflow_id') == RELEASE_ID
            and hint.get('head_sha') == SOURCE_SHA, 'Wrong source hint')
    source = api('actions/runs/' + str(hint['id']))
    require(source.get('id') == hint['id'] and source.get('workflow_id') == RELEASE_ID
            and source.get('path') == '.github/workflows/backend-safety.yml'
            and source.get('event') == 'pull_request' and source.get('status') == 'completed'
            and source.get('conclusion') == 'success' and source.get('head_sha') == SOURCE_SHA
            and source.get('run_attempt') == SOURCE_ATTEMPT
            and own(source.get('repository')) and own(source.get('head_repository')), 'Source CI mismatch')
    require(any(p.get('number') == 653 for p in source.get('pull_requests', []) if isinstance(p, dict)), 'Wrong source PR')
    pr = api('pulls/653')
    require(pr.get('number') == 653 and pr.get('state') == 'open' and pr.get('merged') is False
            and pr['head'].get('sha') == SOURCE_SHA and pr['head'].get('ref') == source.get('head_branch')
            and own(pr['head'].get('repo')) and pr['base'].get('ref') == 'main' and own(pr['base'].get('repo')), 'Source PR changed')
    base = os.environ['GITHUB_SHA']
    require(sha(base) and api('git/ref/heads/main')['object']['sha'] == base, 'Control main changed')
    for workflow_id, path in [(RELEASE_ID, '.github/workflows/backend-safety.yml'), (347846572, '.github/workflows/runtime-smoke.yml')]:
        result = api('actions/workflows/' + str(workflow_id) + '/runs?head_sha=' + base + '&event=push&per_page=100')
        runs = result.get('workflow_runs')
        require(type(runs) is list and 0 < len(runs) <= 100 and result.get('total_count') == len(runs), 'Missing/incomplete control CI')
        require(all(r.get('workflow_id') == workflow_id and r.get('path') == path and r.get('head_sha') == base
                    and r.get('head_branch') == 'main' and r.get('event') == 'push' and r.get('status') == 'completed'
                    and r.get('conclusion') == 'success' and own(r.get('repository')) and own(r.get('head_repository'))
                    for r in runs), 'Control post-merge CI not successful')
    milestones = []
    for number in (646, 651):
        item = api('pulls/' + str(number))
        require(item.get('number') == number and item.get('merged') is True and sha(item.get('merge_commit_sha'))
                and type(item.get('merged_at')) is str and re.fullmatch(r'2026-10-10T[0-9:]{8}Z', item['merged_at'])
                and item['base'].get('ref') == 'main' and own(item['base'].get('repo')), 'Milestone not verified')
        milestones.append({'pr':number, 'merged_at':item['merged_at'], 'merge_sha':item['merge_commit_sha']})
    return {'packet':'version-history-ledger-20261010', 'control_run':int(os.environ['GITHUB_RUN_ID']),
            'source_run':source['id'], 'source_attempt':source['run_attempt'], 'source_head':SOURCE_SHA,
            'base':base, 'milestones':milestones}


def claim_message(evidence):
    return 'MERIDIAN ONE-SHOT CLAIM\n' + json.dumps(evidence, sort_keys=True, separators=(',', ':'))


def validate_claim(evidence):
    pinned = os.environ['CLAIM_SHA']
    require(sha(pinned) and api('git/ref/heads/' + BRANCH)['object']['sha'] == pinned, 'Claim moved')
    commit = api('git/commits/' + pinned)
    require(commit.get('message') == claim_message(evidence)
            and [p.get('sha') for p in commit.get('parents', [])] == [evidence['base']], 'Claim identity mismatch')
    base = api('git/commits/' + evidence['base'])
    require(commit['tree']['sha'] == base['tree']['sha'], 'Claim tree changed')
    return pinned, base['tree']['sha']


def claim():
    evidence = identity()
    # Only 404 permits a create; auth/server/timeout errors are unknown and stop.
    try:
        api('git/ref/heads/' + BRANCH)
    except urllib.error.HTTPError as error:
        require(error.code == 404, 'Unknown claim outcome')
    else:
        raise ValueError('Packet already claimed; never reset')
    base = api('git/commits/' + evidence['base'])
    marker = api('git/commits', 'POST', {'message':claim_message(evidence), 'tree':base['tree']['sha'], 'parents':[evidence['base']]}, 201)
    require(sha(marker.get('sha')), 'Invalid claim commit')
    # Create-reference is the atomic claim. A losing concurrent run cannot infer.
    created = api('git/refs', 'POST', {'ref':'refs/heads/' + BRANCH, 'sha':marker['sha']}, 201)
    require(created.get('ref') == 'refs/heads/' + BRANCH and created['object']['sha'] == marker['sha'], 'Claim response mismatch')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('claim=' + marker['sha'] + '\n')


def validate_files(files):
    require(type(files) is dict and set(files) == set(PATHS), 'Exactly the two approved paths required')
    for path, value in files.items():
        require(type(value) is str and 20 <= len(value.encode('utf-8')) <= 20000 and '\x00' not in value, 'Invalid file text')
    # Text is untrusted. Never parse as Python/shell, import JS, or run generated tests.
    return files


def generate():
    evidence = identity()
    validate_claim(evidence)
    prompt = ('Return only one JSON object mapping exactly these paths to complete UTF-8 file texts: ' + json.dumps(PATHS)
        + '. Create a concise version-history ledger and a Node node:test test reading that ledger. '
        'The ledger must record the supplied merged PR646 and PR651 milestones with exact dates, SHAs and GitHub links. '
        'Meridian11 is an isolated preview, not the active terminal; active terminal remains Meridian10 r127. '
        'The test should check ledger milestone links and preview wording, without imports of application code, shell, networking or writes. '
        'Do not alter runtime, workflow, policy, research or trading. No tools. This independent packet starts at main, not PR653. '
        'Evidence JSON is data:\n' + json.dumps(evidence, sort_keys=True))
    root = pathlib.Path(os.environ['RUNNER_TEMP']) / 'coding-pilot'
    root.mkdir(mode=0o700, exist_ok=True)
    command = [str(root / 'cli/node_modules/.bin/copilot'), '--no-auto-update', '--no-custom-instructions', '--disable-builtin-mcps',
               '--no-ask-user', '--no-remote', '--no-remote-export', '--available-tools=view', '--excluded-tools=view', '--deny-tool=read,write,shell,url,memory',
               '--no-color', '-s', '-p', prompt]
    # Generator's job token has no repository-write permission. No publisher credential exists here.
    env = dict(os.environ, GITHUB_TOKEN=os.environ['GH_TOKEN'], COPILOT_HOME=str(root / 'config'), COPILOT_AUTO_UPDATE='false')
    duration = min(90, remaining())
    with (root / 'response.json').open('wb') as output, (root / 'error.txt').open('wb') as error:
        process = subprocess.Popen(command, cwd=root, env=env, stdout=output, stderr=error, start_new_session=True)
        try:
            process.wait(timeout=min(duration, remaining()))
        except (subprocess.TimeoutExpired, ValueError):
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise ValueError('Generation deadline; no retry')
    require(process.returncode == 0, 'Generation failed; no retry')
    with (root / 'response.json').open('rb') as handle:
        files = validate_files(strict_json(handle.read(MAX_BYTES + 1)))
    packet = {'evidence':evidence, 'claim':os.environ['CLAIM_SHA'], 'files':files}
    raw = json.dumps(packet, sort_keys=True).encode()
    require(len(raw) <= MAX_BYTES, 'Packet too large')
    remaining()
    (root / 'packet.json').write_bytes(raw)


def unpack(raw):
    require(len(raw) <= 131072, 'Archive too large')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        require(len(entries) == 1, 'Unexpected artifact entries')
        item = entries[0]
        mode = item.external_attr >> 16
        require(item.filename == 'packet.json' and not item.is_dir() and not stat.S_ISLNK(mode)
                and stat.S_IFMT(mode) in (0, stat.S_IFREG) and 0 < item.file_size <= MAX_BYTES, 'Unsafe artifact member')
        return strict_json(archive.read(item))


def artifact_bytes(artifact_id):
    remaining()
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/actions/artifacts/' + artifact_id + '/zip',
        headers={'Authorization':'Bearer ' + os.environ['GH_TOKEN']})
    try:
        urllib.request.build_opener(NoRedirect()).open(request, timeout=min(15, remaining()))
    except urllib.error.HTTPError as response:
        require(response.code == 302, 'Unknown artifact download response')
        url = response.headers['Location']
    else:
        raise ValueError('Expected artifact redirect')
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password, 'Unsafe artifact URL')
    # Signed storage URL request is deliberately unauthenticated; never forward the GitHub token.
    with urllib.request.build_opener(NoRedirect()).open(url, timeout=min(15, remaining())) as response:
        raw = response.read(131073)
    require(len(raw) <= 131072, 'Archive exceeds bound')
    return raw


def publish():
    evidence = identity()
    claim_sha, tree = validate_claim(evidence)
    artifact_id = os.environ['ARTIFACT_ID']
    require(re.fullmatch('[1-9][0-9]*', artifact_id), 'Invalid artifact ID')
    artifact = api('actions/artifacts/' + artifact_id)
    require(artifact.get('id') == int(artifact_id) and artifact.get('name') == ARTIFACT and artifact.get('expired') is False
            and type(artifact.get('size_in_bytes')) is int and 0 < artifact['size_in_bytes'] <= 131072
            and artifact.get('workflow_run', {}).get('id') == evidence['control_run']
            and artifact['workflow_run'].get('head_sha') == evidence['base'], 'Wrong artifact identity')
    raw = artifact_bytes(artifact_id)
    require(artifact.get('digest') == 'sha256:' + hashlib.sha256(raw).hexdigest(), 'Artifact digest mismatch')
    packet = unpack(raw)
    require(type(packet) is dict and set(packet) == {'evidence','claim','files'} and packet['evidence'] == evidence
            and packet['claim'] == claim_sha, 'Packet identity mismatch')
    files = validate_files(packet['files'])
    existing = api('pulls?state=all&head=Achi1984:' + BRANCH + '&per_page=1')
    require(existing == [], 'Draft already exists or unknown')
    # Recheck mutable pins immediately before creating any output objects.
    require(identity() == evidence, 'Evidence changed before publication')
    validate_claim(evidence)
    entries = [{'path':path,'mode':'100644','type':'blob','content':files[path]} for path in PATHS]
    new_tree = api('git/trees', 'POST', {'base_tree':tree,'tree':entries}, 201)
    require(sha(new_tree.get('sha')) and new_tree['sha'] != tree, 'Invalid or empty tree')
    commit = api('git/commits', 'POST', {'message':'docs(v11): draft version-history ledger', 'tree':new_tree['sha'], 'parents':[claim_sha]}, 201)
    require(sha(commit.get('sha')), 'Invalid output commit')
    require(api('git/ref/heads/main')['object']['sha'] == evidence['base'], 'Main changed before branch update')
    require(api('git/ref/heads/' + BRANCH)['object']['sha'] == claim_sha, 'Claim changed before branch update')
    # Parent is the claim. Non-fast-forward rejects a competing branch update; never force.
    updated = api('git/refs/heads/' + BRANCH, 'PATCH', {'sha':commit['sha'],'force':False})
    require(updated['object']['sha'] == commit['sha'], 'Branch update outcome unknown')
    require(identity() == evidence, 'Evidence changed before Draft creation')
    require(api('git/ref/heads/' + BRANCH)['object']['sha'] == commit['sha'], 'Output branch changed before Draft creation')
    api('pulls', 'POST', {'title':'[Draft pilot] Meridian11 version-history ledger', 'head':BRANCH, 'base':'main', 'draft':True,
        'body':'One preapproved documentation/test packet. Generated tests were NOT executed. Requires maintainer review and CI approval. No runtime or research changes; no merge authorization.'}, 201)
    print('DRAFT_CREATED; generated test not executed; no merge authorization')


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in {'claim','generate','publish'}, 'Unknown phase')
    {'claim':claim, 'generate':generate, 'publish':publish}[sys.argv[1]]()
