"""Pure bounded review inventory comparison; supplied pages are not provenance."""
import hashlib
import json
import re
from datetime import datetime
from collector import REPO, decode, need, obj, sha
from native_review_observation import ACTOR, positive_id, validate_expected

MAX_INPUT = 524288
STATES = {'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'}


def project_inventory(expected_raw, inventories_raw):
    """Bytes JSON: exactly {first: [page,...], second: [page,...]}.

    Each page is a raw review array, at most 50 entries; at most three pages.
    All nonterminal pages have exactly 50 entries and the terminal page <50.
    This verifies only supplied sequence shape, never actual API pagination.
    """
    result = dict(status='BLOCKED', reason='INVALID_OR_CHANGED_INVENTORY',
                  authenticated=False, provenanceVerified=False, authorized=False,
                  dispatchAllowed=False, mergeAllowed=False, durable=False,
                  fullReviewEvidence=False, plannerResponse=None, observation=None)
    try:
        expected = validate_expected(expected_raw)
        need(type(inventories_raw) is bytes and len(inventories_raw) <= MAX_INPUT, 'INPUT')
        pair = obj(decode(inventories_raw))
        need(set(pair) == {'first', 'second'}, 'SCHEMA')
        scope, selected = expected['scope'], expected['review']

        def project(pages):
            need(type(pages) is list and 1 <= len(pages) <= 3, 'PAGES')
            rows, ids = [], set()
            for index, page in enumerate(pages):
                need(type(page) is list and len(page) <= 50, 'PAGE')
                need(len(page) < 50 if index == len(pages)-1 else len(page) == 50, 'TERMINAL')
                for raw in page:
                    raw = obj(raw)
                    identity = raw.get('id')
                    need(positive_id(identity) and identity not in ids, 'IDENTITY')
                    ids.add(identity)
                    need(raw.get('pull_request_url') == 'https://api.github.com/repos/'+REPO+'/pulls/'+str(scope['prNumber']), 'PR')
                    user = obj(raw.get('user'))
                    actor = {key:user.get(key) for key in ('id', 'login', 'type')}
                    need(positive_id(actor['id']) and type(actor['login']) is str
                         and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,99}(?:\[bot\])?', actor['login'])
                         and actor['type'] in ('User', 'Bot'), 'ACTOR')
                    head, state, submitted = raw.get('commit_id'), raw.get('state'), raw.get('submitted_at')
                    # Earlier-head reviews belong in an all-review inventory; retain,
                    # never silently relabel them as current-head evidence.
                    need(sha(head) and type(state) is str and state in STATES, 'REVIEW')
                    if state == 'PENDING':
                        need(submitted is None, 'TIME')
                    else:
                        need(type(submitted) is str and re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', submitted), 'TIME')
                        datetime.strptime(submitted, '%Y-%m-%dT%H:%M:%SZ')
                    body = raw.get('body')
                    need(type(body) is str and len(body.encode('utf-8')) <= 16384, 'BODY')
                    rows.append(dict(id=identity, actor=actor, headSha=head, state=state,
                                     submittedAt=submitted, bodySha256=hashlib.sha256(body.encode('utf-8')).hexdigest()))
            return rows

        first, second = project(pair['first']), project(pair['second'])
        need(first == second, 'CHANGED')
        matches = [row for row in first if row['id'] == selected['id']]
        need(len(matches) == 1, 'SELECTED')
        row = matches[0]
        need(row['actor'] == ACTOR and row['state'] == 'APPROVED' and row['headSha'] == scope['headSha']
             and row['submittedAt'] == selected['submittedAt'] and row['bodySha256'] == selected['bodySha256'], 'SELECTED')
        digest = hashlib.sha256(json.dumps(first, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()
        result.update(status='OBSERVED_INVENTORY_INCOMPLETE', reason='THREADS_AND_EXECUTED_CHECKS_MISSING',
                      observation=dict(scope=scope, review=selected, inventoryDigest=digest,
                                       adverseReviewCount=sum(row['state'] in ('CHANGES_REQUESTED', 'PENDING') for row in first),
                                       reviewCount=len(first), suppliedPaginationComplete=True,
                                       transportPaginationVerified=False))
    except Exception:
        pass
    return result

