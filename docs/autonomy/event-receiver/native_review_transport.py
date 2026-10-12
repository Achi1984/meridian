"""Inert, exact-pin GET transport for native review observation.

Caller supplies existing credentials and independently selected numeric pins.
No token discovery, CLI, event listener, writes or review authority.
"""
from collector import GitHub, need
from native_review_observation import positive_id


class NativeReviewGitHub(GitHub):
    """Reuse bounded fixed-host GET machinery; expose only four exact paths.

    Pair with observe_native_review(expected_raw, reader). Its complete expected
    scope is validated before reads. These transport pins narrow requests; they
    do not authenticate independently supplied evidence or authorize anything.
    """
    def __init__(self, token, *, pr_number, run_id, review_id):
        need(all(positive_id(value) for value in (pr_number, run_id, review_id)), "TRANSPORT_PINS")
        self._paths = frozenset(("commits/main", "pulls/" + str(pr_number),
                                "actions/runs/" + str(run_id),
                                "pulls/" + str(pr_number) + "/reviews/" + str(review_id)))
        super().__init__(token)

    def _allowed_path(self, path):
        return type(path) is str and path in self._paths

    def job_log(self, job_id):
        # The parent supports log retrieval; this narrower transport does not.
        need(False, "API_PATH")
