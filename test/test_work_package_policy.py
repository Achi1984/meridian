import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from work_package_policy import validate_policy


class WorkPackagePolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads((ROOT / 'MERIDIAN_LIVE_CHECKPOINT.json').read_text())['streamSafety']

    def test_canonical_copies_agree(self):
        for filename, key in [('MERIDIAN_LIVE_CHECKPOINT.json', 'streamSafety'),
                              ('MERIDIAN_AGENT_STATE.json', 'streamingGuard'),
                              ('MERIDIAN_RESUME.json', 'coordination')]:
            with self.subTest(filename=filename):
                self.assertEqual(validate_policy(json.loads((ROOT / filename).read_text())[key]), [])

    def test_no_implicit_authority(self):
        for key in ['automaticDispatchAuthorized', 'additionalSpendAuthorized', 'workflowChangesAuthorized']:
            with self.subTest(key=key):
                candidate = copy.deepcopy(self.policy)
                candidate[key] = True
                self.assertTrue(validate_policy(candidate))

    def test_missing_or_disabled_guards_rejected(self):
        for key in ['ownerMergeApprovalRequired', 'operationIntentRequired',
                    'expectedStateGuardRequired', 'reconcileAfterEveryMutation',
                    'checkpointAfterEveryMutation']:
            for replacement in [False, 1, None]:
                with self.subTest(key=key, replacement=replacement):
                    candidate = copy.deepcopy(self.policy)
                    candidate[key] = replacement
                    self.assertTrue(validate_policy(candidate))
            candidate = copy.deepcopy(self.policy)
            del candidate[key]
            self.assertTrue(validate_policy(candidate))

    def test_no_concurrent_writer_or_poll_expansion(self):
        for key in ['maxConcurrentWritersPerBranch', 'maxSameStatusPollsPerSession']:
            for value in [0, 2, True, '1']:
                with self.subTest(key=key, value=value):
                    candidate = copy.deepcopy(self.policy)
                    candidate[key] = value
                    self.assertTrue(validate_policy(candidate))

    def test_old_caps_cannot_silently_coexist(self):
        for key in ['maxMutationsPerTurn', 'maxToolCallGroupsPerTurn', 'maxTurnSeconds', 'oneMutationPerBurst']:
            candidate = copy.deepcopy(self.policy)
            candidate[key] = 1
            self.assertTrue(validate_policy(candidate))

    def test_malformed_policy_rejected(self):
        for candidate in [None, [], 'V8', {}]:
            self.assertTrue(validate_policy(candidate))


if __name__ == '__main__':
    unittest.main()
