import unittest
from spot_confirmation_audit import HOUR,audit


class VenueConfirmation(unittest.TestCase):
    def test_decision_and_future_entry_separate(self):
        perp={n*HOUR:[100,102,98,100] for n in range(-25,5)}
        perp[-HOUR]=[101,105,100,104]
        perp[HOUR]=[110,111,109,110]
        perp[4*HOUR]=[121,122,120,121]
        spot=perp.copy()
        spot[-HOUR]=[100,101,99,100]
        rows,missing=audit(spot,perp,0,5*HOUR)
        self.assertEqual((missing,len(rows),rows[0]['confirmed']),(0,1,False))
        self.assertAlmostEqual(rows[0]['grossPct'],10)
        del spot[-HOUR]
        self.assertEqual(audit(spot,perp,0,5*HOUR),([],1))
