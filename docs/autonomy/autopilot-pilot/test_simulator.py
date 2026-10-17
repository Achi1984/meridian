import json
from pathlib import Path
import unittest

from simulator import simulate_transition


PROPOSAL_PATH = Path(__file__).with_name("proposal.json")
HEAD = "a" * 40
BASE = "b" * 40


def valid_inputs():
    proposal = json.loads(PROPOSAL_PATH.read_text())
    proposal.update({
        "enabled": True,
        "window_start_epoch": 100,
        "window_end_epoch": 1000,
        "activation_owner_approval": True,
        "autonomous_runner_dispatch": "NOT_ESTABLISHED",
    })
    state = {
        "target": 862,
        "head_sha": HEAD,
        "base_sha": BASE,
        "active_packet_count": 2,
        "processed_keys": [],
        "last_sequence": 0,
        "activation_approved": True,
        "active_writer": None,
        "operation": {"intent": None, "result": None},
        "ci": {"conclusion": "success", "head_sha": HEAD, "base_sha": BASE},
        "review": {
            "verdict": "GREEN_LIGHT",
            "head_sha": HEAD,
            "base_sha": BASE,
            "complete": True,
            "gaps": [],
            "self_reported_gap": False,
        },
    }
    event = {
        "repository": "Achi1984/meridian",
        "target": 862,
        "head_sha": HEAD,
        "base_sha": BASE,
        "phase": "review",
        "event_id": "fixture-event-1",
        "sequence": 1,
        "agent_id": "copilot",
    }
    return proposal, state, event


class PilotSimulationTests(unittest.TestCase):
    def test_source_config_is_disabled_and_bounded(self):
        proposal = json.loads(PROPOSAL_PATH.read_text())
        self.assertIs(proposal["enabled"], False)
        self.assertIsNone(proposal["window_start_epoch"])
        self.assertIsNone(proposal["window_end_epoch"])
        self.assertEqual(proposal["max_window_seconds"], 86400)
        self.assertEqual(proposal["max_active_packets"], 3)
        self.assertEqual(proposal["mutation_lanes"], 1)
        self.assertEqual(proposal["queue_order"], [862, 860, 861])
        self.assertEqual(proposal["lead_connected_issue_assignment"], "VERIFIED")
        self.assertEqual(proposal["autonomous_runner_dispatch"], "NOT_ESTABLISHED")

    def test_disabled_pilot_is_noop(self):
        proposal, state, event = valid_inputs()
        proposal["enabled"] = False
        self.assertEqual(
            simulate_transition(proposal, state, event, 200),
            {"status": "NOOP", "reason": "PILOT_DISABLED"},
        )

    def test_duplicate_and_out_of_order_events_are_noop(self):
        proposal, state, event = valid_inputs()
        state["processed_keys"] = [[proposal["repository"], 862, HEAD, "review"]]
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "DUPLICATE_EVENT",
        )
        state["processed_keys"] = []
        state["last_sequence"] = 1
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "OUT_OF_ORDER_EVENT",
        )

    def test_head_or_base_drift_blocks(self):
        proposal, state, event = valid_inputs()
        event["head_sha"] = "c" * 40
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "HEAD_OR_BASE_DRIFT",
        )
        event["head_sha"] = HEAD
        event["base_sha"] = "c" * 40
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "HEAD_OR_BASE_DRIFT",
        )

    def test_active_packet_limit_blocks(self):
        proposal, state, event = valid_inputs()
        state["active_packet_count"] = 4
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "ACTIVE_PACKET_LIMIT",
        )

    def test_missing_or_action_required_ci_blocks(self):
        proposal, state, event = valid_inputs()
        state["ci"] = None
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "EXACT_HEAD_CI_NOT_SUCCESS",
        )
        state["ci"] = {
            "conclusion": "action_required",
            "head_sha": HEAD,
            "base_sha": BASE,
        }
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "EXACT_HEAD_CI_NOT_SUCCESS",
        )

    def test_incomplete_green_review_blocks(self):
        proposal, state, event = valid_inputs()
        state["review"]["gaps"] = ["self-reported gap"]
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "REVIEW_INCOMPLETE_OR_STALE",
        )

    def test_conflicting_writer_blocks(self):
        proposal, state, event = valid_inputs()
        state["active_writer"] = "other-agent"
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "CONFLICTING_WRITER",
        )

    def test_partial_or_unknown_operation_blocks(self):
        proposal, state, event = valid_inputs()
        state["operation"] = {"intent": "op-1", "result": "PARTIAL"}
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "UNKNOWN_OPERATION_OUTCOME",
        )
        state["operation"]["result"] = "UNKNOWN"
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "UNKNOWN_OPERATION_OUTCOME",
        )
        state["operation"]["result"] = "APPLIED"
        self.assertEqual(
            simulate_transition(proposal, state, event, 200)["reason"],
            "OPERATION_ALREADY_APPLIED",
        )

    def test_expired_window_blocks(self):
        proposal, state, event = valid_inputs()
        self.assertEqual(
            simulate_transition(proposal, state, event, 1000)["reason"],
            "WINDOW_EXPIRED",
        )

    def test_unestablished_runner_dispatch_never_returns_ready(self):
        proposal, state, event = valid_inputs()
        result = simulate_transition(proposal, state, event, 200)
        self.assertEqual(result, {
            "status": "BLOCKED",
            "reason": "AUTONOMOUS_RUNNER_DISPATCH_NOT_ESTABLISHED",
        })
        self.assertNotIn(result["status"], {"READY", "DISPATCH"})


if __name__ == "__main__":
    unittest.main()
