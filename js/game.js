// Game state machine. Knows nothing about the DOM or Leaflet, so the rules can
// be reasoned about (and tested) on their own.

// Labels and blurbs live in i18n.js under `pool.<key>.label` / `.blurb`, so
// this file stays language-free.
window.POOLS = {
  metro: {
    filter: (s) => s.metro.length > 0,
    view: { center: [48.8566, 2.3522], zoom: 12 },
  },
  rer: {
    // Metro interchanges are excluded so this stays a genuinely different game:
    // the far region, not Châtelet again.
    filter: (s) => s.rer.length > 0 && s.metro.length === 0,
    view: { center: [48.8566, 2.3522], zoom: 10 },
  },
  all: {
    filter: () => true,
    view: { center: [48.8566, 2.3522], zoom: 11 },
  },
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
      rounds = 5,
      timeLimit = null,
      deathmatch = false,
      variant = "standard",
    } = {}
  ) {
    this.poolKey = pool;
    const candidates = stations.filter(window.POOLS[pool].filter);
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
