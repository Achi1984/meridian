"""Inactive publisher/receiver protocol. Pure calculations, never authentication.

No HTTP, credentials, persistence, dispatch or existing binder integration.
All input records are claims until a separately reviewed adapter authenticates them.
"""
import datetime
import importlib.util
import pathlib
import re

_spec = importlib.util.spec_from_file_location(
    'publication_contract', pathlib.Path(__file__).with_name('review-evidence-contract.py'))
contract = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(contract)
REPOSITORY = 'Achi1984/meridian'
MAILBOX = 571
WORKFLOW = '.github/workflows/meridian-negative-publisher.yml'
FLAGS = {name: False for name in contract.FLAGS}


def need(condition, code):
    if not condition:
        raise ValueError(code)


def positive(value):
    return type(value) is int and 0 < value <= 9007199254740991


def sha(value):
    return type(value) is str and re.fullmatch(r'[a-f0-9]{40}', value)


def same(actual, expected):
    return type(actual) is type(expected) and actual == expected


def build_plan(body, scope_raw, policy_raw, pins_raw):
    """Build fixed-destination request data; it is NOT permission to send it."""
    pins = contract.decode(pins_raw)
    contract.shape(pins, ('repositoryId', 'mailbox', 'bodySha256', 'scopeSha256',
                          'policySha256', 'controlSha', 'workflowPath', 'workflowId',
                          'runId', 'runAttempt', 'event', 'ref', 'publisherActorId',
                          'ownerApprovalCommentId', 'ownerApprovalBodySha256'))
    need(all(positive(pins[k]) for k in ('repositoryId', 'workflowId', 'runId',
         'publisherActorId', 'ownerApprovalCommentId')), 'PIN_ID')
    need(type(pins['mailbox']) is int and pins['mailbox'] == MAILBOX, 'PIN_MAILBOX')
    need(type(pins['runAttempt']) is int and pins['runAttempt'] == 1, 'PIN_FIRST_ATTEMPT')
    need(sha(pins['controlSha']), 'PIN_CONTROL_SHA')
    need(pins['workflowPath'] == WORKFLOW and pins['event'] == 'workflow_dispatch'
         and pins['ref'] == 'refs/heads/main', 'PIN_WORKFLOW')
    need(all(contract.hex64(pins[k]) for k in ('bodySha256', 'scopeSha256',
         'policySha256', 'ownerApprovalBodySha256')), 'PIN_DIGEST')
    checked = contract.prepare_negative_publication(
        body, scope_raw, policy_raw, pins['bodySha256'])
    need(len(body.encode('utf-8')) <= 8192, 'PUBLICATION_RECEIPT_BOUND')
    scope = contract.decode(scope_raw)
    need(scope['repository'] == REPOSITORY, 'PIN_REPOSITORY')
    need(contract.digest(scope) == pins['scopeSha256'], 'PIN_SCOPE')
    need(checked['policySha256'] == pins['policySha256'], 'PIN_POLICY')
    # Stable across body/run/control changes: a new attempt cannot obtain a new key.
    key = contract.digest({'repositoryId': pins['repositoryId'], 'mailbox': MAILBOX,
                           'requestId': scope['requestId'], 'opId': scope['opId']})
    intent = {'pins': pins, 'scope': scope}
    return {'kind': 'OFFLINE_ACTIONS_PUBLICATION_PLAN', 'operationKey': key,
            'intentSha256': contract.digest(intent), 'intent': intent,
            'request': {'method': 'POST', 'url':
                        'https://api.github.com/repos/Achi1984/meridian/issues/571/comments',
                        'json': {'body': body}}, **FLAGS}


