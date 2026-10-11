"""Preserved-artifact recovery core; authenticated launcher supplies live ports."""
import hashlib
import json
import pathlib
import re
import time
import types

CONFIG = None  # Importing or calling without explicit authenticated execution stays inert.
BASE = '8360160f2d55d3c1617fa7cc01ba717f7cf48819'
BRANCH = 'pilot/version-history-ledger-20261011-t4-recovery1'
ORIGINAL_BRANCH = 'pilot/version-history-ledger-20261011-t4'
OPERATION = 'trial4-artifact-recovery1-20261011'
DEADLINE = 1791741600
REPO = 'Achi1984/meridian'
BOT = 'meridian-draft-publisher[bot]'
VALIDATOR_HASH = 'ae202bd358f370c565de28ee00c2585a0c29a0e2d415a46dfb70875501c5114c'
CONFIGURED = {'operation': OPERATION, 'base': BASE, 'branch': BRANCH, 'deadline': DEADLINE}


def draft_payload():
    return {'title': '[Draft recovery] Original Trial4 ledger', 'head': BRANCH, 'base': 'main', 'draft': True,
            'body': 'Preserves original artifact 11705462075 without regeneration. Original evidence is historical; recovery targets the separately approved base. No merge authorization.'}


class ApiFailure(Exception):
    """Trusted adapter maps an actual HTTP response to a status; transport errors are not 404."""
    def __init__(self, status):
        self.status = status


def need(condition):
    if not condition:
        raise ValueError('RECOVERY_CHECK_FAILED')


