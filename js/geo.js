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

// Exponential decay, tuned to Paris scale: adjacent metro stations sit roughly
// 500 m apart, so landing inside 500 m should still feel like a near-win.
//   0 m -> 5000    500 m -> 4094    1 km -> 3352    2 km -> 2247
//   5 km ->  677     10 km ->   92
window.MAX_ROUND_SCORE = 5000;
window.scoreFor = function (km) {
  return Math.round(window.MAX_ROUND_SCORE * Math.exp(-km / 2.5));
};

window.formatDistance = function (km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  return `${km.toFixed(1)} km`;
};

window.ratingFor = function (km) {
  if (km < 0.15) return "Bang on";
  if (km < 0.4) return "Superb";
  if (km < 0.8) return "Excellent";
  if (km < 1.5) return "Solid";
  if (km < 3) return "Not bad";
  if (km < 6) return "Wide";
  if (km < 15) return "Lost";
  return "Wrong arrondissement entirely";
};
