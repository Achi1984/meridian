import copy
import hashlib
import json
import unittest
from native_review_inventory import project_inventory, MAX_INPUT
from native_review_observation import ACTOR

A, B, C = (letter*40 for letter in 'abc')


def fixture():
    body = 'Synthetic approval'
    expected = {'scope': {'prNumber':736, 'headSha':B, 'baseSha':A,
        'ci': {'runId':123, 'runAttempt':1, 'workflowId':347821227, 'headSha':B}},
        'review': {'id':99, 'submittedAt':'2026-10-12T20:48:50Z',
                   'bodySha256':hashlib.sha256(body.encode()).hexdigest()}}
    row = {'id':99, 'user':dict(ACTOR), 'commit_id':B, 'state':'APPROVED',
           'submitted_at':expected['review']['submittedAt'], 'body':body,
           'pull_request_url':'https://api.github.com/repos/Achi1984/meridian/pulls/736'}
    return expected, row


class InventoryTests(unittest.TestCase):
    def run_inventory(self, pages, second=None, expected=None):
        expected = expected or fixture()[0]
        result = project_inventory(json.dumps(expected).encode(),
            json.dumps({'first':pages, 'second':pages if second is None else second}).encode())
        for key in ('authenticated', 'provenanceVerified', 'authorized', 'dispatchAllowed',
                    'mergeAllowed', 'durable', 'fullReviewEvidence'):
            self.assertIs(result[key], False)
        self.assertIsNone(result['plannerResponse'])
        self.assertNotIn('Synthetic approval', json.dumps(result))
        self.assertNotIn('SECRET', json.dumps(result))
        return result

    def blocked(self, pages, second=None):
        result = self.run_inventory(pages, second)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertIsNone(result['observation'])

    def test_selected_observation_remains_incomplete(self):
        _, row = fixture()
        result = self.run_inventory([[row]])
        self.assertEqual(result['status'], 'OBSERVED_INVENTORY_INCOMPLETE')
        self.assertEqual(result['observation']['reviewCount'], 1)
        self.assertIs(result['observation']['transportPaginationVerified'], False)

    def test_complete_multiple_pages_and_terminal_empty(self):
        _, row = fixture()
        for size in (50, 51, 100, 149):
            rows = [row] + [{**row, 'id':1000+n} for n in range(size-1)]
            pages = [rows[n:n+50] for n in range(0,size,50)]
            if size % 50 == 0:
                pages.append([])
            result = self.run_inventory(pages)
            self.assertEqual(result['observation']['reviewCount'], size)

    def test_page_boundaries_duplicates_and_missing_selected(self):
        _, row = fixture()
        full = [row] + [{**row,'id':1000+n} for n in range(49)]
        for pages in ([], [[]], [[row],[]], [full], [full,full,full],
                      [full,full,[],[]], [[row,row]], [[{**row,'id':1}]], [[row]*51]):
            self.blocked(pages)

    def test_invalid_rows_are_rejected(self):
        _, row = fixture()
        for key, value in (('id',True),('id',2**63),('commit_id','bad'),
                           ('state','UNKNOWN'),('state',[]),('submitted_at','2026-02-30T20:48:50Z'),
                           ('submitted_at',None),('body',None),('body','a'*16385),
                           ('pull_request_url','SECRET')):
            self.blocked([[{**row,key:value}]])
        for key, value in (('id',True),('login','SECRET / actor'),('type','Organization')):
            self.blocked([[{**row,'user':{**row['user'],key:value}}]])

    def test_selected_pins_are_mandatory(self):
        _, row = fixture()
        for key, value in (('commit_id',C),('state','DISMISSED'),('body','changed'),
                           ('submitted_at','2026-10-11T20:48:50Z'),('user',{'id':2,'login':'other','type':'User'})):
            self.blocked([[{**row,key:value}]])

    def test_other_heads_adverse_reviews_and_pending_retained_not_promoted(self):
        _, row = fixture()
        extra = {**row,'id':100,'commit_id':C,'state':'CHANGES_REQUESTED'}
        pending = {**row,'id':101,'state':'PENDING','submitted_at':None}
        result = self.run_inventory([[row,extra,pending]])
        self.assertEqual(result['status'],'OBSERVED_INVENTORY_INCOMPLETE')
        self.assertEqual(result['observation']['reviewCount'],3)
        self.assertNotEqual(result['observation']['inventoryDigest'],
                            self.run_inventory([[row]])['observation']['inventoryDigest'])

    def test_second_read_drift_rejects_changes_order_and_deletion(self):
        _, row = fixture()
        extra={**row,'id':100}
        self.blocked([[row,extra]], [[extra,row]])
        self.blocked([[row,extra]], [[row]])
        for key, value in (('state','DISMISSED'),('body','SECRET'),('commit_id',C)):
            self.blocked([[row]], [[{**row,key:value}]])

    def test_raw_schema_bounds_and_duplicate_keys(self):
        expected,_=fixture()
        for raw in (b'[]',b'{"first":[],"first":[],"second":[]}',b'NaN',
                    b'x'*(MAX_INPUT+1),b'{"first":[],"second":[],"extra":true}'):
            result=project_inventory(json.dumps(expected).encode(),raw)
            self.assertEqual(result['status'],'BLOCKED')
        self.assertEqual(project_inventory(b'{}',b'{}')['status'],'BLOCKED')


if __name__ == '__main__':
    unittest.main()
