"""One-shot same-host durable wrapper around the fixed local check catalog."""
import json
from pathlib import Path
import check_executor as executor
import check_journal as journal


def run_check_once(database, repo_root, scope, timeout_seconds=30):
    """Reserve once, persist STARTED, execute once, atomically persist exact receipt.

    Neither errors nor crashes authorize replay. Database must be initialized by
    the trusted caller and live outside the tested checkout.
    """
    root=Path(repo_root).resolve()
    executor.need(not Path(database).resolve().is_relative_to(root),'JOURNAL_INSIDE_CHECKOUT')
    # Freeze caller input before reservation or execution.
    frozen=json.loads(executor.canonical(scope))
    reservation=journal.reserve(database,frozen,executor.CHECK_ID,executor.COMMAND_SHA256)
    active=reservation
    try:
        active=journal.mark_started(database,reservation)
        receipt=executor.execute_check(root,frozen,timeout_seconds)
        settled=journal.complete(database,active,receipt)
        return {'state':'COMPLETE','persistConfirmed':True,'receipt':receipt,**executor.FLAGS}
    except Exception:
        confirmed=False
        try:
            journal.mark_unknown(database,active)
            confirmed=True
        except Exception:
            pass
        return {'state':'UNKNOWN' if confirmed else 'UNSETTLED',
                'persistConfirmed':confirmed,'receipt':None,**executor.FLAGS}


def recover_completed_check(database, scope):
    """Read a verified committed receipt; never execute, reserve, retry or claim."""
    frozen=json.loads(executor.canonical(scope))
    record=journal.recover(database,frozen,executor.CHECK_ID,executor.COMMAND_SHA256)
    executor.need(record['state']=='COMPLETE','CHECK_NOT_COMPLETE')
    return {'state':'COMPLETE','persistConfirmed':True,'receipt':record['receipt'],**executor.FLAGS}
