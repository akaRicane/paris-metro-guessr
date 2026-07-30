# Paris Métro Guessr

A station is named. Pin it on the map. The closer you land, the more you score.

![no screenshot yet](https://img.shields.io/badge/stack-vanilla%20JS-informational)

## Run it

Needs a server rather than `file://`, because the browser blocks the tile
requests otherwise:

```sh
cd paris-metro-guessr
python3 -m http.server 8000
# open http://localhost:8000
```

## How it plays

- Pick a network (Métro / RER-only / everything), a round count (5 / 10 / 20, or
  **deathmatch**, in standard or burn), and a time limit (no limit / 60s / 30s /
  10s).
- Click the map to drop your pin. Click again to move it.
- **Guess** locks it in and reveals the true location, the great-circle miss
  distance, and the points.
- `Enter` drives the whole loop, so a round is click-map-then-Enter.

Scoring decays exponentially with the miss: `5000 · e^(−km/2.5)`, tuned to Paris
scale. Adjacent métro stations sit roughly 500 m apart, so landing inside 500 m
still pays 4094 of 5000. Best score per setup is kept in `localStorage`, keyed
on the clock too — a 10s run doesn't compete with an untimed one.

**Deathmatch** replaces the round count with a life bar and no end in sight. Each
round costs you the points you *didn't* score — `5000 − score` — so a pin on the
nose is free, a 1 km miss costs 1 648, and a wild one costs the full 5 000. The
score is stations survived, not points banked, and a tie is broken on life left.
It comes in two variants:

| | Life | Drain | Per answer |
| --- | --- | --- | --- |
| **Standard** | 20 000 | — | — |
| **Burn** | 10 000 | 100/second | +1 000 |

Standard is a pure accuracy race: four wild guesses and you're out, while
averaging a 1 km miss gets you about 12 stations and averaging 400 m about 26.

Burn charges rent on thinking time as well. The miss still costs full price, but
answering pays 1 000 back, so a round nets `(5000 − score) + 100·seconds − 1000`
— a fast sharp pin actually heals you, and dithering over a good guess can cost
more than a quick bad one. The bar is capped at its starting value, so the
restore tops you up rather than stockpiling. Burn runs shorter: 400 m in 8 s
costs 570 a round, which is about 17 stations.

The drain is charged off elapsed wall-clock time on every tick, for the same
reason the countdown is — a backgrounded tab must not come back with a fuller bar
than it left with. If the bar empties mid-round you die where you stand: a pin
already on the map is still revealed and still scored for the accuracy stat, but
it can't buy you back off the floor.

**When the clock runs out**, a pin already on the map still counts: running out
of time while you were confident shouldn't score worse than a wild guess. With
nothing placed there's no location to score, so the round is a zero, and those
rounds are excluded from the end-of-game average miss rather than folded in as a
flattering 0 km. The countdown ticks against a wall-clock deadline, not a
decremented variable, so backgrounding the tab doesn't hand back free seconds.

## The map deliberately has no labels

Standard OSM raster tiles print station names directly onto the board, which
hands over the answer. This uses Carto's `voyager_nolabels` basemap — verified
label-free through zoom 17 — so the Seine, the parks, the arterials and the rail
corridors are the only cues. The viewport also resets every round, since a
leftover zoom from the previous reveal would leak where you are.

## Data

`data/stations.js` is generated, not hand-written. Regenerate with:

```sh
python3 build-stations.py
```

It pulls the `emplacement-des-gares-idf-data-generalisee` dataset from
[Île-de-France Mobilités open data](https://data.iledefrance-mobilites.fr)
(no API key needed) and produces 536 stations — 318 serving métro, 218 RER-only.

Two things the source needs untangling for:

- **One row per station-per-line.** Rows are merged on `id_ref_zdc`, the
  interchange a traveller thinks of as a single station, and coordinates are
  averaged. Lines arrive glued into one `res_com` string
  (`"TRAIN L / RER A / METRO 1 / TRAM 2"`), split on `/`, keeping métro and RER.
- **Repeated names, needing opposite fixes.** Gare du Nord and Gare Saint-Lazare
  appear twice as split entrances of one station, so they get merged. Malesherbes
  and Saint-Fargeau are genuinely two unrelated places each — métro Malesherbes
  in Paris and RER D Malesherbes 65 km out in the Essonne — so those get a mode
  suffix instead. Either way no prompt is ambiguous.

Station data is ODbL, © Île-de-France Mobilités. Tiles © CARTO,
© OpenStreetMap contributors.

## Layout

| File | Role |
| --- | --- |
| `js/game.js` | Rules and round state. No DOM, no Leaflet — testable alone. |
| `js/geo.js` | Haversine, scoring curve, formatting. Pure functions. |
| `js/lines.js` | Official IDFM line colours + WCAG-luminance badge contrast. |
| `js/app.js` | Leaflet + DOM wiring. Renders state, forwards input. |
| `build-stations.py` | Regenerates `data/stations.js` from the open data API. |
