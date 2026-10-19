import copy
import json
import unittest
from unittest.mock import patch

import inspection_history as history


def report(state='queued', unresolved=False):
    attempt = 0 if state in ('queued', 'rejected') else 1
    return {
        'schema': history.SCHEMA, 'profile': history.PROFILE, 'evidenceClass': 'SYNTHETIC_ONLY',
        'trialId': 'a'*64, 'state': state, 'unresolved': unresolved,
        'requiresExplicitReconciliation': unresolved, 'attempts': attempt, 'fence': attempt,
        'fenceInterpretation': 'UNRESOLVED_FENCE_RETAINED' if unresolved else 'NO_UNRESOLVED_FENCE_FOR_THIS_TRIAL',
        'integrity': 'STORED_JOURNAL_VALIDATED_NOT_SOURCE_AUTHENTICITY',
        'timestamps': {'createdAt':'2026-10-19T00:00:00Z',
                       'startedAt': '2026-10-19T00:00:01Z' if state not in ('queued','rejected') else None,
                       'finishedAt': '2026-10-19T00:00:02Z' if state not in ('queued',) and not unresolved else None},
        'identities': {key: ('b'*64 if key not in ('resultSha256','summarySha256') else None)
                       for key in history.IDENTITIES},
        'pathsStarted': 0, 'pathsCompleted': 0, 'reasonCode':None,
        'executionAuthorized':False, 'promotionAuthorized':False,
        'profitabilityInferred':False, 'recoveryPerformed':False,
    }


def append(entries, value, identifier=None):
    entries.append({'observationId':identifier or 'observation-'+str(len(entries)+1),
                    'sequence':len(entries)+1,
                    'previousSha256':history.digest(entries[-1]) if entries else None,
                    'report':value})
    return entries


