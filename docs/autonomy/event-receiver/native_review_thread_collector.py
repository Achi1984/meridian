"""Source-only bounded GraphQL response collector; no network implementation."""
import json
from collector import REPO, REPO_ID, decode, need, obj
from native_review_observation import validate_expected
from native_review_threads import project_threads

QUERY = '''query MeridianThreadObservation($number:Int!,$after:String){
  repository(owner:"Achi1984",name:"meridian"){
    nameWithOwner databaseId isFork
    pullRequest(number:$number){
      number state headRefOid baseRefOid baseRefName
      reviewThreads(first:50,after:$after){
        nodes{id isResolved}
        pageInfo{hasNextPage endCursor}
      }
    }
  }
}'''


def collect_thread_observation(expected_raw, read_query):
    """Injected callable receives fixed query + fresh variables, returns bytes.

    At most six explicit query calls; no retries. The trusted caller owns query
    transport, timeout and credentials. Pins and responses alone authenticate
    nothing. Return only the existing incomplete, redacted thread projection.
    """
    blocked = project_threads(b'{}', b'{}')
    try:
        expected = validate_expected(expected_raw)
        scope = expected['scope']
        need(scope['prNumber'] <= 2147483647, 'GRAPHQL_INT')
        pair, total = {}, 0
        for pass_name in ('first', 'second'):
            pages, after = [], None
            for index in range(3):
                raw = read_query(QUERY, {'number':scope['prNumber'], 'after':after})
                need(type(raw) is bytes and len(raw) <= 32768, 'BOUND')
                total += len(raw)
                need(total <= 196608, 'TOTAL')
                response = obj(decode(raw))
                need('errors' not in response, 'PARTIAL_GRAPHQL')
                repo = obj(obj(response.get('data')).get('repository'))
                need(repo.get('nameWithOwner') == REPO and type(repo.get('databaseId')) is int
                     and repo['databaseId'] == REPO_ID and repo.get('isFork') is False, 'REPO')
                pr = obj(repo.get('pullRequest'))
                need(type(pr.get('number')) is int and pr['number'] == scope['prNumber']
                     and pr.get('state') == 'OPEN' and pr.get('baseRefName') == 'main'
                     and pr.get('headRefOid') == scope['headSha'] and pr.get('baseRefOid') == scope['baseSha'], 'PR')
                connection = obj(pr.get('reviewThreads'))
                nodes, info = connection.get('nodes'), obj(connection.get('pageInfo'))
                need(type(nodes) is list and len(nodes) <= 50, 'NODES')
                need(set(info) == {'hasNextPage', 'endCursor'} and type(info['hasNextPage']) is bool, 'PAGE_INFO')
                page = dict(prNumber=pr['number'], headSha=pr['headRefOid'], baseSha=pr['baseRefOid'],
                            after=after, nodes=nodes, pageInfo=info)
                pages.append(page)
                # Validate each prefix before its cursor is used in another call.
                # A temporary terminal view validates the same rows/cursor chain.
                terminal = json.loads(json.dumps(pages))
                terminal[-1]['pageInfo']['hasNextPage'] = False
                frame = json.dumps({'first':terminal, 'second':terminal}, separators=(',', ':')).encode()
                need(project_threads(expected_raw, frame)['status'] == 'OBSERVED_THREADS_INCOMPLETE', 'PAGE_INVALID')
                if not info['hasNextPage']:
                    break
                need(index < 2 and len(nodes) == 50, 'PAGE_LIMIT')
                after = info['endCursor']
            pair[pass_name] = pages
        encoded = json.dumps(pair, separators=(',', ':')).encode()
        need(len(encoded) <= 131072, 'FRAME_BOUND')
        return project_threads(expected_raw, encoded)
    except Exception:
        return blocked
