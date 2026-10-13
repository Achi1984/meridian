"""Inert fixed-query GraphQL transport. No CLI, wiring or review authority.

Only explicit invocation performs requests. Socket timeout is at most 15s;
the 60s elapsed budget is checked between operations, not hard cancellation.
"""
import json
import re
import time
import urllib.request
from collector import NoRedirect, need
from native_review_observation import validate_expected
from native_review_thread_collector import QUERY, collect_thread_observation
from native_review_threads import project_threads

ENDPOINT = 'https://api.github.com/graphql'


def observe_threads(expected_raw, token):
    """Fetch at most six bounded responses; keep evidence non-authoritative."""
    blocked = project_threads(b'{}', b'{}')
    try:
        expected = validate_expected(expected_raw)
        number = expected['scope']['prNumber']
        need(number <= 2147483647, 'GRAPHQL_INT')
        need(type(token) is str and 0 < len(token) <= 4096
             and all(33 <= ord(c) <= 126 for c in token), 'TOKEN')
        opener = urllib.request.build_opener(NoRedirect())
        deadline = time.monotonic() + 60
        calls, total = 0, 0

        def read_query(query, variables):
            nonlocal calls, total
            need(type(query) is str and query == QUERY, 'QUERY')
            need(type(variables) is dict and set(variables) == {'number', 'after'}, 'VARIABLES')
            need(type(variables['number']) is int and variables['number'] == number, 'NUMBER')
            after = variables['after']
            need(after is None or (type(after) is str
                 and re.fullmatch(r'[A-Za-z0-9_+/=-]{1,256}', after)), 'CURSOR')
            remaining = deadline - time.monotonic()
            need(remaining > 0 and calls < 6, 'BUDGET')
            payload = json.dumps({'query': QUERY, 'variables': {'number': number, 'after': after}},
                                 separators=(',', ':')).encode('utf-8')
            request = urllib.request.Request(ENDPOINT, data=payload, method='POST', headers={
                'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'meridian-readonly-threads'})
            calls += 1
            with opener.open(request, timeout=min(15, remaining)) as response:
                need(response.status == 200 and response.geturl() == ENDPOINT, 'RESPONSE')
                raw = response.read(32769)
            need(time.monotonic() < deadline, 'TIME')
            need(type(raw) is bytes and len(raw) <= 32768, 'SIZE')
            total += len(raw)
            need(total <= 196608, 'TOTAL')
            return raw

        result = collect_thread_observation(expected_raw, read_query)
        need(time.monotonic() < deadline, 'TIME')
        return result
    except Exception:
        return blocked
