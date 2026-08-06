#!/usr/bin/env python3
"""Extract a small, auditable unit snapshot from a 0 A.D. source checkout.

This is intentionally not a complete 0 A.D. XML loader. It resolves the
template inheritance and operations needed by the unit-composition prototype.
The output records the source commit/path so that the numbers shown by the app
can be refreshed and audited.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable


RESOURCES = ("food", "wood", "stone", "metal")
DAMAGE_TYPES = ("Hack", "Pierce", "Crush", "Poison")
DEFAULT_CIVS = (
    "achae", "athen", "brit", "cart", "gaul", "germ", "han", "iber",
    "kush", "mace", "maur", "ptol", "rome", "sele", "spart",
)


class TemplateError(RuntimeError):
    """Raised when a source template cannot be resolved."""


class TemplateResolver:
    def __init__(self, templates_root: Path):
        self.templates_root = templates_root
        self.cache: dict[str, ET.Element] = {}

    def _candidate_paths(self, name: str) -> Iterable[Path]:
        clean_name = name.removesuffix(".xml")
        yield self.templates_root / f"{clean_name}.xml"
        yield self.templates_root / "mixins" / f"{clean_name}.xml"

    def _read(self, name: str) -> ET.Element:
        clean_name = name.removesuffix(".xml")
        if clean_name in self.cache:
            return copy.deepcopy(self.cache[clean_name])
        for path in self._candidate_paths(clean_name):
            if path.exists():
                try:
                    root = ET.parse(path).getroot()
                except ET.ParseError as exc:
                    raise TemplateError(f"Could not parse {path}: {exc}") from exc
                self.cache[clean_name] = root
                return copy.deepcopy(root)
        raise TemplateError(f"Could not resolve template '{name}'")

    @staticmethod
    def _child_index(parent: ET.Element, tag: str) -> ET.Element | None:
        return next((child for child in parent if child.tag == tag), None)

    @classmethod
    def _merge(cls, base: ET.Element, overlay: ET.Element) -> ET.Element:
        """Merge overlay into base using the subset of XML ops used here."""
        if overlay.attrib.get("replace") is not None:
            return copy.deepcopy(overlay)

        if overlay.attrib.get("op") in {"add", "mul"} and len(overlay) == 0:
            old = float(base.text or "0")
            new = float(overlay.text or "0")
            value = old + new if overlay.attrib["op"] == "add" else old * new
            base.text = f"{value:g}"
            return base

        if len(overlay) == 0:
            base.text = overlay.text
            return base

        for overlay_child in overlay:
            base_child = cls._child_index(base, overlay_child.tag)
            if base_child is None:
                base.append(copy.deepcopy(overlay_child))
            else:
                merged = cls._merge(base_child, overlay_child)
                if merged is not base_child:
                    index = list(base).index(base_child)
                    base.remove(base_child)
                    base.insert(index, merged)
        return base

    def resolve(self, name: str) -> ET.Element:
        root = self._read(name)
        merged = ET.Element(root.tag, root.attrib)
        parent_attr = root.attrib.get("parent", "")
        # 0 A.D. lists the most specific parent first. Resolve from the
        # generic template outward so a civilisation mixin can override it.
        for parent in reversed(tuple(filter(None, parent_attr.split("|")))):
            merged = self._merge(merged, self.resolve(parent))
        merged = self._merge(merged, root)
        return merged


def _node(root: ET.Element, path: str) -> ET.Element | None:
    current: ET.Element | None = root
    for part in path.split("/"):
        if current is None:
            return None
        current = next((child for child in current if child.tag == part), None)
    return current


def _text(root: ET.Element, path: str, default: str = "") -> str:
    node = _node(root, path)
    return (node.text or "").strip() if node is not None else default


def _number(root: ET.Element, path: str, default: float = 0.0) -> float:
    value = _text(root, path, "")
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _tokens(value: str) -> list[str]:
    return [token for token in re.split(r"\s+", value.strip()) if token]


def _display_role(classes: list[str]) -> str:
    for role in ("Swordsman", "Spearman", "Javelineer", "Archer", "Slinger", "Pikeman", "Maceman"):
        if role in classes:
            return role
    return "Soldier"


def _attack(root: ET.Element) -> dict[str, float | str]:
    attack = _node(root, "Attack")
    if attack is None:
        return {"type": "", "damage": 0.0, "repeat_time_ms": 0.0, "range": 0.0, "dps": 0.0}
    candidates = [
        child for child in attack
        if child.tag in {"Melee", "Ranged"} and _node(child, "RepeatTime") is not None
    ]
    if not candidates:
        return {"type": "", "damage": 0.0, "repeat_time_ms": 0.0, "range": 0.0, "dps": 0.0}
    chosen = next((child for child in candidates if child.tag == "Ranged"), candidates[0])
    damage_node = next((child for child in chosen if child.tag == "Damage"), None)
    damage = 0.0
    if damage_node is not None:
        for damage_type in DAMAGE_TYPES:
            damage_child = next((child for child in damage_node if child.tag == damage_type), None)
            damage += float(damage_child.text or 0) if damage_child is not None else 0.0
    repeat_time_ms = _number(chosen, "RepeatTime")
    return {
        "type": chosen.tag.lower(),
        "damage": damage,
        "repeat_time_ms": repeat_time_ms,
        "range": _number(chosen, "MaxRange"),
        "dps": damage / (repeat_time_ms / 1000) if repeat_time_ms else 0.0,
    }


def _unit_from_template(resolver: TemplateResolver, template_name: str, civ: str) -> dict:
    root = resolver.resolve(template_name)
    identity_classes = _tokens(_text(root, "Identity/Classes"))
    visible_classes = _tokens(_text(root, "Identity/VisibleClasses"))
    attack = _attack(root)
    resources = {resource: _number(root, f"Cost/Resources/{resource}") for resource in RESOURCES}
    resistances = {damage_type.lower(): _number(root, f"Resistance/Entity/Damage/{damage_type}") for damage_type in DAMAGE_TYPES[:3]}
    return {
        "id": template_name,
        "civ": civ,
        "name": _text(root, "Identity/GenericName", template_name.rsplit("/", 1)[-1]),
        "role": _display_role(visible_classes),
        "class_tokens": visible_classes,
        "attack_type": attack["type"],
        "attack_damage": round(float(attack["damage"]), 3),
        "attack_dps": round(float(attack["dps"]), 3),
        "attack_range": round(float(attack["range"]), 3),
        "health": round(_number(root, "Health/Max"), 3),
        "speed": round(_number(root, "UnitMotion/WalkSpeed"), 3),
        "armor": round(sum(resistances.values()), 3),
        "resistances": {key: round(value, 3) for key, value in resistances.items()},
        "population": round(_number(root, "Cost/Population", 1), 3),
        "cost": {resource: round(value, 3) for resource, value in resources.items() if value},
        "rank": _text(root, "Identity/Rank", "Basic"),
        "identity_classes": identity_classes,
    }


def _source_commit(source_root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def extract(source_root: Path, civs: Iterable[str]) -> dict:
    templates_root = source_root / "binaries/data/mods/public/simulation/templates"
    units_root = templates_root / "units"
    if not templates_root.exists():
        raise SystemExit(f"Not a 0 A.D. source checkout: {templates_root} does not exist")

    resolver = TemplateResolver(templates_root)
    units: list[dict] = []
    skipped: list[dict[str, str]] = []
    for civ in civs:
        civ_root = units_root / civ
        if not civ_root.exists():
            skipped.append({"civ": civ, "reason": "missing unit directory"})
            continue
        for path in sorted(civ_root.glob("*_b.xml")):
            template_name = str(path.relative_to(templates_root).with_suffix(""))
            try:
                unit = _unit_from_template(resolver, template_name, civ)
            except TemplateError as exc:
                skipped.append({"template": template_name, "reason": str(exc)})
                continue
            tokens = set(unit["identity_classes"])
            is_soldier = bool(tokens & {"Soldier", "CitizenSoldier", "Champion"})
            if not is_soldier or "Ship" in tokens or "Siege" in tokens:
                continue
            unit["source_path"] = f"binaries/data/mods/public/simulation/templates/{template_name}.xml"
            units.append(unit)

    return {
        "schema_version": 1,
        "game": "0 A.D.",
        "source": {
            "repository": "https://gitea.wildfiregames.com/0ad/0ad",
            "commit": _source_commit(source_root),
            "scope": "Baseline (_b) non-hero, non-siege soldier templates with resolved XML inheritance.",
        },
        "resources": list(RESOURCES),
        "civilisations": list(civs),
        "units": units,
        "skipped": skipped,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Path to a 0 A.D. source checkout")
    parser.add_argument("--out", type=Path, required=True, help="Output JSON path")
    parser.add_argument("--civ", action="append", dest="civs", help="Civilisation code; repeat to restrict")
    args = parser.parse_args()
    snapshot = extract(args.source, args.civs or DEFAULT_CIVS)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(snapshot['units'])} units from {snapshot['source']['commit'][:12]} to {args.out}")
    if snapshot["skipped"]:
        print(f"Skipped {len(snapshot['skipped'])} templates", flush=True)


if __name__ == "__main__":
    main()
