#!/usr/bin/env python3
"""Build stations.js from Ile-de-France Mobilites open data.

Source: https://data.iledefrance-mobilites.fr - dataset
"emplacement-des-gares-idf-data-generalisee" (999 rows, no API key required).

One source row exists per station-per-line, so rows are merged on the
station's ZDC id (id_ref_zdc) - the "zone de correspondance", i.e. the
interchange a traveller thinks of as one station. Coordinates of merged
rows are averaged.

Run:  python3 build-stations.py
"""

import json
import math
import re
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

API = "https://data.iledefrance-mobilites.fr/api/explore/v2.1"
DATASET = "emplacement-des-gares-idf-data-generalisee"
PAGE = 100

# res_com packs every line serving the station into one string, joined by " / ":
#   "TRAIN L / TRAIN U / RER A / RER E / METRO 1 / TRAM 2"
# We keep the METRO and RER tokens and drop train/tram/cable/VAL.
KEEP_PREFIX = ("METRO", "RER")


def fetch_all():
    rows, offset = [], 0
    while True:
        qs = urllib.parse.urlencode(
            {
                "limit": PAGE,
                "offset": offset,
                "select": "nom_long,nom_zdc,id_ref_zdc,res_com,mode,metro,rer,geo_point_2d",
                "where": "metro = 1 or rer = 1",
            }
        )
        with urllib.request.urlopen(f"{API}/catalog/datasets/{DATASET}/records?{qs}") as r:
            page = json.load(r)
        rows.extend(page["results"])
        total = page["total_count"]
        offset += PAGE
        if offset >= total:
            print(f"fetched {len(rows)}/{total} source rows")
            return rows


def parse_lines(res_com):
    """'RER A / METRO 1 / TRAM 2' -> [('rer','A'), ('metro','1')]."""
    out = []
    for token in (res_com or "").split("/"):
        parts = token.strip().split()
        if len(parts) < 2 or parts[0].upper() not in KEEP_PREFIX:
            continue  # tram, train, CDGVAL, ORLYVAL, cable
        kind = parts[0].lower()
        label = " ".join(parts[1:])
        if (kind, label) not in out:
            out.append((kind, label))
    return out


def line_sort_key(label):
    """Order metro lines 1, 2, 3, 3bis, 4 ... 14 rather than lexicographically."""
    m = re.match(r"(\d+)(.*)", label)
    return (int(m.group(1)), m.group(2)) if m else (99, label)


def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def resolve_duplicates(stations):
    """A repeated name is unfair in a guessing game: the prompt is ambiguous.

    Two causes exist in the source, needing opposite fixes. Some are one station
    split across ZDC ids (Gare du Nord's RER E entrance sits 180 m from the rest)
    - those get merged. Others are unrelated places that happen to share a name
    (metro Malesherbes in Paris vs RER D Malesherbes, 65 km out in the Essonne)
    - those get a mode suffix so each prompt names exactly one place.
    """
    by_name = defaultdict(list)
    for s in stations:
        by_name[s["name"]].append(s)

    out = []
    for name, group in by_name.items():
        if len(group) == 1:
            out.append(group[0])
            continue

        if max(haversine_km(a, b) for a in group for b in group) < 1.0:
            merged = dict(group[0])
            merged["lat"] = round(sum(s["lat"] for s in group) / len(group), 6)
            merged["lon"] = round(sum(s["lon"] for s in group) / len(group), 6)
            merged["metro"] = sorted({l for s in group for l in s["metro"]}, key=line_sort_key)
            merged["rer"] = sorted({l for s in group for l in s["rer"]})
            out.append(merged)
            print(f"  merged {len(group)}x '{name}' (same station, split ids)")
            continue

        for s in group:
            lines = s["metro"] or s["rer"]
            kind = "Métro" if s["metro"] else "RER"
            s["name"] = f"{name} ({kind} {'/'.join(lines)})"
            out.append(s)
        print(f"  disambiguated {len(group)}x '{name}' (distinct places)")

    out.sort(key=lambda s: s["name"])
    return out


def build():
    groups = defaultdict(list)
    for row in fetch_all():
        key = row.get("id_ref_zdc") or row.get("nom_zdc") or row.get("nom_long")
        groups[key].append(row)

    stations = []
    for key, rows in groups.items():
        lines = []
        for row in rows:
            for label in parse_lines(row.get("res_com")):
                if label not in lines:
                    lines.append(label)
        if not lines:
            continue  # tram/train-only interchange that matched on a flag quirk

        pts = [r["geo_point_2d"] for r in rows if r.get("geo_point_2d")]
        if not pts:
            continue

        # nom_zdc is the interchange name ("Chatelet - Les Halles"); nom_long is
        # the per-line name. Prefer nom_zdc, except where the source has glued two
        # unrelated places together with a slash ("Assemblee Nationale / Lille -
        # Universite"), which would make a nonsense prompt.
        zdc, long = rows[0].get("nom_zdc"), rows[0].get("nom_long")
        name = long if (zdc and "/" in zdc and long) else (zdc or long)

        stations.append(
            {
                "id": key,
                "name": name.strip(),
                "lat": round(sum(p["lat"] for p in pts) / len(pts), 6),
                "lon": round(sum(p["lon"] for p in pts) / len(pts), 6),
                "metro": sorted((l for k, l in lines if k == "metro"), key=line_sort_key),
                "rer": sorted(l for k, l in lines if k == "rer"),
            }
        )

    return resolve_duplicates(stations)


def main():
    stations = build()
    metro = [s for s in stations if s["metro"]]
    rer = [s for s in stations if s["rer"] and not s["metro"]]
    print(f"{len(stations)} stations: {len(metro)} serving metro, {len(rer)} RER-only")

    out = Path(__file__).parent / "data" / "stations.js"
    payload = json.dumps(stations, ensure_ascii=False, separators=(",", ":"))
    out.write_text(
        "// Generated by build-stations.py - do not edit by hand.\n"
        "// Source: Ile-de-France Mobilites open data (ODbL).\n"
        f"window.STATIONS = {payload};\n",
        encoding="utf-8",
    )
    print(f"wrote {out} ({out.stat().st_size / 1024:.1f} kB)")


if __name__ == "__main__":
    main()