def sha(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{40}', value) is not None


def own(repo):
    return (type(repo) is dict and repo.get('id') == 1342084551 and repo.get('full_name') == REPO
            and repo.get('fork') is False and repo.get('owner', {}).get('id') == 319562141
            and repo.get('owner', {}).get('login') == 'Achi1984')


def window():
    need(time.time() < DEADLINE)


def absent(api, path):
    try:
        api(path)
    except ApiFailure as error:
        need(error.status == 404)
    else:
        need(False)


def verified_evidence(archive, helper_bytes):
    raw = pathlib.Path(__file__).with_name('evidence').joinpath('validate_original_packet.py').read_bytes()
    need(hashlib.sha256(raw).hexdigest() == VALIDATOR_HASH)
    validator = types.ModuleType('verified_original_validator')
    validator.__file__ = '<verified-original-validator>'
    exec(compile(raw, validator.__file__, 'exec'), validator.__dict__)
    validator.validate_archive(archive, helper_bytes)
    helper = validator.load_pinned_helper(helper_bytes)
    return validator, helper, helper.unpack(archive)


def fence(api, v, base, expected_recovery=None):
    window()
    need(api('git/ref/heads/main')['object']['sha'] == base)
    need(api('git/ref/heads/' + ORIGINAL_BRANCH)['object']['sha'] == v.CLAIM_SHA)
    if expected_recovery is None:
        absent(api, 'git/ref/heads/' + BRANCH)
    else:
        need(api('git/ref/heads/' + BRANCH)['object']['sha'] == expected_recovery)
    pr = api('pulls/686')
    need(pr.get('number') == 686 and pr.get('state') == 'open' and pr.get('merged') is False
         and pr.get('head', {}).get('sha') == v.EXPECTED_EVIDENCE['source_head']
         and own(pr['head']['repo']) and pr.get('base', {}).get('ref') == 'main' and own(pr['base']['repo']))
    source = api('actions/runs/38141528699')
    need(source.get('id') == 38141528699 and source.get('run_attempt') == 2
         and source.get('workflow_id') == 347821227 and source.get('path') == '.github/workflows/backend-safety.yml'
         and source.get('event') == 'pull_request' and source.get('status') == 'completed'
         and source.get('conclusion') == 'success' and source.get('head_sha') == v.EXPECTED_EVIDENCE['source_head']
         and own(source.get('repository')) and own(source.get('head_repository'))
         and any(item.get('number') == 686 for item in source.get('pull_requests', []) if type(item) is dict))
    for branch in (ORIGINAL_BRANCH, BRANCH):
        need(api('pulls?state=all&head=Achi1984:' + branch + '&per_page=100') == [])


def preflight(api, v, helper, packet, base):
    fence(api, v, base)
    original = api('git/commits/' + v.CLAIM_SHA)
    historical_base = api('git/commits/' + v.EXPECTED_EVIDENCE['base'])
    need(original.get('message') == helper.claim_message(v.EXPECTED_EVIDENCE)
         and [p.get('sha') for p in original.get('parents', [])] == [v.EXPECTED_EVIDENCE['base']]
         and original['tree']['sha'] == historical_base['tree']['sha'])
    artifact = api('actions/artifacts/' + str(v.ARTIFACT_ID))
    need(artifact.get('id') == v.ARTIFACT_ID and artifact.get('expired') is False
         and artifact.get('name') == 'version-history-ledger-packet'
         and artifact.get('size_in_bytes') == v.ARCHIVE_BYTES and artifact.get('digest') == 'sha256:' + v.ARCHIVE_SHA256
         and artifact.get('workflow_run', {}).get('id') == 38147058996
         and artifact['workflow_run'].get('head_sha') == v.EXPECTED_EVIDENCE['base'])
    run = api('actions/runs/38147058996')
    need(run.get('id') == 38147058996 and run.get('run_attempt') == 1
         and run.get('head_sha') == v.EXPECTED_EVIDENCE['base'] and run.get('status') == 'completed'
         and run.get('conclusion') == 'failure' and own(run.get('repository')))
    for job_id, result in ((114492561673, 'success'), (114492680461, 'failure')):
        job = api('actions/jobs/' + str(job_id))
        need(job.get('id') == job_id and job.get('run_id') == 38147058996
             and job.get('run_attempt') == 1 and job.get('status') == 'completed' and job.get('conclusion') == result)
    for workflow, path in ((347821227, '.github/workflows/backend-safety.yml'), (347846572, '.github/workflows/runtime-smoke.yml')):
        listing = api('actions/workflows/' + str(workflow) + '/runs?head_sha=' + base + '&event=push&per_page=100')
        runs = listing.get('workflow_runs')
        need(type(runs) is list and 0 < len(runs) <= 100 and listing.get('total_count') == len(runs))
        need(all(r.get('head_sha') == base and r.get('head_branch') == 'main' and r.get('event') == 'push'
                 and r.get('workflow_id') == workflow and r.get('path') == path and r.get('status') == 'completed'
                 and r.get('conclusion') == 'success' and own(r.get('repository')) for r in runs))
    for path in packet['files']:
        absent(api, 'contents/' + path + '?ref=' + base)
    base_commit = api('git/commits/' + base)
    need(sha(base_commit.get('tree', {}).get('sha')))
    return base_commit['tree']['sha']


def recover_once(*, config=None, context=None, api=None, publisher_factory=None, publisher_receipt=None, archive=None, helper_bytes=None):
    """Trusted launcher must authenticate context, API and real broker factory.

    Dependencies have no production defaults. Synthetic ports cannot authorize a live run.
    The original artifact/evidence are never rewritten and no generator is available.
    """
    receipt = {'operation': OPERATION, 'stage': 'configuration', 'outcome': 'stopped',
               'model_calls': 0, 'publication_authorized': False, 'deadline': DEADLINE}
    mutated = False
    draft_validated = False
    try:
        need(type(config) is dict and sha(config.get('base')) and config == {**CONFIGURED, 'base': config['base']})
        base = config['base']
        need(callable(api) and callable(publisher_factory) and callable(publisher_receipt))
        need(type(context) is dict and context.get('repository') == REPO and context.get('ref') == 'refs/heads/main'
             and context.get('sha') == base and context.get('event') == 'workflow_dispatch'
             and context.get('actor') == 'Achi1984' and type(context.get('attempt')) is int and context['attempt'] == 1
             and type(context.get('run_id')) is int and context['run_id'] > 0
             and context.get('environment_approved') is True and context.get('original_failure_reconciled') is True)
        window()
        receipt['stage'] = 'original_evidence'
        v, helper, packet = verified_evidence(archive, helper_bytes)
        receipt['original_claim'] = v.CLAIM_SHA
        receipt['original_control_attempt'] = 1
        receipt['stage'] = 'preflight'
        tree = preflight(api, v, helper, packet, base)
        marker = {'operation': OPERATION, 'recovery_run': context['run_id'], 'recovery_attempt': 1,
                  'recovery_base': base, 'original_claim': v.CLAIM_SHA, 'original_run': 38147058996,
                  'original_attempt': 1, 'artifact_id': v.ARTIFACT_ID, 'artifact_sha256': v.ARCHIVE_SHA256}
        fence(api, v, base)
        receipt['stage'] = 'claim_attempted'
        window()
        mutated = True
        claim = api('git/commits', 'POST', {'message': 'MERIDIAN RECOVERY CLAIM\n' + json.dumps(marker, sort_keys=True),
                    'tree': tree, 'parents': [base]}, 201)
        need(sha(claim.get('sha')))
        window()
        claimed = api('git/refs', 'POST', {'ref': 'refs/heads/' + BRANCH, 'sha': claim['sha']}, 201)
        need(claimed.get('ref') == 'refs/heads/' + BRANCH and claimed.get('object', {}).get('sha') == claim['sha'])
        receipt['recovery_claim'] = claim['sha']
        fence(api, v, base, claim['sha'])
        receipt['stage'] = 'branch_preparation'
        entries = [{'path': path, 'mode': '100644', 'type': 'blob', 'content': text} for path, text in packet['files'].items()]
        window()
        tree_result = api('git/trees', 'POST', {'base_tree': tree, 'tree': entries}, 201)
        need(sha(tree_result.get('sha')) and tree_result['sha'] != tree)
        window()
        output = api('git/commits', 'POST', {'message': 'docs: preserve original Trial4 artifact',
                     'tree': tree_result['sha'], 'parents': [claim['sha']]}, 201)
        need(sha(output.get('sha')))
        fence(api, v, base, claim['sha'])
        window()
        advanced = api('git/refs/heads/' + BRANCH, 'PATCH', {'sha': output['sha'], 'force': False})
        need(advanced.get('object', {}).get('sha') == output['sha'])
        receipt['output_sha'] = output['sha']
        fence(api, v, base, output['sha'])
        receipt['stage'] = 'publisher_context'
        # Only the reviewed existing broker is a valid live factory: identity/scope checks and finally revocation.
        window()
        with publisher_factory() as token:
            need(type(token) is str and token.startswith('ghs_') and 4 < len(token) <= 4096 and not any(c.isspace() for c in token))
            fence(api, v, base, output['sha'])
            window()
            receipt['stage'] = 'draft_post_attempted'
            pr = api('pulls', 'POST', draft_payload(), 201, publisher_token=token)
            need(type(pr.get('number')) is int and pr['number'] > 0 and pr.get('draft') is True and pr.get('state') == 'open'
                 and pr.get('user', {}).get('login') == BOT and pr['user'].get('type') == 'Bot'
                 and pr.get('head', {}).get('sha') == output['sha'] and pr['head'].get('ref') == BRANCH and own(pr['head'].get('repo'))
                 and pr.get('base', {}).get('sha') == base and pr['base'].get('ref') == 'main' and own(pr['base'].get('repo')))
            receipt['pr_number'] = pr['number']
            draft_validated = True
        proof = publisher_receipt()
        need(draft_validated and type(proof) is dict and proof.get('revocation_confirmed') is True
             and proof.get('app_id') == 5272026 and proof.get('installation_id') == 170212503
             and proof.get('repository_id') == 1342084551)
        receipt['token_revocation_confirmed'] = True
        receipt.update(stage='publisher_context_completed', outcome='prepared_draft')
    except BaseException:
        # No raw exception, token, API body or key can enter the returned receipt.
        receipt['outcome'] = 'reconciliation_required' if mutated else 'stopped'
    return receipt
