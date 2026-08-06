# 0 A.D. Army Frontier

This is a small browser prototype inspired by [Mario meets Pareto](https://www.mayerowitz.io/blog/mario-meets-pareto). It compares legal 0 A.D. army compositions and removes choices that are dominated on two selected dimensions.

## Run it

From this directory:

```sh
python3 -m http.server 8000
```

Open <http://127.0.0.1:8000/>.

The app is plain HTML, CSS, and JavaScript. It has no package-install step.

## Refresh the game snapshot

The checked-in snapshot was extracted from the official 0 A.D. source checkout at the commit recorded in `data/units.json`.

```sh
python3 scripts/extract_units.py \
  --source /path/to/0ad \
  --out data/units.json
```

The extractor resolves the XML parent chain used by the game. It keeps baseline (`*_b.xml`) non-hero, non-siege soldier templates for the playable civilisations. Each unit keeps its source template path and source-defined `Identity/Icon` path.

## What the prototype does

- Selects a civilisation and up to six unit types.
- Fixes the army population exactly, from 8 to 120.
- Marks Champion and Non-champion units from the source template classes.
- Uses official 0 A.D. resource icons in budgets and cost summaries.
- Applies food, wood, stone, and metal ceilings.
- Enumerates every composition in the checked unit pool.
- Shows a two-dimensional Pareto frontier.
- Ranks frontier points with player weights for raw damage per second, health, range, and speed.
- Shows the source commit and the scope of the snapshot.

## Model boundary

The displayed damage per second is raw template damage divided by the attack repeat time. The prototype does not yet simulate target armour, counter bonuses, formations, terrain, technologies, civilisation bonuses, production buildings, build time, resource gathering, or player micro. A result is therefore a transparent comparison tool, not a claim about the winner of a real battle.

The current search is exhaustive only over the checked pool when it stays below the 400,000-composition browser cap. The six-unit limit keeps the choice set visible. A lower-bound pruning step avoids exploring branches that cannot meet the resource ceilings. Resource ceilings are stock constraints, not a build-order simulation.

## Checks

```sh
node --check app.js
python3 -m unittest discover -s tests -v
```

## Sources

- [0 A.D. official site](https://play0ad.com/)
- [0 A.D. official source repository](https://gitea.wildfiregames.com/0ad/0ad)
- [Mario meets Pareto](https://www.mayerowitz.io/blog/mario-meets-pareto)

## Portrait attribution

The unit portraits in `assets/portraits/units/` come from the official 0 A.D. art data at the snapshot commit recorded in `data/units.json`. The checked-in files are resized 96px display copies. The art is Copyright Wildfire Games and is distributed under the [Creative Commons Attribution-ShareAlike 3.0 license](https://creativecommons.org/licenses/by-sa/3.0/), as described by the [0 A.D. art license](https://gitea.wildfiregames.com/0ad/0ad/src/commit/d6bdf51d8360cd1aadc0491c433d538fc5d77f91/binaries/data/mods/public/art/LICENSE.txt).
