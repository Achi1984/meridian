import unittest
from datetime import timedelta
from strategy_cadence_audit import at, classify, expected


class CadenceTests(unittest.TestCase):
    def test_intervals_in_full_day(self):
        start = at("2026-11-28T19:30:00Z")
        end = start + timedelta(days=1)
        for name, count in [("okx-fib-demo",96),("btc-compound-paper",24),("okx-rejection-paper",6)]:
            self.assertEqual(len(list(expected(name,start,end))), count)

    def test_does_not_credit_a_manual_success_or_double_count_a_slot(self):
        slots = [at("2026-11-28T19:03:00Z"),at("2026-11-28T19:18:00Z")]
        def run(n,event,minute):
            ts=f"2026-11-28T19:{minute:02d}:00Z"
            return dict(id=n,event=event,created_at=ts,run_started_at=ts,conclusion="success",status="completed")
        result=classify(slots,[run(1,"schedule",4),run(2,"schedule",5),run(3,"workflow_dispatch",19)])
        self.assertEqual(result["withSuccessfulSchedule"],1)
        self.assertEqual(result["withoutSchedule"],1)
        self.assertEqual(result["otherEvents"],{"workflow_dispatch":1})
