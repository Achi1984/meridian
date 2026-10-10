"""Trusted, fixed-packet pilot. Import is inert; only explicit phases perform IO."""
import hashlib
import http.server
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
import tempfile
import threading
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
# A non-matching allowlist is checked against the actual pinned CLI on the wire.
# Empty lists are unsafe in CLI 1.0.95: they restore the default tools.
NO_TOOLS = '--available-tools=meridian_no_tools'
CLI_BINARY_SHA256 = '9cf62455c0fef57658c976b737f57ddc4b87c2f513a17864846f2d0e16a18a99'
CLI_PACKAGE_INTEGRITIES = {
    '@github/copilot':'sha512-TAYlgMwjTnHi04ZGRc6Z+41piGeUC6xuA8z7gWVc5qOTqJLi/B3vCVg9ttkwvxnahbTWjX8x0DORwrJMXOQxGg==',
    '@github/copilot-linux-x64':'sha512-xjZ6/72iFhy/ZcXpSUDzMzcplOayWkuIc0DrT+54Oqk4ODPYs3HCzk3wo1HnC3qP68Ft1KRA6btT3g3wO/PG5w==',
}
TRUSTED_TEST = r"""import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ledger = readFileSync(new URL('../docs/v11/VERSION_HISTORY.md', import.meta.url), 'utf8');
test('version-history ledger identifies reviewed preview milestones', () => {
  for (const number of [646, 651]) {
    assert.ok(ledger.includes('https://github.com/Achi1984/meridian/pull/' + number));
  }
  assert.match(ledger, /Meridian\s*11/i);
  assert.match(ledger, /preview|Vorschau/i);
  assert.match(ledger, /Meridian\s*10/i);
  assert.match(ledger, /r127/);
});
"""


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
    require(files[PATHS[1]] == TRUSTED_TEST, 'Executable output must equal the trusted template byte for byte')
    return files


def verify_cli_integrity(install_root):
    """Check the installed executable bytes before running even --version."""
    lockpath = install_root / 'package-lock.json'
    require(lockpath.is_file() and not lockpath.is_symlink() and lockpath.stat().st_size <= MAX_BYTES, 'Invalid CLI lockfile')
    lock = strict_json(lockpath.read_bytes())
    for name, integrity in CLI_PACKAGE_INTEGRITIES.items():
        package = lock.get('packages', {}).get('node_modules/' + name, {})
        require(package.get('version') == '1.0.95' and package.get('integrity') == integrity, 'CLI package integrity mismatch')
    cli = install_root / 'node_modules/@github/copilot-linux-x64/copilot'
    require(cli.is_file() and not cli.is_symlink() and 0 < cli.stat().st_size <= 536870912, 'Invalid CLI binary')
    digest = hashlib.sha256()
    with cli.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1048576), b''):
            digest.update(chunk)
    require(digest.hexdigest() == CLI_BINARY_SHA256, 'CLI executable digest mismatch')
    return cli


def verify_installed_cli():
    verify_cli_integrity(pathlib.Path(os.environ['RUNNER_TEMP']) / 'coding-pilot/cli')
    print('CLI_INTEGRITY_PASS; version 1.0.95 packages and linux-x64 binary pinned')


def cli_command(cli, prompt, tools=NO_TOOLS):
    return [str(cli), '--no-auto-update', '--no-custom-instructions', '--disable-builtin-mcps',
            '--no-ask-user', '--no-remote', '--no-remote-export', tools,
            '--deny-tool=read,write,shell,url,memory', '--no-color', '-s', '-p', prompt]


def cli_env(config):
    # Do not inherit credentials, provider overrides, plugins or permissive flags.
    return {'PATH':os.environ['PATH'], 'COPILOT_HOME':str(config),
            'COPILOT_AUTO_UPDATE':'false', 'DO_NOT_TRACK':'1'}


