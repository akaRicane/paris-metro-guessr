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
  **deathmatch**, in standard or burn), a difficulty, and a time limit (no limit
  / 60s / 30s / 10s).
- Click the map to drop your pin. Click again to move it.
- **Guess** locks it in and reveals the true location, the great-circle miss
  distance, the points, and the lines that serve the station drawn on the map.
- `Enter` drives the whole loop, so a round is click-map-then-Enter.

Scoring decays exponentially with the miss: `5000 · e^(−km/2.5)`, tuned to Paris
scale. Adjacent métro stations sit roughly 500 m apart, so landing inside 500 m
still pays 4094 of 5000. Best score per setup is kept in `localStorage`, keyed
on the clock too — a 10s run doesn't compete with an untimed one.

**The network is drawn on the reveal** — the real track geometry of every line
serving the station, in the official colours, under the pins and the miss line.
It costs nothing, since the round is already scored, and it's where the game
stops being a quiz and starts teaching you the map.

**Easy** puts that network on the board *while* you guess: the whole pool, thin
and half-transparent. You still have to know which station on line 4 you're being
asked for, but you no longer have to remember where line 4 runs. The backdrop
follows the pool, so a métro game doesn't sketch the RER out to Melun. Easy runs
keep their own best-score record — a hint on the board isn't the same game.

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

## English and French

The interface is bilingual, switched by the `EN | FR` toggle in the corner of the
start card. The choice is remembered in `localStorage` and, on a first visit,
guessed from the browser's language. It is not part of the game setup, so it does
*not* split your best scores: a record set in English is the same record in
French.

Station and line names are never translated — they are French proper nouns in
both languages, and they are the answer to the game.

All copy lives in `js/i18n.js`, keyed (`hud.round`, `rating.bangOn`). The rules
layer holds keys rather than sentences: `ratingFor()` returns `rating.solid`, not
`"Solid"`, so `geo.js` and `game.js` stay free of any language. `t()` resolves a
key, falls back to English, and picks between `.one` and `.other` on a `count` —
French keeps the singular through zero (`0 station`, `2 stations`). Numbers and
distances go through the locale, so `20,000` becomes `20 000` and `1.45 km`
becomes `1,45 km`. Static markup carries `data-i18n="key"` and is overwritten on
load; the English in `index.html` is the no-JS fallback.

## The map deliberately has no labels

Standard OSM raster tiles print station names directly onto the board, which
hands over the answer. This uses Carto's `voyager_nolabels` basemap — verified
label-free through zoom 17 — so the Seine, the parks, the arterials and the rail
corridors are the only cues. The viewport also resets every round, since a
leftover zoom from the previous reveal would leak where you are.

**Preview basemaps** on the start screen opens a sandbox for vetting the
alternatives: pan and zoom freely — past the game's z17 ceiling, which the zoom
readout flags — and drop a sample reveal to check the pins and the name label
stay legible. Four styles survived the check:

| Style | Notes |
| --- | --- |
| Carto `voyager_nolabels` | What the game plays on. Colour, so the city is readable. |
| Carto `light_nolabels` | Near-white; the Seine barely registers. |
| Carto `dark_nolabels` | Positron inverted. Low contrast. |
| Esri World Imagery | Satellite. No cartography at all. |

`nolabels` in a slug is not proof — Esri's Canvas Light/Dark Gray read like
obvious candidates and print park and district names straight into the tiles, so
they're out. Stadia's Stamen styles return 401 without an API key. The preview is
a preview: rounds are always served voyager, and each provider gets its own
`L.tileLayer` rather than a `setUrl` swap, so the attribution in the corner
always credits whoever actually drew the tiles.

## Data

`data/stations.js` and `data/lines.js` are generated, not hand-written.
Regenerate with:

```sh
python3 build-stations.py
python3 build-lines.py
```

Both pull from [Île-de-France Mobilités open data](https://data.iledefrance-mobilites.fr)
(no API key needed). `build-stations.py` produces 536 stations — 318 serving
métro, 218 RER-only — from `emplacement-des-gares-idf-data-generalisee`. Two
things that source needs untangling for:

- **One row per station-per-line.** Rows are merged on `id_ref_zdc`, the
  interchange a traveller thinks of as a single station, and coordinates are
  averaged. Lines arrive glued into one `res_com` string
  (`"TRAIN L / RER A / METRO 1 / TRAM 2"`), split on `/`, keeping métro and RER.
- **Repeated names, needing opposite fixes.** Gare du Nord and Gare Saint-Lazare
  appear twice as split entrances of one station, so they get merged. Malesherbes
  and Saint-Fargeau are genuinely two unrelated places each — métro Malesherbes
  in Paris and RER D Malesherbes 65 km out in the Essonne — so those get a mode
  suffix instead. Either way no prompt is ambiguous.

`build-lines.py` produces 660 track segments across all 21 lines from
`traces-du-reseau-ferre-idf`, tagged with the same `res_com` convention so the
labels drop straight into the existing colour table. The raw traces follow the
tunnels curve by curve — 17 000 coordinates, 370 kB — which is a lot of file for
detail nobody can see, so they're simplified with Douglas-Peucker at roughly 11 m.
That is under what a 2.5 px stroke can show at the game's maximum zoom, and it
costs 82% of the coordinates: **82 kB** for the whole network.

There is no free transit *basemap* to lean on instead — OpenRailwayMap's tiles
403, Thunderforest Transport wants an API key — and drawing it ourselves is the
better answer anyway: no labels to leak, and the lines come out in the same
official colours as the badges.

Station data is ODbL, © Île-de-France Mobilités. Tiles © CARTO,
© OpenStreetMap contributors.

## Layout

| File | Role |
| --- | --- |
| `js/game.js` | Rules and round state. No DOM, no Leaflet — testable alone. |
| `js/geo.js` | Haversine, scoring curve, formatting. Pure functions. |
| `js/i18n.js` | English and French copy, plus `t()` and locale number formatting. |
| `js/lines.js` | Official IDFM line colours + WCAG-luminance badge contrast. |
| `js/app.js` | Leaflet + DOM wiring. Renders state, forwards input. |
| `build-stations.py` | Regenerates `data/stations.js` from the open data API. |
| `build-lines.py` | Regenerates `data/lines.js` — track geometry, simplified. |
