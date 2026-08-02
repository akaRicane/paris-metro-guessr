// Distance, scoring and formatting. No DOM, no map - pure functions.

const EARTH_KM = 6371.0088;

window.haversineKm = function (a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
};

// ---------- the city limits ----------

/**
 * Is this point inside Paris? Ray casting against the commune ring from
 * data/paris.js: count the boundary crossings due east of the point, and an odd
 * count means inside. The ring is the administrative commune, so both bois
 * count as Paris - they are the 16e and the 12e.
 *
 * build-paris.py runs this same test at build time and refuses to simplify the
 * ring past the point where any station would change sides, so the verdicts
 * here match the full-resolution boundary exactly.
 */
window.inParis = function (point) {
  const ring = window.PARIS_BOUNDARY;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    if (
      latI > point.lat !== latJ > point.lat &&
      point.lon < lonI + ((point.lat - latI) / (latJ - latI)) * (lonJ - lonI)
    ) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * The city's own bounding box, derived from the ring rather than written down,
 * so it cannot drift from the boundary the pool is actually filtered on.
 */
window.PARIS_BOUNDS = (function () {
  // Null rather than a throw when data/paris.js hasn't been built: app.js checks
  // for the file and prints the run-this-script screen, and it can only do that
  // if loading this one didn't already take the page down.
  if (!window.PARIS_BOUNDARY || !window.PARIS_BOUNDARY.length) return null;
  const lats = window.PARIS_BOUNDARY.map((p) => p[0]);
  const lons = window.PARIS_BOUNDARY.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ];
})();

// Exponential decay, tuned to Paris scale: adjacent metro stations sit roughly
// 500 m apart, so landing inside 500 m should still feel like a near-win.
//   0 m -> 5000    500 m -> 4094    1 km -> 3352    2 km -> 2247
//   5 km ->  677     10 km ->   92
window.MAX_ROUND_SCORE = 5000;
window.scoreFor = function (km) {
  return Math.round(window.MAX_ROUND_SCORE * Math.exp(-km / 2.5));
};

// Units are the same in both languages; the decimal separator is not, so the
// figure goes through the locale rather than through toFixed.
window.formatDistance = function (km) {
  const decimals = (n, d) =>
    n.toLocaleString(window.numberLocale(), {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${decimals(km, 2)} km`;
  return `${decimals(km, 1)} km`;
};

// A key, not a sentence: the rating is stored on the result and rendered much
// later, so it has to survive without committing to a language.
window.ratingFor = function (km) {
  if (km < 0.15) return "rating.bangOn";
  if (km < 0.4) return "rating.superb";
  if (km < 0.8) return "rating.excellent";
  if (km < 1.5) return "rating.solid";
  if (km < 3) return "rating.notBad";
  if (km < 6) return "rating.wide";
  if (km < 15) return "rating.lost";
  return "rating.wrongArrondissement";
};
