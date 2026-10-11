"""Offline full-envelope binding; caller-supplied evidence never authenticates itself."""
import importlib.util
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent

def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

_binder = _load('exact_comment_binder', HERE / 'review-evidence-binding.py')
_contract = _load('review_evidence_contract', HERE / 'review-evidence-contract.py')


def bind_envelope(observation_raw, expected_raw, required_policy_raw):
    """Use independent original comment/version pins and independently supplied policy.

    Only a fully valid v2 envelope can expose a plannerResponse, including adverse
    verdicts. Full bodies/findings/check commands remain transient in memory.
    """
    def result(decision, reason, response=None, version=None, digest=None, ci=None):
        return {'kind':'UNVERIFIED_REVIEW_ENVELOPE_BINDING', 'decision':decision,
                'reason':reason, 'plannerResponse':response, 'version':version,
                'reviewBinding':{**version,'ci':dict(ci)} if version is not None and ci is not None else None,
                'evidenceSha256':digest, 'authenticated':False,
                'provenanceVerified':False, 'authorized':False, 'dispatchAllowed':False,
                'mergeAllowed':False, 'durable':False}
    try:
        observed, expected = _binder.guard_exact_comment(observation_raw, expected_raw)
        if expected['issueNumber'] != 571:
            raise ValueError('MAILBOX_PIN_REQUIRED')
        checked = _contract.validate_envelope(observed['comment']['body'],
            json.dumps(expected['scope'], separators=(',', ':')), required_policy_raw)
        scope = expected['scope']
        response = {key:scope[key] for key in ('repository','requestId','opId','headSha','baseSha')}
        response.update(reviewCommentId=observed['comment']['id'], reviewAuthor='CLAUDE',
                        verdict=checked['verdict'])
        green = checked['verdict'] == 'GREEN_LIGHT'
        return result('CANDIDATE_REVIEW' if green else 'BLOCKED',
                      'COMPLETE_ENVELOPE_BOUND_UNVERIFIED' if green else 'NON_GREEN_REVIEW',
                      response, dict(expected['version']), checked['evidenceSha256'], scope['ci'])
    except (ValueError, TypeError, UnicodeError, RecursionError, KeyError) as error:
        code = str(error)
        return result('BLOCKED', code if re.fullmatch(r'[A-Z][A-Z_]{2,79}', code) else 'ENVELOPE_BINDING_INVALID')
