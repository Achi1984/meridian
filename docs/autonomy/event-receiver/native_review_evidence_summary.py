"""Pure composition of supplied inventories; never an execution/readiness gate."""
from collector import decode
from native_review_inventory import project_inventory
from native_review_threads import project_threads

REMAINING_GATES = (
    'AUTHENTICATED_TRANSPORT_AND_PAGINATION',
    'CURRENT_PR_MAIN_AND_CI_RECONCILIATION',
    'EXECUTED_CHECK_EVIDENCE',
    'INDEPENDENT_REVIEW_AND_OWNER_APPROVAL_EVIDENCE',
)


def summarize_review_evidence(expected_raw, reviews_raw, threads_raw):
    """Require both bounded validators; never accept caller-projected receipts.

    Any supplied CHANGES_REQUESTED or PENDING review blocks conservatively,
    including historical heads. No latest-review/supersession policy is inferred.
    """
    result = dict(status='BLOCKED', reason='INVALID_OR_CHANGED_EVIDENCE',
                  authenticated=False, provenanceVerified=False, authorized=False,
                  dispatchAllowed=False, mergeAllowed=False, durable=False,
                  fullReviewEvidence=False, plannerResponse=None,
                  suppliedEvidenceConsistent=False, transportPaginationVerified=False,
                  remainingGates=list(REMAINING_GATES), observation=None)
    try:
        reviews = project_inventory(expected_raw, reviews_raw)
        threads = project_threads(expected_raw, threads_raw)
        if reviews['status'] != 'OBSERVED_INVENTORY_INCOMPLETE' or threads['status'] != 'OBSERVED_THREADS_INCOMPLETE':
            return result
        review_data, thread_data = reviews['observation'], threads['observation']
        if review_data['scope'] != thread_data['scope']:
            return result
        # Reuse only inputs already bounded, schema-checked, and compared twice.
        pages = decode(reviews_raw)['first']
        adverse = sum(row['state'] in ('CHANGES_REQUESTED', 'PENDING') for page in pages for row in page)
        if adverse or thread_data['unresolvedCount']:
            result.update(reason='ADVERSE_REVIEWS_OR_UNRESOLVED_THREADS',
                          observation=dict(adverseReviewCount=adverse,
                                           unresolvedThreadCount=thread_data['unresolvedCount']))
            return result
        result.update(status='SUPPLIED_EVIDENCE_CONSISTENT_INCOMPLETE',
                      reason='TRANSPORT_CHECKS_AND_APPROVAL_EVIDENCE_MISSING',
                      suppliedEvidenceConsistent=True,
                      observation=dict(scope=review_data['scope'], review=review_data['review'],
                          reviewCount=review_data['reviewCount'], threadCount=thread_data['threadCount'],
                          reviewInventoryDigest=review_data['inventoryDigest'],
                          threadInventoryDigest=thread_data['inventoryDigest'],
                          suppliedReviewPaginationComplete=review_data['suppliedPaginationComplete'],
                          suppliedThreadPaginationComplete=thread_data['suppliedPaginationComplete']))
    except Exception:
        pass
    return result
