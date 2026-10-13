import copy
import json
import unittest
from native_review_thread_collector import QUERY, collect_thread_observation

A, B = 'a'*40, 'b'*40
EXPECTED = {'scope':{'prNumber':736,'headSha':B,'baseSha':A,
    'ci':{'runId':123,'runAttempt':1,'workflowId':347821227,'headSha':B}},
    'review':{'id':99,'submittedAt':'2026-10-12T20:48:50Z','bodySha256':'d'*64}}


def response(nodes=None, more=False, cursor='cursor1'):
    nodes = [{'id':'PRRT_1','isResolved':True}] if nodes is None else nodes
    return {'data':{'repository':{'nameWithOwner':'Achi1984/meridian','databaseId':1342084551,'isFork':False,
        'pullRequest':{'number':736,'state':'OPEN','headRefOid':B,'baseRefOid':A,'baseRefName':'main',
            'reviewThreads':{'nodes':nodes,'pageInfo':{'hasNextPage':more,'endCursor':cursor if nodes else None}}}}}}


class CollectorTests(unittest.TestCase):
    def collect(self, responses, expected=EXPECTED):
        calls=[]
        def reader(query,variables):
            self.assertEqual(query,QUERY)
            calls.append(dict(variables))
            row=responses[len(calls)-1]
            if isinstance(row,Exception): raise row
            return row if type(row) is bytes else json.dumps(row).encode()
        result=collect_thread_observation(json.dumps(expected).encode(),reader)
        for flag in ('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable','fullReviewEvidence'):
            self.assertIs(result[flag],False)
        self.assertIsNone(result['plannerResponse'])
        self.assertNotIn('SECRET',json.dumps(result))
        return result,calls

    def test_two_passes_are_incomplete_and_fixed_query(self):
        result,calls=self.collect([response(),response()])
        self.assertEqual(result['status'],'OBSERVED_THREADS_INCOMPLETE')
        self.assertEqual(calls,[{'number':736,'after':None}]*2)
        self.assertIs(result['observation']['transportPaginationVerified'],False)
        self.assertNotIn('mutation',QUERY)

    def test_three_pages_each_pass_preserve_cursor_and_unresolved_count(self):
        pages=[response([{'id':'T'+str(i*50+n),'isResolved':i!=2} for n in range(50)],i<2,'cursor'+str(i)) for i in range(3)]
        result,calls=self.collect(pages+copy.deepcopy(pages))
        self.assertEqual(result['observation']['threadCount'],150)
        self.assertEqual(result['observation']['unresolvedCount'],50)
        self.assertEqual([c['after'] for c in calls],[None,'cursor0','cursor1']*2)

    def test_fourth_page_requirement_stops_without_extra_call(self):
        pages=[response([{'id':'T'+str(i*50+n),'isResolved':True} for n in range(50)],True,'cursor'+str(i)) for i in range(3)]
        result,calls=self.collect(pages)
        self.assertEqual(result['status'],'BLOCKED');self.assertEqual(len(calls),3)

    def test_invalid_cursor_or_partial_continuation_never_used(self):
        cases=[response([],True), response(more=True),
               response([{'id':'T'+str(n),'isResolved':True} for n in range(50)],True,'SECRET /cursor')]
        for row in cases:
            result,calls=self.collect([row])
            self.assertEqual(result['status'],'BLOCKED');self.assertEqual(len(calls),1)
        first=response([{'id':'T'+str(n),'isResolved':True} for n in range(50)],True,'cursor0')
        repeated=response([{'id':'T'+str(n),'isResolved':True} for n in range(50,100)],True,'cursor0')
        result,calls=self.collect([first,repeated])
        self.assertEqual(result['status'],'BLOCKED');self.assertEqual(len(calls),2)

    def test_partial_error_wrong_repo_and_pr_scope_block(self):
        cases=[]
        row=response();row['errors']=[{'message':'SECRET'}];cases.append(row)
        row=response();row['errors']=[];cases.append(row)
        for key,value in (('nameWithOwner','other/repo'),('databaseId',True),('isFork',True)):
            row=response();row['data']['repository'][key]=value;cases.append(row)
        for key,value in (('number',True),('state','CLOSED'),('headRefOid',A),('baseRefOid',B),('baseRefName','other')):
            row=response();row['data']['repository']['pullRequest'][key]=value;cases.append(row)
        for row in cases:
            result,calls=self.collect([row]);self.assertEqual(result['status'],'BLOCKED');self.assertEqual(len(calls),1)

    def test_second_pass_drift_and_duplicate_nodes_block(self):
        changed=response([{'id':'PRRT_1','isResolved':False}])
        result,_=self.collect([response(),changed]);self.assertEqual(result['status'],'BLOCKED')
        duplicate=response([{'id':'T1','isResolved':True}]*2)
        result,calls=self.collect([duplicate]);self.assertEqual(result['status'],'BLOCKED');self.assertEqual(len(calls),1)

    def test_empty_inventory_remains_unverified(self):
        result,_=self.collect([response([]),response([])])
        self.assertEqual(result['observation']['threadCount'],0)
        self.assertIs(result['fullReviewEvidence'],False)

    def test_invalid_input_and_transport_bytes_fail_closed(self):
        invalid=copy.deepcopy(EXPECTED);invalid['scope']['prNumber']=2**31
        result,calls=self.collect([],invalid);self.assertEqual(result['status'],'BLOCKED');self.assertEqual(calls,[])
        invalid=copy.deepcopy(EXPECTED);invalid['scope']['headSha']='bad'
        result,calls=self.collect([],invalid);self.assertEqual(result['status'],'BLOCKED');self.assertEqual(calls,[])
        for raw in (b'x'*32769,b'NaN',b'{"data":{},"data":{}}',RuntimeError('SECRET token')):
            result,calls=self.collect([raw]);self.assertEqual(result['status'],'BLOCKED');self.assertEqual(len(calls),1)


if __name__ == '__main__':
    unittest.main()
