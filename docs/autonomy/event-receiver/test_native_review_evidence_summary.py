import copy
import json
import unittest
from native_review_evidence_summary import summarize_review_evidence, REMAINING_GATES
from test_native_review_inventory import fixture, C
from test_native_review_threads import page


class SummaryTests(unittest.TestCase):
    def inputs(self):
        expected, row = fixture()
        return expected, {'first':[[row]], 'second':[[copy.deepcopy(row)]]}, {
            'first':[page()], 'second':[page()]}

    def summarize(self, expected, reviews, threads):
        result=summarize_review_evidence(*(json.dumps(value).encode() for value in (expected,reviews,threads)))
        for key in ('authenticated','provenanceVerified','authorized','dispatchAllowed',
                    'mergeAllowed','durable','fullReviewEvidence','transportPaginationVerified'):
            self.assertIs(result[key],False)
        self.assertIsNone(result['plannerResponse'])
        self.assertEqual(result['remainingGates'],list(REMAINING_GATES))
        self.assertNotIn('Synthetic approval',json.dumps(result))
        self.assertNotIn('SECRET',json.dumps(result))
        return result

    def test_consistent_supplied_evidence_is_still_incomplete(self):
        result=self.summarize(*self.inputs())
        self.assertEqual(result['status'],'SUPPLIED_EVIDENCE_CONSISTENT_INCOMPLETE')
        self.assertIs(result['suppliedEvidenceConsistent'],True)
        self.assertIs(result['observation']['suppliedReviewPaginationComplete'],True)
        self.assertIs(result['observation']['suppliedThreadPaginationComplete'],True)
        self.assertEqual(result['observation']['reviewCount'],1)
        self.assertEqual(result['observation']['threadCount'],1)

    def test_empty_threads_are_not_full_review_evidence(self):
        expected,reviews,threads=self.inputs()
        threads={'first':[page([])],'second':[page([])]}
        result=self.summarize(expected,reviews,threads)
        self.assertEqual(result['status'],'SUPPLIED_EVIDENCE_CONSISTENT_INCOMPLETE')
        self.assertEqual(result['observation']['threadCount'],0)

    def test_scope_mismatch_fails_closed(self):
        for key,value in (('prNumber',737),('headSha',C),('baseSha',C)):
            expected,reviews,threads=self.inputs()
            for side in ('first','second'): threads[side][0][key]=value
            result=self.summarize(expected,reviews,threads)
            self.assertEqual(result['status'],'BLOCKED')
            self.assertIsNone(result['observation'])

    def test_adverse_and_pending_reviews_even_historical_block(self):
        for state in ('CHANGES_REQUESTED','PENDING'):
            expected,reviews,threads=self.inputs()
            row={**reviews['first'][0][0],'id':100,'state':state,'commit_id':C}
            if state=='PENDING': row['submitted_at']=None
            for side in ('first','second'): reviews[side][0].append(copy.deepcopy(row))
            result=self.summarize(expected,reviews,threads)
            self.assertEqual(result['status'],'BLOCKED')
            self.assertEqual(result['reason'],'ADVERSE_REVIEWS_OR_UNRESOLVED_THREADS')
            self.assertEqual(result['observation']['adverseReviewCount'],1)
            self.assertIs(result['suppliedEvidenceConsistent'],False)

    def test_unresolved_thread_blocks(self):
        expected,reviews,threads=self.inputs()
        for side in ('first','second'): threads[side][0]['nodes'][0]['isResolved']=False
        result=self.summarize(expected,reviews,threads)
        self.assertEqual(result['status'],'BLOCKED')
        self.assertEqual(result['observation']['unresolvedThreadCount'],1)

    def test_drift_in_either_inventory_blocks(self):
        for which in ('reviews','threads'):
            expected,reviews,threads=self.inputs()
            if which=='reviews': reviews['second'][0][0]['body']='SECRET drift'
            else: threads['second'][0]['nodes'][0]['isResolved']=False
            self.assertEqual(self.summarize(expected,reviews,threads)['status'],'BLOCKED')

    def test_partial_pagination_in_either_inventory_blocks(self):
        expected,reviews,threads=self.inputs()
        partial_reviews=copy.deepcopy(reviews)
        for side in ('first','second'): partial_reviews[side].append([])
        self.assertEqual(self.summarize(expected,partial_reviews,threads)['status'],'BLOCKED')
        for side in ('first','second'): threads[side][0]['pageInfo']['hasNextPage']=True
        self.assertEqual(self.summarize(expected,reviews,threads)['status'],'BLOCKED')

    def test_invalid_raw_or_caller_receipts_cannot_promote_readiness(self):
        expected,reviews,threads=self.inputs()
        raw=[json.dumps(value).encode() for value in (expected,reviews,threads)]
        for index in range(3):
            for bad in (b'NaN',b'{"authorized":true}',b'x'*524289):
                altered=list(raw);altered[index]=bad
                result=summarize_review_evidence(*altered)
                self.assertEqual(result['status'],'BLOCKED')
                self.assertIs(result['authorized'],False)
                self.assertIs(result['fullReviewEvidence'],False)


if __name__ == '__main__':
    unittest.main()