def transition(state_raw, operation_key, intent_sha256, event):
    """Proposed state change only. Caller MUST NOT use this as an atomic claim.

    Persist RESERVED via a linearizable compare-and-swap BEFORE any possible send.
    Only the winning claimant may send once. Recovered RESERVED never permits send.
    """
    need(contract.hex64(operation_key) and contract.hex64(intent_sha256), 'STATE_DIGEST')
    state = contract.decode(state_raw)
    contract.shape(state, ('operationKey', 'intentSha256', 'status'))
    need(state['operationKey'] == operation_key and state['intentSha256'] == intent_sha256,
         'STATE_CONFLICT')
    need(state['status'] in ('ABSENT', 'RESERVED', 'CONFIRMED', 'AMBIGUOUS'), 'STATE_STATUS')
    allowed = {('ABSENT', 'reserve'): 'RESERVED',
               ('RESERVED', 'verified_receipt'): 'CONFIRMED',
               ('RESERVED', 'uncertain'): 'AMBIGUOUS'}
    need((state['status'], event) in allowed, 'STATE_TERMINAL_OR_REPLAY')
    return {'state': {**state, 'status': allowed[(state['status'], event)]},
            'requiresAtomicPersistence': True, 'sendAllowed': False, **FLAGS}


def validate_receipt(body, scope_raw, policy_raw, pins_raw, run_raw, comment_raw, ledger_raw):
    """Check claimed read-back and ledger relationships. Does NOT authenticate them.

    An API comment plus Actions bot ID cannot identify its originating workflow.
    The ledger link must later come from independently authenticated storage.
    """
    plan = build_plan(body, scope_raw, policy_raw, pins_raw)
    pins = plan['intent']['pins']
    run = contract.decode(run_raw)
    contract.shape(run, ('repository', 'repositoryId', 'workflowPath', 'workflowId',
                         'runId', 'runAttempt', 'headSha', 'event', 'ref',
                         'status', 'conclusion'))
    expected_run = {k: pins[k] for k in ('repositoryId', 'workflowPath', 'workflowId',
                                        'runId', 'runAttempt', 'event', 'ref')}
    expected_run.update(repository=REPOSITORY, headSha=pins['controlSha'],
                        status='completed', conclusion='success')
    need(all(same(run[k], value) for k, value in expected_run.items()), 'RECEIPT_RUN')
    # Comment contains a full JSON body string: use a larger bounded container.
    comment = contract.decode(comment_raw, 32768)
    contract.shape(comment, ('id', 'repository', 'repositoryId', 'issueNumber',
                             'actorId', 'actorType', 'body', 'createdAt', 'updatedAt'))
    need(positive(comment['id']), 'RECEIPT_COMMENT_ID')
    need(comment['repository'] == REPOSITORY
         and same(comment['repositoryId'], pins['repositoryId'])
         and same(comment['issueNumber'], MAILBOX)
         and same(comment['actorId'], pins['publisherActorId'])
         and comment['actorType'] == 'Bot', 'RECEIPT_COMMENT_TARGET')
    need(comment['body'] == body, 'RECEIPT_BODY')
    need(type(comment['createdAt']) is str and re.fullmatch(
         r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', comment['createdAt'])
         and comment['createdAt'] == comment['updatedAt'], 'RECEIPT_EDITED')
    try:
        datetime.datetime.strptime(comment['createdAt'], '%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        raise ValueError('RECEIPT_TIMESTAMP')
    ledger = contract.decode(ledger_raw)
    contract.shape(ledger, ('operationKey', 'intentSha256', 'runId', 'runAttempt',
                            'commentId', 'bodySha256', 'status'))
    expected_ledger = {'operationKey': plan['operationKey'],
                       'intentSha256': plan['intentSha256'], 'runId': pins['runId'],
                       'runAttempt': pins['runAttempt'], 'commentId': comment['id'],
                       'bodySha256': pins['bodySha256'], 'status': 'CONFIRMED'}
    need(all(same(ledger[k], value) for k, value in expected_ledger.items()), 'RECEIPT_LEDGER')
    return {'kind': 'UNAUTHENTICATED_ACTIONS_RECEIPT_CANDIDATE',
            'operationKey': plan['operationKey'], 'intentSha256': plan['intentSha256'],
            'commentId': comment['id'], 'bodySha256': pins['bodySha256'],
            'verdict': 'REVISION_REQUIRED', 'bindingAllowed': False, **FLAGS}
