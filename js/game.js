// Game state machine. Knows nothing about the DOM or Leaflet, so the rules can
// be reasoned about (and tested) on their own.

window.POOLS = {
  metro: {
    label: "Métro",
    blurb: "Paris and the inner suburbs",
    filter: (s) => s.metro.length > 0,
    view: { center: [48.8566, 2.3522], zoom: 12 },
  },
  rer: {
    // Metro interchanges are excluded so this stays a genuinely different game:
    // the far region, not Châtelet again.
    label: "RER only",
    blurb: "the whole région, out to Cergy and Melun",
    filter: (s) => s.rer.length > 0 && s.metro.length === 0,
    view: { center: [48.8566, 2.3522], zoom: 10 },
  },
  all: {
    label: "Everything",
    blurb: "métro and RER combined",
    filter: () => true,
    view: { center: [48.8566, 2.3522], zoom: 11 },
  },
};

window.Game = class Game {
  constructor(stations, { pool = "metro", rounds = 5 } = {}) {
    this.poolKey = pool;
    const candidates = stations.filter(window.POOLS[pool].filter);
    if (!candidates.length) throw new Error(`empty station pool: ${pool}`);

    this.rounds = Math.min(rounds, candidates.length);
    this.picks = shuffle(candidates).slice(0, this.rounds);
    this.results = [];
    this.index = 0;
    this.guess = null;
  }

  get station() {
    return this.picks[this.index];
  }

  get roundNumber() {
    return this.index + 1;
  }

  get isRevealed() {
    return this.results.length > this.index;
  }

  get isOver() {
    return this.results.length >= this.rounds;
  }

  get totalScore() {
    return this.results.reduce((sum, r) => sum + r.score, 0);
  }

  get maxScore() {
    return this.rounds * window.MAX_ROUND_SCORE;
  }

  /** Provisional pin placement. Revocable until the round is submitted. */
  place(latlng) {
    if (this.isRevealed) return false;
    this.guess = { lat: latlng.lat, lon: latlng.lng ?? latlng.lon };
    return true;
  }

  /** Lock the pin in and score the round. Returns the result, or null if unplaced. */
  submit() {
    if (this.isRevealed || !this.guess) return null;
    const station = this.station;
    const km = window.haversineKm(this.guess, station);
    const result = {
      station,
      guess: this.guess,
      km,
      score: window.scoreFor(km),
      rating: window.ratingFor(km),
    };
    this.results.push(result);
    return result;
  }

  get lastResult() {
    return this.results[this.results.length - 1] ?? null;
  }

  /** Advance to the next round. Returns false once the game is over. */
  next() {
    if (this.isOver) return false;
    this.index += 1;
    this.guess = null;
    return true;
  }
};

function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
