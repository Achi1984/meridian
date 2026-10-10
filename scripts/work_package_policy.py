EXPECTED = {'executionUnit': 'AUTHORIZED_WORK_PACKAGE', 'stopTurnAfterMutation': False, 'checkpointAfterEveryMutation': True, 'maxSameStatusPollsPerSession': 1, 'maxConcurrentWritersPerBranch': 1, 'operationIntentRequired': True, 'expectedStateGuardRequired': True, 'reconcileAfterEveryMutation': True, 'ownerMergeApprovalRequired': True, 'automaticDispatchAuthorized': False, 'additionalSpendAuthorized': False, 'workflowChangesAuthorized': False, 'readOnlyConflictDiagnosisAllowed': True, 'successfulCiEvidenceReadAllowed': True, 'policyProposalCommentId': 6096562356}
REMOVED = ['maxCommentaryCheckpointsPerTurn', 'maxLogSlicePerTurn', 'maxMutationsPerTurn', 'maxMutationsPerVisibleBurst', 'maxSameStatusPollsPerTurn', 'maxSameStatusPollsPerVisibleBurst', 'maxToolCallGroupsPerTurn', 'maxToolCallGroupsPerVisibleBurst', 'maxTurnSeconds', 'maxVisibleBurstSeconds', 'oneMutationPerBurst', 'targetTurnSeconds']

def validate_policy(policy):
    if not isinstance(policy, dict):
        return ['policy must be an object']
    errors = []
    for key, value in EXPECTED.items():
        actual = policy.get(key)
        if type(actual) is not type(value) or actual != value:
            errors.append('invalid policy field: ' + key)
    for key in REMOVED:
        if key in policy:
            errors.append('obsolete turn cap: ' + key)
    return errors
