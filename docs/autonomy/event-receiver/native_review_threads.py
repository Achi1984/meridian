"""Pure supplied GraphQL thread-page comparison; no transport or review authority."""
import hashlib
import json
import re
from collector import decode, need, obj
from native_review_observation import validate_expected


def project_threads(expected_raw, inventories_raw):
    """Exact frame: first/second arrays of 1..3 pages.

    Page: {prNumber, headSha, baseSha, after, nodes, pageInfo}.
    Node: {id, isResolved}. pageInfo: {hasNextPage, endCursor}.
    Pages have at most 50 nodes; continuation requires exactly 50. Scope fields
    and cursors are caller assertions, not independently collected provenance.
    """
    result = dict(status='BLOCKED', reason='INVALID_OR_CHANGED_THREADS',
                  authenticated=False, provenanceVerified=False, authorized=False,
                  dispatchAllowed=False, mergeAllowed=False, durable=False,
                  fullReviewEvidence=False, plannerResponse=None, observation=None)
    try:
        expected = validate_expected(expected_raw)
        need(type(inventories_raw) is bytes and len(inventories_raw) <= 131072, 'BOUND')
        pair = obj(decode(inventories_raw))
        need(set(pair) == {'first', 'second'}, 'FRAME')
        scope = expected['scope']

        def cursor(value):
            return type(value) is str and re.fullmatch(r'[A-Za-z0-9_+/=-]{1,256}', value) is not None

        def project(pages):
            need(type(pages) is list and 1 <= len(pages) <= 3, 'PAGES')
            previous, ids, cursors, rows = None, set(), set(), []
            for index, page in enumerate(pages):
                page = obj(page)
                need(set(page) == {'prNumber', 'headSha', 'baseSha', 'after', 'nodes', 'pageInfo'}, 'PAGE_SCHEMA')
                need(type(page['prNumber']) is int and page['prNumber'] == scope['prNumber']
                     and page['headSha'] == scope['headSha'] and page['baseSha'] == scope['baseSha'], 'SCOPE')
                need(page['after'] == previous, 'CURSOR_CHAIN')
                nodes, info = page['nodes'], obj(page['pageInfo'])
                need(type(nodes) is list and len(nodes) <= 50, 'NODES')
                need(set(info) == {'hasNextPage', 'endCursor'} and type(info['hasNextPage']) is bool, 'PAGE_INFO')
                need(info['hasNextPage'] is (index < len(pages)-1), 'COMPLETE')
                if info['hasNextPage']:
                    need(len(nodes) == 50, 'PARTIAL_CONTINUATION')
                end = info['endCursor']
                if nodes:
                    need(cursor(end) and end not in cursors, 'CURSOR')
                    cursors.add(end)
                else:
                    need(end is None and not info['hasNextPage'], 'EMPTY_PAGE')
                for node in nodes:
                    node = obj(node)
                    need(set(node) == {'id', 'isResolved'}, 'NODE_SCHEMA')
                    identity = node['id']
                    need(type(identity) is str and re.fullmatch(r'[A-Za-z0-9_=-]{1,128}', identity)
                         and identity not in ids and type(node['isResolved']) is bool, 'NODE')
                    ids.add(identity)
                    rows.append({'id':identity, 'isResolved':node['isResolved']})
                previous = end
            return rows

        first, second = project(pair['first']), project(pair['second'])
        need(first == second and pair['first'] == pair['second'], 'DRIFT')
        unresolved = sum(not row['isResolved'] for row in first)
        digest = hashlib.sha256(json.dumps(first, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        result.update(status='OBSERVED_THREADS_INCOMPLETE', reason='FULL_REVIEW_EVIDENCE_MISSING',
                      observation=dict(scope=scope, threadCount=len(first), unresolvedCount=unresolved,
                                       suppliedAllResolved=unresolved == 0, inventoryDigest=digest,
                                       suppliedPaginationComplete=True, transportPaginationVerified=False))
    except Exception:
        pass
    return result
