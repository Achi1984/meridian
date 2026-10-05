import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))

from lead_lease_validation import REQUIRED_CROSS_MODEL_REVIEW, validate_lead_lease


SHA_A="a"*40
SHA_B="b"*40


def held(lead="CHATGPT",sub="CLAUDE"):
    return {
        "lead":lead,
        "subAgent":sub,
        "status":"HELD",
        "acquiredAtMainSha":SHA_A,
        "releasedAtMainSha":None,
        "nextLead":None,
        "crossModelReviewRequiredFor":sorted(REQUIRED_CROSS_MODEL_REVIEW),
        "subAgentMayPushMain":False,
        "subAgentMayMerge":False,
    }


def released(lead="CHATGPT",sub="CLAUDE",next_lead="CLAUDE"):
    return {
        "lead":lead,
        "subAgent":sub,
        "status":"RELEASED",
        "acquiredAtMainSha":SHA_A,
        "releasedAtMainSha":SHA_B,
        "nextLead":next_lead,
        "crossModelReviewRequiredFor":sorted(REQUIRED_CROSS_MODEL_REVIEW),
        "subAgentMayPushMain":False,
        "subAgentMayMerge":False,
    }


class LeadLeaseValidationTests(unittest.TestCase):
    def test_current_held_lease_is_valid(self):
        self.assertEqual(validate_lead_lease(held(),"CLAUDE"),[])

    def test_protocol_release_step_is_valid(self):
        self.assertEqual(validate_lead_lease(released(),"CLAUDE"),[])

    def test_reacquired_lease_with_claude_as_lead_is_valid(self):
        self.assertEqual(validate_lead_lease(held("CLAUDE","CHATGPT"),"CHATGPT"),[])

    def test_same_lead_and_subagent_fails(self):
        errors=validate_lead_lease(held("CHATGPT","CHATGPT"),"CHATGPT")
        self.assertTrue(any("must differ" in e for e in errors))

    def test_released_without_next_lead_fails(self):
        lease=released();lease["nextLead"]=None
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("nextLead" in e for e in errors))

    def test_released_self_handover_fails(self):
        lease=released(next_lead="CHATGPT")
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("nextLead must differ" in e for e in errors))

    def test_subagent_merge_permission_fails(self):
        lease=held();lease["subAgentMayMerge"]=True
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("subAgentMayMerge" in e for e in errors))

    def test_unknown_status_fails(self):
        lease=held();lease["status"]="UNKNOWN"
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("status" in e for e in errors))

    def test_reviewer_must_match_subagent(self):
        errors=validate_lead_lease(held(),"CHATGPT")
        self.assertTrue(any("cross-model reviewer must match" in e for e in errors))

    def test_missing_reviewer_fails(self):
        errors=validate_lead_lease(held(),None)
        self.assertTrue(any("cross-model reviewer must be" in e for e in errors))

    def test_unknown_reviewer_fails(self):
        errors=validate_lead_lease(held(),"GPT-6-Sol")
        self.assertTrue(any("cross-model reviewer must be" in e for e in errors))

    def test_required_review_categories_current_six_pass(self):
        self.assertEqual(validate_lead_lease(held(),"CLAUDE"),[])

    def test_required_review_categories_superset_passes(self):
        lease=held()
        lease["crossModelReviewRequiredFor"].append("EXTRA_FUTURE_CATEGORY")
        self.assertEqual(validate_lead_lease(lease,"CLAUDE"),[])

    def test_empty_required_review_categories_fail(self):
        lease=held();lease["crossModelReviewRequiredFor"]=[]
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("missing required categories" in e for e in errors))

    def test_missing_required_review_categories_field_fails(self):
        lease=held();lease.pop("crossModelReviewRequiredFor")
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("must be a list" in e for e in errors))

    def test_one_required_review_category_missing_fails(self):
        lease=held();lease["crossModelReviewRequiredFor"].remove("ACCOUNTING")
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("ACCOUNTING" in e for e in errors))

    def test_required_review_categories_wrong_type_fails(self):
        lease=held();lease["crossModelReviewRequiredFor"]="ACCOUNTING"
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("must be a list" in e for e in errors))


if __name__=="__main__":
    unittest.main()
