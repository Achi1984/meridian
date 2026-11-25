import unittest
from unittest.mock import patch
from prospective_taker_flow import HOUR, close, volume_shares


class ProspectiveTests(unittest.TestCase):
    def test_unclosed_and_duplicate_hours_rejected(self):
        row=[0,0,0,0,0,0,HOUR*1000-1,'20',0,0,'5']
        self.assertEqual(volume_shares([row],HOUR),{0:.25})
        for rows,slot in [([row],0),([row,row],HOUR)]:
            with self.assertRaises(ValueError):
                volume_shares(rows,slot)

    def test_paired_cash_and_unknown_are_distinct(self):
        for decision in [True,False,None]:
            row=dict(slot=0,instrument='BTC-USDT-SWAP',side=-1,entry=dict(price='100',qty='1'),
                     exit=dict(price='99'))
            if decision is not None:
                row['flow']=dict(passed=decision)
            with patch('prospective_taker_flow.settle',return_value=0):
                close(row)
            self.assertEqual(row['baselineNetUsdt'],'0.9005')
            self.assertEqual(row.get('filteredNetUsdt'),{True:'0.9005',False:'0',None:None}[decision])
