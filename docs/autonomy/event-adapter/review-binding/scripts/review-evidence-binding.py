"""Source-only comment-version binding. Caller inputs do not authenticate anything."""
import hashlib
import importlib.util
import json
import pathlib
import re
from datetime import datetime, timezone

_spec = importlib.util.spec_from_file_location('review_transport', pathlib.Path(__file__).resolve().parent.parent / 'fixtures' / 'structured-review-transport.py')
_transport = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_transport)


def _need(ok, code):
    if not ok:
        raise ValueError(code)


def _shape(value, keys):
    _need(type(value) is dict and set(value) == set(keys), 'INVALID_SCHEMA')


def _positive(value):
    return type(value) is int and 0 < value <= 9007199254740991


def _timestamp(value):
    if type(value) is not str or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', value):
        return False
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') == value
    except ValueError:
        return False


def guard_exact_comment(observation_raw, expected_raw):
    """Validate ORIGINAL full comment bytes, Claude actor and independent version.

    Returns parsed observation/expected only in memory; no claim verdict validation.
    Raises fixed ValueError codes. Callers must validate the entire claim afterward.
    """
    observed = _transport.strict_object(observation_raw, bound=131072, depth_limit=4)
    expected = _transport.strict_object(expected_raw, bound=16384, depth_limit=4)
    _shape(observed, ('repository','issueNumber','eventAction','comment'))
    _shape(expected, ('scope','actor','version','issueNumber','reviewerFamily'))
    _shape(expected['actor'], ('id','login','type'))
    _shape(expected['version'], ('commentId','createdAt','updatedAt','bodySha256'))
    _shape(expected['scope'], ('repository','requestId','opId','headSha','baseSha','prNumber','ci'))
    actor, version, scope = expected['actor'], expected['version'], expected['scope']
    _need(expected['reviewerFamily'] == 'claude', 'CLAUDE_REVIEW_REQUIRED')
    _need(_positive(actor['id']) and type(actor['login']) is str
          and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?', actor['login'])
          and actor['type'] in ('User','Bot'), 'ACTOR_PIN_INVALID')
    # A native Copilot account/review is not a Claude review contract. A future
    # Claude-via-Copilot route requires its separately reviewed model attestation.
    _need('copilot' not in actor['login'].lower(), 'COPILOT_SUBSTITUTION_REJECTED')
    _need(actor == {'id':209825114,'login':'claude[bot]','type':'Bot'}, 'CLAUDE_ACTOR_PIN_REQUIRED')
    _need(scope['repository'] == observed['repository'] == 'Achi1984/meridian'
          and type(expected['issueNumber']) is int and type(observed['issueNumber']) is int
          and expected['issueNumber'] == observed['issueNumber'], 'REPOSITORY_OR_MAILBOX_MISMATCH')
    _need(expected['issueNumber'] == 571, 'MAILBOX_PIN_REQUIRED')
    _need(observed['eventAction'] in ('created','edited','deleted'), 'EVENT_ACTION_INVALID')
    _need(_positive(version['commentId']) and _timestamp(version['createdAt'])
          and _timestamp(version['updatedAt']) and version['updatedAt'] >= version['createdAt']
          and type(version['bodySha256']) is str and re.fullmatch(r'[a-f0-9]{64}', version['bodySha256']), 'VERSION_PIN_INVALID')
    comment = observed['comment']
    _shape(comment, ('id','user','created_at','updated_at','body'))
    _shape(comment['user'], ('id','login','type'))
    _need(_positive(comment['id']) and comment['id'] == version['commentId'], 'COMMENT_ID_MISMATCH')
    _need(comment['user'] == actor and type(comment['user']['id']) is int, 'ACTOR_MISMATCH')
    if observed['eventAction'] == 'deleted':
        raise ValueError('REVIEW_DELETED')
    _need(_timestamp(comment['created_at']) and _timestamp(comment['updated_at'])
          and comment['updated_at'] >= comment['created_at'], 'COMMENT_TIME_INVALID')
    _need(type(comment['body']) is str and len(comment['body'].encode('utf-8')) <= 16384, 'BODY_BOUND_INVALID')
    digest = hashlib.sha256(comment['body'].encode('utf-8')).hexdigest()
    if (comment['created_at'] != version['createdAt'] or comment['updated_at'] != version['updatedAt']
            or digest != version['bodySha256']):
        raise ValueError('COMMENT_VERSION_CHANGED')
    if not comment['body'].lstrip().startswith('{'):
        raise ValueError('STRUCTURED_CLAUDE_CLAIM_MISSING')
    return observed, expected


def bind_review(observation_raw, expected_raw):
    """Bound serialized GitHub-shaped metadata and independently supplied pins.

    No GitHub read, native approval, reviewer authentication or permission occurs.
    Body must itself be the complete structured JSON claim, not model prose.
    """
    def result(decision, reason, response=None, version=None):
        return {'kind':'UNVERIFIED_REVIEW_BINDING','decision':decision,'reason':reason,
                'plannerResponse':response,'version':version,
                'authenticated':False,'provenanceVerified':False,'authorized':False,
                'dispatchAllowed':False,'mergeAllowed':False,'durable':False}
    try:
        observed, expected = guard_exact_comment(observation_raw, expected_raw)
        scope, version, comment = expected['scope'], expected['version'], observed['comment']
        checked = _transport.validate_received(comment['body'], json.dumps(scope, separators=(',', ':')))
        response = {key:scope[key] for key in ('repository','requestId','opId','headSha','baseSha')}
        response.update(reviewCommentId=comment['id'], reviewAuthor='CLAUDE', verdict=checked['verdict'])
        return result('CANDIDATE_REVIEW' if checked['verdict'] == 'GREEN_LIGHT' else 'BLOCKED',
                      'STRUCTURED_CLAIM_BOUND_UNVERIFIED' if checked['verdict'] == 'GREEN_LIGHT' else 'NON_GREEN_REVIEW',
                      response, dict(version))
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        # Only fixed codes; raw metadata, body or subprocess diagnostics never leave.
        code = str(error)
        return result('BLOCKED', code if re.fullmatch(r'[A-Z][A-Z_]{2,79}', code) else 'BINDING_INVALID')