class HistoryTests(unittest.TestCase):
    def test_actual_inspection_projection_contract(self):
        # Feed the real report projector supplied metadata; no database or engine.
        import inspection_report
        source = report()
        projection = {'profile':history.PROFILE, 'trialId':source['trialId'],
                      'state':'queued','unresolved':False,'attempts':0,'fence':0,
                      'timestamps':source['timestamps'],'paths':[], 'reason':None,
                      'executionAuthorized':False,'promotionAuthorized':False,'profitabilityInferred':False,
                      **source['identities']}
        with patch.object(inspection_report.journal,'inspect_b1',return_value=projection):
            actual = inspection_report.build_report('UNOPENED',source['trialId'])
        self.assertEqual(history.summarize(append([],actual))['state'],'queued')

    def test_unknown_retained_even_with_44_paths(self):
        entries=append([],report())
        pending=report('unknown',True)
        pending.update(pathsStarted=44,pathsCompleted=44)
        append(entries,pending)
        result=history.summarize(entries)
        self.assertEqual(result['guidance'],'EXPLICIT_RECONCILIATION_REQUIRED')
        self.assertEqual((result['state'],result['attempts'],result['fence']),('unknown',1,1))
        self.assertEqual(result['remainingExecutionBudget'],'UNKNOWN')
        for key in ('authenticityEstablished','durableStorageEstablished','completenessCertified','executionAuthorized'):
            self.assertIs(result[key],False)

    def test_identical_duplicate_is_not_new_attempt(self):
        entries=append([],report('unknown',True))
        entries.append(copy.deepcopy(entries[0]))
        result=history.summarize(entries)
        self.assertEqual((result['observationCount'],result['duplicateObservationCount'],result['attempts']),(1,1,1))

    def test_conflicting_duplicate_rejects(self):
        entries=append([],report())
        changed=copy.deepcopy(entries[0]);changed['report']['reasonCode']='ALTERED'
        entries.append(changed)
        with self.assertRaisesRegex(history.HistoryError,'CONFLICTING_OBSERVATION_ID'):
            history.summarize(entries)

    def test_prefix_extension_preserves_history(self):
        old=append([],report());new=copy.deepcopy(old)
        append(new,report('unknown',True))
        self.assertEqual(history.summarize(new,old)['observationCount'],2)
        rewritten=append([],report('rejected'))
        with self.assertRaisesRegex(history.HistoryError,'PREFIX_CHANGED'):
            history.summarize(rewritten,old)
        with self.assertRaisesRegex(history.HistoryError,'PREFIX_CHANGED'):
            history.summarize([],old)

    def test_sequence_predecessor_and_identity_conflicts(self):
        for field,value,code in [('sequence',True,'SEQUENCE'),('previousSha256','f'*64,'PREDECESSOR')]:
            entries=append([],report());entries[0][field]=value
            with self.assertRaisesRegex(history.HistoryError,code):history.summarize(entries)
        entries=append([],report());changed=report('unknown',True)
        changed['identities']['sourceSha256']='c'*64;append(entries,changed)
        with self.assertRaisesRegex(history.HistoryError,'IDENTITY_CONFLICT'):history.summarize(entries)

    def test_terminal_states_preserved_and_rewrites_rejected(self):
        for state in ('rejected','failed','timed_out','partial'):
            entries=append([],report(state))
            self.assertEqual(history.summarize(entries)['state'],state)
            append(entries,report('unknown',True))
            with self.assertRaises(history.HistoryError):history.summarize(entries)

    def test_reconciliation_observation_never_means_resume(self):
        entries=append([],report('unknown',True));append(entries,report('unknown',False))
        result=history.summarize(entries)
        self.assertEqual(result['guidance'],'TERMINAL_NO_RETRY')
        self.assertFalse(result['recoveryPerformed'])
        append(entries,report('unknown',True))
        with self.assertRaisesRegex(history.HistoryError,'TERMINAL_REWRITE'):history.summarize(entries)

    def test_attempt_fence_and_progress_regression(self):
        for field,value in [('attempts',2),('attempts',True),('fence',True),('fence',-1),('pathsStarted',True)]:
            data=report('unknown',True);data[field]=value
            with self.assertRaises(history.HistoryError):history.summarize(append([],data))
        entries=append([],report('unknown',True));changed=report('unknown',True);changed['fence']=2
        append(entries,changed)
        with self.assertRaisesRegex(history.HistoryError,'FENCE_CONFLICT'):history.summarize(entries)
        first=report('unknown',True);first.update(pathsStarted=1)
        entries=append([],first);append(entries,report('unknown',True))
        with self.assertRaisesRegex(history.HistoryError,'PROGRESS_REGRESSION'):history.summarize(entries)

    def test_completed_requires_all_evidence(self):
        complete=report('completed')
        with self.assertRaisesRegex(history.HistoryError,'COMPLETION_EVIDENCE'):
            history.summarize(append([],complete))
        complete.update(pathsStarted=44,pathsCompleted=44)
        complete['identities'].update(resultSha256='c'*64,summarySha256='d'*64)
        entries=append([],complete)
        self.assertEqual(history.summarize(entries)['guidance'],'TERMINAL_NO_RETRY')
        append(entries,copy.deepcopy(complete))
        self.assertEqual(history.summarize(entries)['observationCount'],2)

    def test_authority_malformed_and_graph_reject(self):
        for field in ('executionAuthorized','promotionAuthorized','recoveryPerformed','profitabilityInferred'):
            data=report();data[field]=True
            with self.assertRaisesRegex(history.HistoryError,'AUTHORITY'):history.summarize(append([],data))
        data=report();data['identities']['dataSha256']='wrong'
        with self.assertRaises(history.HistoryError):history.summarize(append([],data))
        cyc=[];cyc.append(cyc)
        with self.assertRaises(history.HistoryError):history.summarize(cyc)
        data=report();data['unknown']='extra'
        with self.assertRaisesRegex(history.HistoryError,'REPORT_SCHEMA'):history.summarize(append([],data))

    def test_all_bounds_and_no_input_mutation(self):
        entries=append([],report());before=copy.deepcopy(entries)
        result=history.summarize(entries)
        self.assertEqual(entries,before)
        self.assertLessEqual(len(history.wire(result)),history.MAX_SUMMARY_BYTES)
        with self.assertRaisesRegex(history.HistoryError,'OBSERVATION_COUNT'):
            history.summarize([entries[0]]*257)
        with patch.object(history,'MAX_OBSERVATION_BYTES',100):
            with self.assertRaises(history.HistoryError):history.summarize(entries)
        with patch.object(history,'MAX_INPUT_BYTES',100):
            with self.assertRaises(history.HistoryError):history.summarize(entries)
        with patch.object(history,'MAX_INPUT_BYTES',len(history.wire(entries[0]))+1):
            with self.assertRaisesRegex(history.HistoryError,'INPUT_BYTES_BOUND'):history.summarize(entries,entries)
        with patch.object(history,'MAX_SUMMARY_BYTES',100):
            with self.assertRaisesRegex(history.HistoryError,'SUMMARY_BOUND'):history.summarize(entries)
        self.assertEqual(history.summarize([])['state'],'NO_OBSERVATIONS')

    def test_exact_encoding_budget_checked_before_full_serialization(self):
        value = {'é\n': ['😀', '\\', '\x00', 'a'], 'n': -12, 'b': False, 'z': None}
        expected = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
        with patch.object(history, 'MAX_OBSERVATION_BYTES', len(expected)):
            self.assertEqual(history.wire(value), expected)
        with patch.object(history, 'MAX_OBSERVATION_BYTES', len(expected)-1), \
             patch.object(history.json, 'dumps', side_effect=AssertionError('full serialization forbidden')):
            with self.assertRaisesRegex(history.HistoryError, 'OBSERVATION_BYTES_BOUND'):
                history.wire(value)
        with patch.object(history, 'MAX_OBSERVATION_BYTES', 64), \
             patch.object(history.json, 'dumps', side_effect=AssertionError('full serialization forbidden')):
            with self.assertRaises(history.HistoryError):
                history.wire(['é'*8]*8)

    def test_calendar_lifecycle_hash_pairs_and_claimed_unknown(self):
        claimed = report('unknown', True)
        claimed['timestamps']['startedAt'] = None
        self.assertTrue(history.summarize(append([], claimed))['unresolved'])
        for state, field, value in [
            ('queued', 'createdAt', None), ('queued', 'createdAt', '2026-02-30T00:00:00Z'),
            ('queued', 'createdAt', '2026-10-19T25:00:00Z'),
            ('rejected', 'finishedAt', None),
            ('failed', 'finishedAt', '2026-10-18T00:00:00Z'),
            ('unknown', 'finishedAt', None),
        ]:
            candidate = report(state)
            candidate['timestamps'][field] = value
            with self.assertRaises(history.HistoryError):history.summarize(append([], candidate))
        complete = report('completed')
        complete.update(pathsStarted=44, pathsCompleted=44)
        complete['identities'].update(resultSha256='c'*64, summarySha256='d'*64)
        for field in ('startedAt', 'finishedAt'):
            candidate = copy.deepcopy(complete);candidate['timestamps'][field] = None
            with self.assertRaises(history.HistoryError):history.summarize(append([], candidate))
        candidate = report('failed');candidate['identities']['summarySha256'] = 'c'*64
        with self.assertRaisesRegex(history.HistoryError, 'RESULT_HASH_PAIR'):
            history.summarize(append([], candidate))
        self.assertEqual(history.summarize(append([], report('rejected')))['state'], 'rejected')

    def test_claimed_failure_without_start_requires_zero_paths_and_finish(self):
        for state in ('failed', 'timed_out', 'partial'):
            candidate = report(state)
            candidate['timestamps']['startedAt'] = None
            self.assertEqual(history.summarize(append([], candidate))['state'], state)
            candidate['pathsStarted'] = 1
            with self.assertRaisesRegex(history.HistoryError, 'TIMESTAMP_STATE'):
                history.summarize(append([], candidate))
            candidate['pathsStarted'] = 0
            candidate['timestamps']['finishedAt'] = None
            with self.assertRaisesRegex(history.HistoryError, 'TIMESTAMP_STATE'):
                history.summarize(append([], candidate))

    def test_repeat_calls_deterministic_without_io(self):
        import builtins,subprocess,socket
        entries=append([],report())
        with patch.object(builtins,'open',side_effect=AssertionError('file')), \
             patch.object(subprocess,'Popen',side_effect=AssertionError('process')), \
             patch.object(socket,'socket',side_effect=AssertionError('network')):
            self.assertEqual(history.summarize(entries),history.summarize(entries))

if __name__=='__main__':unittest.main()
