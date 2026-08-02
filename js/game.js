// Game state machine. Knows nothing about the DOM or Leaflet, so the rules can
// be reasoned about (and tested) on their own.

// Labels and blurbs live in i18n.js under `pool.<key>.label` / `.blurb`, so
// this file stays language-free.
//
// A filter takes the station and the player's line shortlist. Only `custom`
// reads the second argument; the fixed pools ignore it.
//
// Key order is menu order on the start screen.
window.POOLS = {
  metro: {
    filter: (s) => s.metro.length > 0,
    view: { center: [48.8566, 2.3522], zoom: 12 },
  },
  paris: {
    // Inside the city limits, whatever serves it - the 241 metro stations that
    // are actually in Paris, plus the dozen RER-only ones (Auber, Luxembourg,
    // Musee d'Orsay, Port Royal...). No La Defense, no Mairie de Montreuil.
    filter: (s) => window.inParis(s),
    // The only pool with a footprint worth framing exactly, so it is fitted to
    // the city rather than dropped at a fixed zoom: intra muros is 12 km across
    // and a zoom that suits a laptop leaves half of it off a phone.
    view: { center: [48.8566, 2.3522], zoom: 12, bounds: window.PARIS_BOUNDS },
  },
  rer: {
    // Metro interchanges are excluded so this stays a genuinely different game:
    // the far region, not Châtelet again.
    filter: (s) => s.rer.length > 0 && s.metro.length === 0,
    view: { center: [48.8566, 2.3522], zoom: 10 },
  },
  custom: {
    // Your own shortlist - one line, or RER B and D, or the whole left bank.
    // Unlike the RER pool this keeps the interchanges: asking for B and D means
    // the whole of B and D, Châtelet included, because that is what you picked.
    filter: (s, lines) =>
      s.metro.some((l) => lines.metro.includes(l)) ||
      s.rer.some((l) => lines.rer.includes(l)),
    // No fixed footprint of its own - see window.viewFor().
    view: null,
  },
  all: {
    filter: () => true,
    view: { center: [48.8566, 2.3522], zoom: 11 },
  },
};

window.NO_LINES = { metro: [], rer: [] };

/** Stations a pool plays on, given the shortlist a custom pool needs. */
window.stationsFor = function (stations, poolKey, lines = window.NO_LINES) {
  return stations.filter((s) => window.POOLS[poolKey].filter(s, lines));
};

/**
 * Where the map sits at the top of every round. A shortlist has no footprint of
 * its own, so it borrows the view of whichever fixed pool it most resembles:
 * RER lines run out to Melun and need the whole région in frame, métro lines
 * don't, and a mix wants the middle setting.
 */
window.viewFor = function (poolKey, lines = window.NO_LINES) {
  if (poolKey !== "custom") return window.POOLS[poolKey].view;
  if (!lines.rer.length) return window.POOLS.metro.view;
  return lines.metro.length ? window.POOLS.all.view : window.POOLS.rer.view;
};

// Deathmatch life bar. Both variants spend the same currency - the points you
// *didn't* score come straight off the bar, so a perfect pin is free and a wild
// one costs the full 5000. Burn also charges rent on the time you spend
// thinking, and pays some of it back for every station you actually answer.
// The goal either way is stations survived, not points banked.
window.DEATHMATCH_VARIANTS = {
  standard: { hp: 20000, drainPerSecond: 0, restore: 0 },
  burn: { hp: 10000, drainPerSecond: 100, restore: 1000 },
};

window.Game = class Game {
  constructor(
    stations,
    {
      pool = "metro",
      lines = window.NO_LINES,
      rounds = 5,
      timeLimit = null,
      deathmatch = false,
      variant = "standard",
    } = {}
  ) {
    this.poolKey = pool;
    // Frozen at kick-off: the start screen keeps mutating its own copy, and a
    // game in flight must not have its pool redefined under it.
    this.lines = { metro: lines.metro.slice(), rer: lines.rer.slice() };
    this.view = window.viewFor(pool, this.lines);
    const candidates = window.stationsFor(stations, pool, this.lines);
    if (!candidates.length) throw new Error(`empty station pool: ${pool}`);

    this.timeLimit = timeLimit; // seconds per round, or null for untimed
    this.deathmatch = deathmatch;
    this.variant = deathmatch ? variant : null;
    this.rules = deathmatch ? window.DEATHMATCH_VARIANTS[variant] : null;
    if (deathmatch && !this.rules) throw new Error(`unknown variant: ${variant}`);
    // Deathmatch has no round count - it runs until the bar empties, so the
    // whole pool is queued up and you simply never reach the end of it.
    this.rounds = deathmatch ? candidates.length : Math.min(rounds, candidates.length);
    this.picks = shuffle(candidates).slice(0, this.rounds);
    this.startHp = this.rules ? this.rules.hp : null;
    this.hp = this.startHp;
    this.results = [];
    this.index = 0;
    this.guess = null;
  }

  /** Burn only: the bar goes down on its own while you think. */
  get isBurning() {
    return !!(this.rules && this.rules.drainPerSecond);
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
    if (this.deathmatch && this.hp <= 0) return true;
    return this.results.length >= this.rounds;
  }

  /** Stations you got through. The deathmatch score. */
  get survived() {
    return this.results.length;
  }

  get totalScore() {
    return this.results.reduce((sum, r) => sum + r.score, 0);
  }

  get maxScore() {
    // Deathmatch has no target round count, so accuracy is measured against the
    // stations you actually faced rather than the whole queued-up pool.
    const rounds = this.deathmatch ? this.results.length : this.rounds;
    return rounds * window.MAX_ROUND_SCORE;
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
    return this.record({
      station,
      guess: this.guess,
      km,
      score: window.scoreFor(km),
      ratingKey: window.ratingFor(km),
    });
  }

  /**
   * File a finished round. In deathmatch the points you missed out on come off
   * the life bar, so the same scoring curve drives both modes. Burn's restore
   * is paid here - but only to the living: if the drain already emptied the bar
   * mid-round, answering doesn't buy you back off the floor.
   */
  record(result) {
    if (this.deathmatch) {
      const alive = this.hp > 0;
      result.damage = alive ? window.MAX_ROUND_SCORE - result.score - this.rules.restore : 0;
      result.burntOut = !alive; // the drain finished this round before you did
      // Capped at the starting bar: burn tops you back up, it doesn't stockpile.
      if (alive) {
        this.hp = Math.min(this.startHp, Math.max(0, this.hp - result.damage));
      }
      result.hpLeft = this.hp;
    }
    this.results.push(result);
    return result;
  }

  /**
   * Burn's per-second tax, charged from the round clock. Returns true if this
   * is the tick that emptied the bar.
   */
  drain(seconds) {
    if (!this.isBurning || this.isRevealed || this.isOver) return false;
    this.hp = Math.max(0, this.hp - this.rules.drainPerSecond * seconds);
    return this.hp <= 0;
  }

  /**
   * The round ended without you locking anything in - the round clock ran out,
   * or in burn the bar emptied under you. A pin already on the map still counts
   * - running out of time while you were confident shouldn't be worse than
   * guessing. With nothing placed there is no location to score, so the round is
   * a zero.
   */
  expire(ratingKey = "rating.outOfTime") {
    if (this.isRevealed) return null;
    if (this.guess) return this.submit();

    return this.record({
      station: this.station,
      guess: null,
      km: null,
      score: 0,
      ratingKey,
      timedOut: true,
    });
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
