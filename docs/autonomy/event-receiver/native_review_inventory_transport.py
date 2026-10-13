"""Inert bounded REST inventory reader. No CLI, activation or authority.

Only explicit calls perform GETs. Pins select scope, not current PR/CI truth.
Socket timeout is 15 seconds; the 60-second elapsed budget is checked between
operations (not a hard cancellation of an in-flight socket read).
"""
import json
import re
import time
import urllib.request
from collector import REPO, NoRedirect, decode, need
from native_review_observation import validate_expected
from native_review_inventory import MAX_INPUT, project_inventory

MAX_PAGE_BYTES = 87381


def _links(headers, base, page):
    values = headers.get_all('Link', [])
    need(len(values) <= 1, 'LINK')
    if not values:
        return False
    value = values[0]
    need(type(value) is str and 0 < len(value) <= 4096, 'LINK')
    found = {}
    for part in value.split(','):
        match = re.fullmatch(r'\s*<([^<>]+)>;\s*rel="(next|prev|first|last)"\s*', part)
        need(match is not None, 'LINK')
        url, rel = match.groups()
        need(rel not in found, 'LINK')
        target = next((n for n in range(1, 4) if url == base + str(n)), None)
        need(target is not None, 'LINK_SCOPE')
        need((rel != 'next' or target == page + 1)
             and (rel != 'prev' or target == page - 1)
             and (rel != 'first' or target == 1)
             and (rel != 'last' or target >= page), 'LINK_ORDER')
        found[rel] = target
    return 'next' in found


def observe_inventory(expected_raw, token, *, _budget=None):
    """Two bounded passes, at most six GETs; sanitized fail-closed result.

    Returned evidence remains incomplete and unauthenticated: transport does not
    verify current head/base/CI, threads or execution. Never follows Link URLs.
    """
    blocked = project_inventory(b'{}', b'{}')
    try:
        expected = validate_expected(expected_raw)  # Before token use or opener.
        need(type(token) is str and 0 < len(token) <= 4096
             and all(33 <= ord(c) <= 126 for c in token), 'TOKEN')
        base = ('https://api.github.com/repos/' + REPO + '/pulls/'
                + str(expected['scope']['prNumber']) + '/reviews?per_page=50&page=')
        opener = urllib.request.build_opener(NoRedirect())
        if _budget is not None:
            from native_review_packet import _PacketBudget
            need(type(_budget) is _PacketBudget, 'BUDGET_TYPE')
            opener = _budget.wrap_opener(opener)
        deadline = time.monotonic() + 60
        pair = {}
        total = 0
        for name in ('first', 'second'):
            pages = []
            for page in range(1, 4):
                remaining = deadline - time.monotonic()
                need(remaining > 0, 'TIME')
                url = base + str(page)
                request = urllib.request.Request(url, method='GET', headers={
                    'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'meridian-readonly-inventory'})
                with opener.open(request, timeout=min(15, remaining)) as response:
                    need(response.status == 200 and response.geturl() == url, 'RESPONSE')
                    more = _links(response.headers, base, page)
                    raw = response.read(MAX_PAGE_BYTES + 1)
                need(time.monotonic() < deadline, 'TIME')
                total += len(raw)
                need(len(raw) <= MAX_PAGE_BYTES and total <= MAX_INPUT, 'SIZE')
                rows = decode(raw)
                need(type(rows) is list and len(rows) <= 50, 'ARRAY')
                pages.append(rows)
                if len(rows) < 50:
                    need(not more, 'LINK_TERMINAL')
                    break
                need(page < 3, 'PAGE_LIMIT')
                # Full last pages need a terminal empty page for offline shape.
            pair[name] = pages
        encoded = json.dumps(pair, separators=(',', ':')).encode()
        need(len(encoded) <= MAX_INPUT, 'SIZE')
        return project_inventory(expected_raw, encoded)
    except Exception:
        return blocked