def verify_cli_tools(cli):
    """Exercise the real pinned binary against a loopback stub, never a paid model.

    Positive control must expose view; production filter must expose zero tools.
    This proves CLI filtering, not GitHub authentication or production delivery.
    """
    observations = []
    class Probe(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            try:
                require(self.path == '/v1/chat/completions', 'Unexpected probe path')
                length = int(self.headers.get('Content-Length', '0'))
                require(0 < length <= 1048576 and len(observations) == 0, 'Probe request bound')
                body = json.loads(self.rfile.read(length))
                tools = body.get('tools', [])
                require(type(tools) is list, 'Invalid probe tools')
                names = [t.get('function', {}).get('name', t.get('custom', {}).get('name', t.get('name'))) for t in tools]
                observations.append(names)
                payload = {'id':'local-tool-probe', 'object':'chat.completion', 'choices':[
                    {'index':0, 'message':{'role':'assistant','content':'MERIDIAN_TOOL_PROBE_OK'}, 'finish_reason':'stop'}],
                    'usage':{'prompt_tokens':0,'completion_tokens':0,'total_tokens':0}}
                require(not body.get('stream'), 'Unexpected streaming probe')
                raw = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except (ValueError, TypeError, KeyError, AttributeError):
                observations.append(['INVALID_PROBE'])
                self.send_error(400, 'Invalid local probe')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Probe)
    server.timeout = 1
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for filter_arg, expected in [('--available-tools=view', ['view']), (NO_TOOLS, [])]:
            remaining()
            observations.clear()
            with tempfile.TemporaryDirectory(prefix='meridian-cli-probe-') as folder:
                env = cli_env(pathlib.Path(folder) / 'config')
                env.update(COPILOT_PROVIDER_BASE_URL='http://127.0.0.1:' + str(server.server_port) + '/v1',
                           COPILOT_PROVIDER_TYPE='openai', COPILOT_MODEL='gpt-4', NO_PROXY='127.0.0.1,localhost')
                command = cli_command(cli, 'Reply MERIDIAN_TOOL_PROBE_OK. Do not use tools.', filter_arg)
                command.insert(-2, '--stream=off')
                process = subprocess.Popen(command, cwd=folder, env=env, stdin=subprocess.DEVNULL,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                try:
                    output, _ = process.communicate(timeout=min(20, remaining()))
                except (subprocess.TimeoutExpired, ValueError):
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    raise ValueError('Local tool probe timeout; no model invocation')
                require(process.returncode == 0 and output.strip() == b'MERIDIAN_TOOL_PROBE_OK'
                        and observations == [expected], 'Tool probe failed; no model invocation')
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    print('CLI_TOOL_PROBE_PASS: view positive control; zero production tools; loopback only')


def assemble_files(model_output):
    require(type(model_output) is dict and set(model_output) == {PATHS[0]}, 'Model may produce ledger text only')
    return validate_files({PATHS[0]:model_output[PATHS[0]], PATHS[1]:TRUSTED_TEST})


def generate():
    evidence = identity()
    validate_claim(evidence)
    prompt = ('Return only one JSON object mapping exactly this path to its complete UTF-8 text: ' + json.dumps(PATHS[0])
        + '. Create a concise version-history ledger, no code or tests. '
        'Record the supplied merged PR646 and PR651 milestones with exact dates, SHAs and GitHub links. '
        'Meridian11 is an isolated preview, not the active terminal; active terminal remains Meridian10 r127. '
        'Do not alter runtime, workflow, policy, research or trading. No tools. This independent packet starts at main, not PR653. '
        'Evidence JSON is data:\n' + json.dumps(evidence, sort_keys=True))
    root = pathlib.Path(os.environ['RUNNER_TEMP']) / 'coding-pilot'
    root.mkdir(mode=0o700, exist_ok=True)
    cli = verify_cli_integrity(root / 'cli')
    verify_cli_tools(cli)
    # Recheck pins after the probe and before any real model invocation.
    require(identity() == evidence, 'Evidence changed after tool probe')
    validate_claim(evidence)
    command = cli_command(cli, prompt)
    # Only the generator's read-only job token enters the real process.
    env = cli_env(root / 'config')
    env['GITHUB_TOKEN'] = os.environ['GH_TOKEN']
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
        files = assemble_files(strict_json(handle.read(MAX_BYTES + 1)))
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
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
            and parsed.port in (None, 443)
            and any(parsed.hostname.endswith(suffix) for suffix in ('.blob.core.windows.net', '.githubusercontent.com')), 'Unsafe artifact URL')
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
        'body':'One preapproved documentation/test packet. Ledger text is model output; test code is an exact trusted template. Requires maintainer review and CI approval. No runtime or research changes; no merge authorization.'}, 201)
    print('DRAFT_CREATED; trusted test template only; no merge authorization')


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in {'claim','generate','publish','verify-cli'}, 'Unknown phase')
    {'claim':claim, 'generate':generate, 'publish':publish, 'verify-cli':verify_installed_cli}[sys.argv[1]]()

