import copy
import json
import unittest
from native_review_threads import project_threads
from test_native_review_inventory import fixture, A, B, C


def page(nodes=None, *, after=None, end='cursor1', more=False):
    nodes = [{'id':'PRRT_1', 'isResolved':True}] if nodes is None else nodes
    return {'prNumber':736, 'headSha':B, 'baseSha':A, 'after':after, 'nodes':nodes,
            'pageInfo':{'hasNextPage':more, 'endCursor':end if nodes else None}}


class ThreadTests(unittest.TestCase):
    def observe(self, first, second=None):
        expected,_ = fixture()
        result=project_threads(json.dumps(expected).encode(), json.dumps({
            'first':first, 'second':first if second is None else second}).encode())
        for flag in ('authenticated','provenanceVerified','authorized','dispatchAllowed',
                     'mergeAllowed','durable','fullReviewEvidence'):
            self.assertIs(result[flag], False)
        self.assertIsNone(result['plannerResponse'])
        self.assertNotIn('SECRET', json.dumps(result))
        return result

    def blocked(self, first, second=None):
        result=self.observe(first,second)
        self.assertEqual(result['status'],'BLOCKED')
        self.assertIsNone(result['observation'])

    def test_resolved_and_unresolved_are_observations_only(self):
        for resolved in (True,False):
            result=self.observe([page([{'id':'PRRT_1','isResolved':resolved}])])
            self.assertEqual(result['status'],'OBSERVED_THREADS_INCOMPLETE')
            self.assertEqual(result['observation']['unresolvedCount'],0 if resolved else 1)
            self.assertIs(result['observation']['suppliedAllResolved'],resolved)
            self.assertIs(result['observation']['transportPaginationVerified'],False)

    def test_empty_complete_inventory(self):
        result=self.observe([page([])])
        self.assertEqual(result['observation']['threadCount'],0)
        self.assertIs(result['observation']['suppliedAllResolved'],True)

    def test_full_terminal_page_and_three_page_inventory(self):
        first=page([{'id':'PRRT_'+str(n),'isResolved':True} for n in range(50)],more=True)
        second=page([{'id':'PRRT_'+str(n),'isResolved':True} for n in range(50,100)],
                    after='cursor1',end='cursor2',more=True)
        last=page([{'id':'PRRT_'+str(n),'isResolved':False} for n in range(100,150)],
                  after='cursor2',end='cursor3')
        result=self.observe([first,second,last])
        self.assertEqual(result['observation']['threadCount'],150)
        self.assertEqual(result['observation']['unresolvedCount'],50)

    def test_pagination_missing_partial_duplicate_and_cursor_errors(self):
        full=page([{'id':'PRRT_'+str(n),'isResolved':True} for n in range(50)],more=True)
        for pages in ([],[page(more=True)],[page(),page()], [full],
                      [full,page(after='wrong')], [full,page(after='cursor1',end='cursor1')],
                      [full,page([{'id':'PRRT_0','isResolved':True}],after='cursor1',end='cursor2')],
                      [page()]*4):
            self.blocked(pages)

    def test_schema_node_type_and_scope_errors(self):
        for key,value in (('prNumber',True),('headSha',C),('baseSha',C),('extra','SECRET'),
                          ('nodes',{}),('pageInfo',{'hasNextPage':0,'endCursor':'cursor1'})):
            bad=page();bad[key]=value;self.blocked([bad])
        for node in ({'id':'PRRT_1','isResolved':1},{'id':'PRRT_1'},
                     {'id':'SECRET / invalid','isResolved':True},
                     {'id':'PRRT_1','isResolved':True,'body':'SECRET'},
                     {'id':'PRRT_1','isResolved':None}):
            self.blocked([page([node])])

    def test_second_inventory_change_or_removal_blocks(self):
        first=[page()]
        changed=copy.deepcopy(first);changed[0]['nodes'][0]['isResolved']=False
        self.blocked(first,changed)
        self.blocked(first,[page([])])
        changed=copy.deepcopy(first);changed[0]['pageInfo']['endCursor']='cursor2'
        self.blocked(first,changed)

    def test_raw_bounds_duplicate_keys_and_schema(self):
        expected,_=fixture()
        for raw in (b'x'*131073,b'NaN',b'[]',b'{"first":[],"first":[],"second":[]}',
                    b'{"first":[],"second":[],"extra":true}'):
            result=project_threads(json.dumps(expected).encode(),raw)
            self.assertEqual(result['status'],'BLOCKED')
        self.assertEqual(project_threads(b'{}',b'{}')['status'],'BLOCKED')


if __name__ == '__main__':
    unittest.main()
