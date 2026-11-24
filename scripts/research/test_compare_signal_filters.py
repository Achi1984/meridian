import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from compare_signal_filters import launches, split_pilots


class PilotSplitTest(unittest.TestCase):
    def test_order_and_repeated_mints(self):
        samples = [(t, t+1, {str(t): t, 'shared': -1}) for t in range(0, 80, 10)]
        with patch('compare_signal_filters.launches', side_effect=samples.__getitem__):
            train, later = split_pilots(reversed(range(8)))
            self.assertEqual(train, [0, -1, 10, 20, 30])
            self.assertEqual(later, [40, 50, 60, 70])

    def test_overlap_including_events_without_a_selected_mint(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for i, (at, observed) in enumerate([(1, 5), (5, 8)]):
                path = Path(tmp) / f'{i}.zip'
                with ZipFile(path, 'w') as z:
                    z.writestr('session/events.jsonl', json.dumps(
                        dict(event='summary', at=at, observedAt=observed)))
                paths.append(path)
            self.assertEqual(launches(paths[0]), (1, 5, {}))
            with self.assertRaisesRegex(ValueError, 'Overlapping'):
                split_pilots(paths)
