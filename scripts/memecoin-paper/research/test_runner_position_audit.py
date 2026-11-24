import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from runner_limit_audit import audit


class PositionAttributionTest(unittest.TestCase):
    def test_overlapping_positions_do_not_share_exit(self):
        base = dict(mint='mint', tokensRaw=10)
        rows = [dict(base,event='botBuy',at=1,positionId='a',usdcRaw=20000000),
                dict(base,event='botBuy',at=2,positionId='b',usdcRaw=20000000),
                dict(base,event='botSell',at=3,positionId='b',usdcRaw=15000000),
                dict(base,event='botSell',at=4,positionId='a',usdcRaw=22000000)]
        with TemporaryDirectory() as directory:
            path = Path(directory)/'test.zip'
            with ZipFile(path,'w') as archive:
                archive.writestr('session/events.jsonl','\n'.join(map(json.dumps,rows)))
            self.assertEqual(audit([path])['accountExitNetUsdc'][.03], [1.9,-5.1])
