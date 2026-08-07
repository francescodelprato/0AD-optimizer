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
        self.assertGreaterEqual(len(self.snapshot["units"]), 150)

    def test_snapshot_includes_champion_units(self):
        champions = [unit for unit in self.snapshot["units"] if "Champion" in unit["class_tokens"]]
        self.assertGreaterEqual(len(champions), 60)
        champions_by_civ = {civ: 0 for civ in self.snapshot["civilisations"]}
        for unit in champions:
            champions_by_civ[unit["civ"]] += 1
        self.assertTrue(all(count > 0 for count in champions_by_civ.values()), champions_by_civ)

    def test_units_have_phase_requirements(self):
        phases = {unit["phase"] for unit in self.snapshot["units"]}
        self.assertEqual(phases, {"village", "town", "city"})
        for unit in self.snapshot["units"]:
            with self.subTest(unit=unit["id"]):
                self.assertIsInstance(unit["requirements"], list)
                self.assertIn(unit["phase"], {"village", "town", "city"})

    def test_snapshot_has_no_identical_choices_within_a_civilisation(self):
        signatures = []
        for unit in self.snapshot["units"]:
            comparable = {
                key: value
                for key, value in unit.items()
                if key not in {"id", "portrait", "source_path"}
            }
            signatures.append(json.dumps(comparable, sort_keys=True))
        self.assertEqual(len(signatures), len(set(signatures)))

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

    def test_era_and_resource_modes_are_rendered(self):
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="era"', index)
        self.assertIn('value="village"', index)
        self.assertIn('value="town"', index)
        self.assertIn('value="city"', index)
        self.assertIn('id="constraint-mode"', index)
        self.assertIn('value="explore"', index)
        self.assertIn('value="affordability"', index)
        self.assertIn('id="affordability-controls"', index)
        self.assertIn("unitAllowedByEra", app)
        self.assertIn("resourcePressureFor", app)
        self.assertIn("dpsPerPressure", app)
        self.assertIn("healthPerPressure", app)

    def test_exploration_mode_does_not_require_resource_caps(self):
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('constraintMode: "explore"', app)
        self.assertIn("const enforceBudgets = isAffordabilityMode();", app)
        self.assertIn("if (!enforceBudgets) return true;", app)
        self.assertIn('id="feasible-label"', (ROOT / "index.html").read_text(encoding="utf-8"))

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
        self.assertIn('`${count}× ${units[index].name} (${unitTierLabel(units[index])})`', app)


if __name__ == "__main__":
    unittest.main()
