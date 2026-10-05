import re

ROLES={"CHATGPT","CLAUDE"}
STATUSES={"HELD","RELEASED"}
SHA40=re.compile(r"^[a-f0-9]{40}$")


def validate_lead_lease(lease, reviewer_cross_model=None):
    errors=[]
    def req(cond,msg):
        if not cond:
            errors.append(msg)

    status=lease.get("status")
    lead=lease.get("lead")
    sub=lease.get("subAgent")
    acquired=lease.get("acquiredAtMainSha")
    released=lease.get("releasedAtMainSha")
    next_lead=lease.get("nextLead")

    req(status in STATUSES,"lead lease status must be HELD or RELEASED")
    req(lead in ROLES,"lead lease lead must be CHATGPT or CLAUDE")
    req(sub in ROLES,"lead lease subAgent must be CHATGPT or CLAUDE")
    req(lead!=sub,"lead lease lead and subAgent must differ")
    req(lease.get("subAgentMayPushMain") is False,"subAgentMayPushMain must remain false")
    req(lease.get("subAgentMayMerge") is False,"subAgentMayMerge must remain false")

    if reviewer_cross_model is not None:
        req(reviewer_cross_model==sub,"cross-model reviewer must match lead lease subAgent")

    if status=="HELD":
        req(isinstance(acquired,str) and SHA40.fullmatch(acquired) is not None,
            "HELD lease acquiredAtMainSha must be a 40-hex SHA")
        req(released is None,"HELD lease releasedAtMainSha must be null")
        req(next_lead is None,"HELD lease nextLead must be null")
    elif status=="RELEASED":
        req(isinstance(released,str) and SHA40.fullmatch(released) is not None,
            "RELEASED lease releasedAtMainSha must be a 40-hex SHA")
        req(next_lead in ROLES,"RELEASED lease nextLead must be CHATGPT or CLAUDE")

    return errors
