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

- Pick a network (Métro / RER-only / everything) and a round count.
- Click the map to drop your pin. Click again to move it.
- **Guess** locks it in and reveals the true location, the great-circle miss
  distance, and the points.
- `Enter` drives the whole loop, so a round is click-map-then-Enter.

Scoring decays exponentially with the miss: `5000 · e^(−km/2.5)`, tuned to Paris
scale. Adjacent métro stations sit roughly 500 m apart, so landing inside 500 m
still pays 4094 of 5000. Best score per setup is kept in `localStorage`.

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
