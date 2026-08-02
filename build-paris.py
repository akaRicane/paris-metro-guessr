#!/usr/bin/env python3
"""Build paris.js - the Paris city limits, for the intra-muros pool.

Source: https://geo.api.gouv.fr - commune 75056 (Paris), whose contour comes
from IGN Admin Express. One closed ring, and it is the administrative commune,
so the Bois de Boulogne and the Bois de Vincennes are inside it: they are the
16e and the 12e, whatever the peripherique suggests.

The ring is what decides whether a station is intra muros, so unlike the track
geometry it is not simplified for looks - it is simplified only as far as the
station verdicts allow. The build refuses a tolerance that would move any
station across the line, and reports the closest call so the margin is on the
record rather than assumed.

Run:  python3 build-paris.py
"""

import json
import math
import re
import urllib.request
from pathlib import Path

API = "https://geo.api.gouv.fr/communes/75056?fields=nom,contour,surface&format=json"

# Tried in order; the first one that keeps every station on the side the full
# ring puts it on wins. ~11 m, ~5.5 m, ~2.2 m, ~1.1 m in degrees of latitude.
TOLERANCES_DEG = (1e-4, 5e-5, 2e-5, 1e-5)


def fetch_ring():
    with urllib.request.urlopen(API) as r:
        commune = json.load(r)
    contour = commune["contour"]
    if contour["type"] != "Polygon":
        raise SystemExit(f"expected a Polygon, got {contour['type']}")
    ring = [tuple(c) for c in contour["coordinates"][0]]  # GeoJSON lon/lat
    print(f"{commune['nom']}: {len(ring)} boundary points, {commune['surface'] / 100:.1f} km2")
    return ring


def perpendicular(p, a, b):
    """Distance from p to segment ab, in degrees-as-plane. Fine at this scale."""
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, tolerance):
    """Douglas-Peucker. Keeps the ends and every corner worth more than tolerance."""
    if len(points) < 3:
        return points
    first, last = points[0], points[-1]
    index = max(range(1, len(points) - 1), key=lambda i: perpendicular(points[i], first, last))
    if perpendicular(points[index], first, last) > tolerance:
        return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)
    return [first, last]


def inside(point, ring):
    """Ray casting, on lon/lat pairs. Mirrors window.inParis() in js/geo.js."""
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) / (y2 - y1) * (x2 - x1):
            hit = not hit
    return hit


def km_between(a, b):
    """a and b are lon/lat. Equirectangular is plenty over one commune."""
    mean_lat = math.radians((a[1] + b[1]) / 2)
    return 111.32 * math.hypot((a[0] - b[0]) * math.cos(mean_lat), a[1] - b[1])


def ring_distance_km(point, ring):
    """How far the point sits from the boundary itself, in or out."""
    best = float("inf")
    for a, b in zip(ring, ring[1:]):
        # Work in a local plane so the perpendicular is not distorted by longitude.
        scale = math.cos(math.radians(point[1]))
        flat = lambda p: (p[0] * scale, p[1])
        best = min(best, perpendicular(flat(point), flat(a), flat(b)) * 111.32)
    return best


def load_stations():
    """Read back the generated stations.js - the file is a JSON array in a wrapper."""
    path = Path(__file__).parent / "data" / "stations.js"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    return json.loads(re.search(r"window\.STATIONS = (\[.*\]);", text, re.S).group(1))


def main():
    full = fetch_ring()
    stations = load_stations()
    if not stations:
        print("! data/stations.js missing - simplifying without the station check")

    points = [(s["lon"], s["lat"]) for s in stations]
    truth = [inside(p, full) for p in points]

    ring = full
    for tolerance in TOLERANCES_DEG:
        candidate = simplify(full, tolerance)
        if not stations or [inside(p, candidate) for p in points] == truth:
            ring = candidate
            print(
                f"simplified {len(full)} -> {len(ring)} points at ~{tolerance * 111320:.0f} m"
                f"{'' if not stations else ', every station on the same side'}"
            )
            break
        print(f"  ~{tolerance * 111320:.0f} m moves a station across the line - tightening")

    if stations:
        intra = [s for s, i in zip(stations, truth) if i]
        print(f"{len(intra)} of {len(stations)} stations are intra muros")
        closest = min(
            ((ring_distance_km((s["lon"], s["lat"]), ring), s) for s in stations),
            key=lambda pair: pair[0],
        )
        side = "in" if inside((closest[1]["lon"], closest[1]["lat"]), ring) else "out"
        print(f"closest call: {closest[1]['name']}, {closest[0] * 1000:.0f} m {side}side the ring")

    out = Path(__file__).parent / "data" / "paris.js"
    payload = json.dumps(
        [[round(lat, 5), round(lon, 5)] for lon, lat in ring], separators=(",", ":")
    )
    out.write_text(
        "// Generated by build-paris.py - do not edit by hand.\n"
        "// Source: geo.api.gouv.fr / IGN Admin Express. Points are [lat, lon],\n"
        "// one closed ring: the Paris commune, both bois included.\n"
        f"window.PARIS_BOUNDARY = {payload};\n",
        encoding="utf-8",
    )
    print(f"wrote {out} ({out.stat().st_size / 1024:.1f} kB)")


if __name__ == "__main__":
    main()
