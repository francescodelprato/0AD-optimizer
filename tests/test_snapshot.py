import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads((ROOT / "data/units.json").read_text(encoding="utf-8"))

    def test_snapshot_has_source_and_units(self):
        self.assertEqual(self.snapshot["game"], "0 A.D.")
        self.assertRegex(self.snapshot["source"]["commit"], r"^[0-9a-f]{12,}$")
        self.assertGreaterEqual(len(self.snapshot["units"]), 100)

    def test_every_playable_civilisation_has_a_choice_set(self):
        units_by_civ = {civ: 0 for civ in self.snapshot["civilisations"]}
        for unit in self.snapshot["units"]:
            units_by_civ[unit["civ"]] += 1
        self.assertTrue(all(count >= 4 for count in units_by_civ.values()), units_by_civ)

    def test_unit_metrics_are_positive_and_resources_are_known(self):
        resources = set(self.snapshot["resources"])
        for unit in self.snapshot["units"]:
            with self.subTest(unit=unit["id"]):
                self.assertTrue(unit["name"])
                self.assertGreater(unit["attack_dps"], 0)
                self.assertGreater(unit["health"], 0)
                self.assertGreater(unit["population"], 0)
                self.assertTrue(set(unit["cost"]).issubset(resources))
                self.assertTrue(unit["source_path"].endswith(".xml"))

    def test_units_have_source_defined_portraits(self):
        for unit in self.snapshot["units"]:
            with self.subTest(unit=unit["id"]):
                self.assertRegex(unit["portrait"], r"^units/.+\.png$")
                self.assertTrue((ROOT / "assets" / "portraits" / unit["portrait"]).is_file())

    def test_population_control_supports_large_armies(self):
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="population" type="range" min="8" max="120"', index)
        self.assertIn('id="population-input" type="number" min="8" max="120"', index)

    def test_resource_icons_are_available(self):
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        for resource in ("food", "wood", "stone", "metal"):
            with self.subTest(resource=resource):
                self.assertIn(f'assets/resources/{resource}.png', index)
                self.assertIn(f'assets/resources/{resource}.png', app)
                self.assertTrue((ROOT / "assets" / "resources" / f"{resource}.png").is_file())

    def test_unit_tier_labels_are_rendered(self):
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('return unitIsChampion(unit) ? "Champion" : "Non-champion"', app)


if __name__ == "__main__":
    unittest.main()
