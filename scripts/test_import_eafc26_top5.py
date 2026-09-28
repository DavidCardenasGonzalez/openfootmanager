import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "import_eafc26_top5", Path(__file__).with_name("import-eafc26-top5.py")
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class RuntimeAttributesTests(unittest.TestCase):
    def test_goalkeeper_uses_goalkeeping_positioning_diving_and_kicking(self):
        attrs = adapter.runtime_attributes({
            "player_positions": "GK", "mentality_positioning": "13",
            "movement_agility": "40", "attacking_short_passing": "60",
            "goalkeeping_positioning": "90", "goalkeeping_diving": "86",
            "goalkeeping_kicking": "86", "goalkeeping_handling": "85",
            "goalkeeping_reflexes": "89",
        })
        self.assertEqual(attrs["positioning"], 90)
        self.assertEqual(attrs["agility"], 86)
        self.assertEqual(attrs["passing"], 86)

    def test_center_back_uses_defensive_positioning_heading_and_reactions(self):
        attrs = adapter.runtime_attributes({
            "player_positions": "CB", "mentality_positioning": "47",
            "defending_marking_awareness": "91", "attacking_heading_accuracy": "88",
            "movement_reactions": "90", "mentality_interceptions": "91",
        })
        self.assertEqual(attrs["positioning"], 91)
        self.assertEqual(attrs["aerial"], 88)
        self.assertEqual(attrs["decisions"], 90)


if __name__ == "__main__":
    unittest.main()
