import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))

from lead_lease_validation import validate_lead_lease


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

    def test_subagent_merge_permission_fails(self):
        lease=held();lease["subAgentMayMerge"]=True
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("subAgentMayMerge" in e for e in errors))

    def test_unknown_status_fails(self):
        lease=held();lease["status"]="UNKNOWN"
        errors=validate_lead_lease(lease,"CLAUDE")
        self.assertTrue(any("status" in e for e in errors))

    def test_reviewer_must_match_subagent(self):
        errors=validate_lead_lease(held(),"GPT-6-Sol")
        self.assertTrue(any("cross-model reviewer" in e for e in errors))


if __name__=="__main__":
    unittest.main()
