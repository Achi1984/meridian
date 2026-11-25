import unittest
from roundtrip_veto_attribution import attribute


class AttributionTests(unittest.TestCase):
    def test_rejected_winners_losers_boundary_missing_and_open(self):
        rows=[]
        for i,(resale,sale) in enumerate([(19000000,18000000),(19000000,21000000),
                                          (19500000,21000000),(None,22000000),(19000000,None)]):
            fill=dict(account='C',positionId=str(i),qty=10)
            rows.append(dict(initialResaleRaw=resale,fills=[dict(fill,side='buy',usdcRaw=20000000)]))
            if sale is not None:
                rows.append(dict(fills=[dict(fill,side='sell',usdcRaw=sale)]))
        r=attribute(rows)
        self.assertEqual((r['missedWins'],r['avoidedLosses'],r['vetoedOpen'],r['missingEntryQuoteClosed']),(1,1,1,1))
        self.assertEqual(r['closedVetoImpactUsdc'],1.2)
