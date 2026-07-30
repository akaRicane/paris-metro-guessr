// DOM + Leaflet wiring. All rules live in game.js; this file only renders state
// and forwards input.

(function () {
  "use strict";

  const BEST_KEY = "paris-metro-guessr.best";

  // Panning off to Normandy has no gameplay value and just gets you lost.
  const REGION_BOUNDS = L.latLngBounds([48.0, 1.6], [49.4, 3.3]);

  const el = (id) => document.getElementById(id);
  const ui = {
    map: el("map"),
    startScreen: el("start-screen"),
    poolOptions: el("pool-options"),
    roundOptions: el("round-options"),
    variantOptions: el("variant-options"),
    roundsNote: el("rounds-note"),
    startBtn: el("start-btn"),
    bestLine: el("best-line"),
    hud: el("hud"),
    roundLabel: el("round-label"),
    scoreLabel: el("score-label"),
    lifebar: el("lifebar"),
    lifebarFill: el("lifebar-fill"),
    stationName: el("station-name"),
    stationLines: el("station-lines"),
    timerLabel: el("timer-label"),
    timerOptions: el("timer-options"),
    quitBtn: el("quit-btn"),
    actionbar: el("actionbar"),
    hint: el("hint"),
    result: el("result"),
    resultRating: el("result-rating"),
    resultDistance: el("result-distance"),
    resultPoints: el("result-points"),
    confirmBtn: el("confirm-btn"),
    endScreen: el("end-screen"),
    endTitle: el("end-title"),
    finalScore: el("final-score"),
    finalMax: el("final-max"),
    finalVerdict: el("final-verdict"),
    breakdown: el("breakdown"),
    againBtn: el("again-btn"),
  };

  let map;
  let layers = { guess: null, truth: null, link: null, label: null };
  let game = null;
  let settings = {
    pool: "metro",
    rounds: 10,
    timeLimit: null,
    deathmatch: false,
    variant: "standard",
  };
  let clock = { handle: null, deadline: 0, last: 0 };

  const VARIANT_NOTES = {
    standard:
      "20 000 life points. Every round costs you the points you missed — a " +
      "perfect pin is free, a wild one is 5 000. Last as long as you can.",
    burn:
      "10 000 life points, draining 100 every second. The miss still costs you " +
      "the same, but answering a station pays 1 000 back. Pin well, and quickly.",
  };

  // ---------- map ----------

  function initMap() {
    map = L.map("map", {
      center: window.POOLS.metro.view.center,
      zoom: window.POOLS.metro.view.zoom,
      minZoom: 9,
      maxZoom: 17,
      maxBounds: REGION_BOUNDS,
      maxBoundsViscosity: 0.85,
      zoomControl: true,
      attributionControl: true,
    });

    // A labelled basemap would print the station names straight onto the board,
    // so this uses Carto's no-label raster - verified label-free through z17.
    // Voyager over the darker variants because you need to actually read the
    // city: blue Seine, green parks, yellow arterials, grey rail corridors are
    // the only cues you get, and that is the whole game.
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png",
      {
        subdomains: "abcd",
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
          '&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; ' +
          "stations: Île-de-France Mobilités (ODbL)",
      }
    ).addTo(map);

    map.on("click", onMapClick);
    document.getElementById("map").removeAttribute("aria-hidden");
  }

  function dot(latlng, kind) {
    return L.marker(latlng, {
      icon: L.divIcon({
        className: "",
        html: `<div class="pin ${kind}"></div>`,
        iconSize: [15, 15],
        iconAnchor: [7.5, 7.5],
      }),
      keyboard: false,
      interactive: false,
    }).addTo(map);
  }

  function clearLayers() {
    Object.keys(layers).forEach((key) => {
      if (layers[key]) {
        map.removeLayer(layers[key]);
        layers[key] = null;
      }
    });
  }

  // ---------- round clock ----------

  function stopClock() {
    if (clock.handle) clearInterval(clock.handle);
    clock.handle = null;
    ui.timerLabel.hidden = true;
    ui.timerLabel.classList.remove("is-urgent");
  }

  function startClock() {
    stopClock();
    // Burn needs the tick even untimed - the tick is what drains the bar.
    if (!game.timeLimit && !game.isBurning) return;

    // Tick against a wall-clock deadline rather than counting down a variable.
    // setInterval drifts, and browsers throttle it hard in a background tab -
    // a decremented counter would hand back free seconds for looking away.
    clock.deadline = Date.now() + (game.timeLimit ?? 0) * 1000;
    clock.last = Date.now();
    ui.timerLabel.hidden = !game.timeLimit;
    paintClock();
    clock.handle = setInterval(paintClock, 200);
  }

  function paintClock() {
    const now = Date.now();
    const sinceLastTick = now - clock.last;
    clock.last = now;

    // Charged off the elapsed wall clock for the same reason as the countdown:
    // a throttled tab must not come back with a fuller bar than it left with.
    if (game.isBurning) {
      const burntOut = game.drain(sinceLastTick / 1000);
      paintTally();
      if (burntOut) {
        stopClock();
        const result = game.expire("Burnt out");
        if (result) showReveal(result);
        return;
      }
    }

    if (!game.timeLimit) return;

    const remaining = Math.max(0, clock.deadline - now);
    ui.timerLabel.textContent = `${Math.ceil(remaining / 1000)}s`;
    ui.timerLabel.classList.toggle("is-urgent", remaining <= 5000);

    if (remaining <= 0) {
      stopClock();
      const result = game.expire();
      if (result) showReveal(result);
    }
  }

  // ---------- round flow ----------

  function onMapClick(ev) {
    if (!game || game.isRevealed || game.isOver) return;
    if (!game.place(ev.latlng)) return;

    if (layers.guess) map.removeLayer(layers.guess);
    layers.guess = dot(ev.latlng, "guess");

    ui.confirmBtn.disabled = false;
    ui.hint.textContent = "Drop again to move it, or lock in your guess.";
  }

  // What a deathmatch round did to the bar. Burn's restore can outweigh the
  // miss, and the round the drain killed you on charged you nothing extra.
  function deathmatchDelta(result, suffix = "") {
    if (result.burntOut) return "—";
    const sign = result.damage > 0 ? "−" : "+";
    return `${sign}${Math.abs(result.damage).toLocaleString("en")}${suffix}`;
  }

  // The HUD counter is points banked in a normal game, life left in deathmatch.
  function paintTally() {
    if (!game.deathmatch) {
      ui.scoreLabel.textContent = `${game.totalScore.toLocaleString("en")} pts`;
      ui.scoreLabel.classList.remove("is-critical");
      ui.lifebar.hidden = true;
      return;
    }
    const left = game.hp / game.startHp;
    // Burn drains fractionally between ticks; nobody wants to read 9 342.4 HP.
    ui.scoreLabel.textContent = `${Math.round(game.hp).toLocaleString("en")} HP`;
    ui.scoreLabel.classList.toggle("is-critical", left <= 0.25);
    ui.lifebar.hidden = false;
    // Ease the step in a standard game; track the drain in burn, where the bar
    // moves every tick and easing would just lag behind the truth.
    ui.lifebar.classList.toggle("is-draining", game.isBurning);
    ui.lifebarFill.style.width = `${left * 100}%`;
    ui.lifebarFill.classList.toggle("is-low", left <= 0.5);
    ui.lifebarFill.classList.toggle("is-critical", left <= 0.25);
  }

  function startRound() {
    clearLayers();
    const station = game.station;

    ui.roundLabel.textContent = game.deathmatch
      ? `Station ${game.roundNumber}`
      : `Round ${game.roundNumber} / ${game.rounds}`;
    paintTally();
    ui.stationName.textContent = station.name;
    renderBadges(ui.stationLines, station);

    ui.hint.textContent = "Click the map to drop your pin.";
    ui.hint.hidden = false;
    ui.result.hidden = true;
    ui.confirmBtn.textContent = "Guess";
    ui.confirmBtn.disabled = true;
    ui.map.classList.add("is-guessing");

    // Reset the viewport every round: a leftover zoom from the previous reveal
    // would otherwise hand out a free hint about where we are.
    const view = window.POOLS[game.poolKey].view;
    map.setView(view.center, view.zoom, { animate: false });

    startClock();
  }

  function showReveal(result) {
    stopClock();

    const truth = L.latLng(result.station.lat, result.station.lon);
    layers.truth = dot(truth, "truth");
    layers.label = L.marker(truth, {
      icon: L.divIcon({
        className: "",
        html: `<div class="truth-label">${escapeHtml(result.station.name)}</div>`,
        iconSize: null,
        iconAnchor: [-12, 8],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(map);

    // A round that timed out with no pin has nothing to join up or measure.
    if (result.guess) {
      const guess = L.latLng(result.guess.lat, result.guess.lon);
      layers.link = L.polyline([guess, truth], {
        color: "#1f2430", // dark: the basemap under it is light
        weight: 2.5,
        opacity: 0.8,
        dashArray: "5 7",
      }).addTo(map);
      map.fitBounds(L.latLngBounds([guess, truth]), {
        paddingTopLeft: [70, 150],
        paddingBottomRight: [70, 130],
        maxZoom: 15,
      });
    } else {
      map.setView(truth, 14, { animate: true });
    }

    ui.hint.hidden = true;
    ui.result.hidden = false;
    ui.resultRating.textContent = result.rating;
    ui.resultDistance.textContent =
      result.km === null ? "no guess" : window.formatDistance(result.km);
    // Deathmatch reports what the round cost you, not what it earned - and in
    // burn a sharp pin can cost less than the 1000 restore, i.e. heal you.
    ui.resultPoints.textContent = game.deathmatch
      ? deathmatchDelta(result, " HP")
      : `+${result.score.toLocaleString("en")}`;
    ui.resultPoints.classList.toggle(
      "is-damage",
      game.deathmatch && !result.burntOut && result.damage > 0
    );
    ui.resultPoints.classList.toggle(
      "is-heal",
      game.deathmatch && !result.burntOut && result.damage <= 0
    );
    paintTally();
    // Running the whole pool dry is also game over, but it isn't dying.
    ui.confirmBtn.textContent = !game.isOver
      ? "Next station"
      : game.deathmatch && game.hp <= 0
      ? game.isBurning
        ? "Burnt out"
        : "You died"
      : "See results";
    ui.confirmBtn.disabled = false;
    ui.map.classList.remove("is-guessing");
  }

  function onConfirm() {
    if (!game) return;
    if (!game.isRevealed) {
      const result = game.submit();
      if (result) showReveal(result);
    } else if (game.isOver) {
      showEndScreen();
    } else {
      game.next();
      startRound();
    }
  }

  // ---------- screens ----------

  function renderBadges(container, station) {
    container.textContent = "";
    const add = (kind, label) => {
      const color = window.LINE_COLORS[kind][label] || "#666";
      const span = document.createElement("span");
      span.className = `badge ${kind}`;
      span.style.background = color;
      span.style.color = window.textOn(color);
      span.textContent = kind === "rer" ? `RER ${label}` : label;
      container.appendChild(span);
    };
    station.metro.forEach((l) => add("metro", l));
    station.rer.forEach((l) => add("rer", l));
  }

  function buildStartScreen() {
    ui.poolOptions.textContent = "";
    Object.entries(window.POOLS).forEach(([key, pool]) => {
      const count = window.STATIONS.filter(pool.filter).length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pool" + (key === settings.pool ? " is-selected" : "");
      btn.dataset.pool = key;
      btn.innerHTML =
        `<strong>${pool.label}</strong>` +
        `<span>${count} stations · ${escapeHtml(pool.blurb)}</span>`;
      ui.poolOptions.appendChild(btn);
    });
    renderDeathmatch();
    renderBest();
  }

  // The variant picker and its rules blurb only exist inside deathmatch.
  function renderDeathmatch() {
    ui.variantOptions.hidden = !settings.deathmatch;
    ui.roundsNote.hidden = !settings.deathmatch;
    ui.roundsNote.textContent = VARIANT_NOTES[settings.variant];
  }

  function selectIn(container, selector, chosen) {
    container.querySelectorAll(selector).forEach((b) => {
      b.classList.toggle("is-selected", b === chosen);
    });
  }

  function renderBest() {
    const best = readBest();
    const entry = best[bestKeyFor(settings)];
    if (!entry) {
      ui.bestLine.hidden = true;
      return;
    }
    ui.bestLine.hidden = false;
    if (settings.deathmatch) {
      ui.bestLine.textContent = `Best on this setup: survived ${entry.survived} station${
        entry.survived === 1 ? "" : "s"
      }`;
      return;
    }
    const pct = Math.round((entry.score / entry.max) * 100);
    ui.bestLine.textContent = `Best on this setup: ${entry.score.toLocaleString(
      "en"
    )} / ${entry.max.toLocaleString("en")} (${pct}%)`;
  }

  function startGame() {
    game = new window.Game(window.STATIONS, settings);
    ui.startScreen.hidden = true;
    ui.endScreen.hidden = true;
    ui.hud.hidden = false;
    ui.actionbar.hidden = false;
    startRound();
  }

  function showEndScreen() {
    stopClock();
    clearLayers();
    ui.hud.hidden = true;
    ui.actionbar.hidden = true;
    ui.map.classList.remove("is-guessing");

    const total = game.totalScore;
    const max = game.maxScore;
    const pct = max ? Math.round((total / max) * 100) : 0;

    if (game.deathmatch) {
      // Surviving the entire pool is a different sentence from bleeding out.
      ui.endTitle.textContent = !game.hp
        ? game.isBurning
          ? "You burnt out"
          : "You died"
        : "You cleared the network";
      ui.finalScore.textContent = String(game.survived);
      ui.finalMax.textContent = game.survived === 1 ? "station" : "stations";
      ui.finalVerdict.textContent = deathmatchVerdictFor(game.survived, game.variant);
    } else {
      ui.endTitle.textContent = "Final score";
      ui.finalScore.textContent = total.toLocaleString("en");
      ui.finalMax.textContent = `/ ${max.toLocaleString("en")}`;
      ui.finalVerdict.textContent = verdictFor(pct);
    }

    ui.breakdown.textContent = "";
    game.results.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="bd-name">${escapeHtml(r.station.name)}</span>` +
        `<span class="bd-km">${
          r.km === null ? "out of time" : window.formatDistance(r.km)
        }</span>` +
        `<span class="bd-pts${
          !game.deathmatch || r.burntOut ? "" : r.damage > 0 ? " is-damage" : " is-heal"
        }">${
          game.deathmatch ? deathmatchDelta(r) : r.score.toLocaleString("en")
        }</span>`;
      ui.breakdown.appendChild(li);
    });

    // Averaged over answered rounds only. Folding a timeout in as a zero-km miss
    // would read as a perfect guess and flatter the average.
    const answered = game.results.filter((r) => r.km !== null);
    const timedOut = game.results.length - answered.length;
    const summary = document.createElement("li");
    summary.innerHTML =
      `<span class="bd-name"><em>Average miss${
        timedOut ? ` (${timedOut} timed out)` : ""
      }</em></span>` +
      `<span class="bd-km">${
        answered.length
          ? window.formatDistance(
              answered.reduce((s, r) => s + r.km, 0) / answered.length
            )
          : "—"
      }</span>` +
      `<span class="bd-pts">${pct}%</span>`;
    ui.breakdown.appendChild(summary);

    saveBest();
    ui.endScreen.hidden = false;
  }

  function verdictFor(pct) {
    if (pct >= 90) return "You are the map. Do you drive a 96 bus?";
    if (pct >= 75) return "Genuinely strong. You know this network.";
    if (pct >= 55) return "Good instincts, shaky on the outskirts.";
    if (pct >= 35) return "You know the centre. The suburbs know you don't.";
    if (pct >= 15) return "Right city, at least.";
    return "Consider buying a paper map.";
  }

  // Standard: 20 000 HP against a 5000-point round, so averaging a 1 km miss
  // buys about 12 stations and 400 m buys about 26. Burn runs shorter - half the
  // bar, and the clock takes its cut whether you pin well or not.
  const DEATHMATCH_VERDICTS = {
    standard: [
      [50, "Fifty stations deep. You are the map."],
      [30, "A serious run. The suburbs didn't scare you."],
      [18, "Strong. You died somewhere past the périph."],
      [10, "Respectable. Two bad pins cost you the run."],
      [5, "Bled out early. The outskirts got you."],
      [0, "Barely left Châtelet."],
    ],
    burn: [
      [30, "Thirty under the drain. Frightening."],
      [18, "Fast and accurate. Very few last this long."],
      [12, "Strong run — you were still gaining ground on the clock."],
      [7, "Solid. The drain caught you in the suburbs."],
      [4, "The clock beat you before the map did."],
      [0, "Burnt out at the gates."],
    ],
  };

  function deathmatchVerdictFor(survived, variant) {
    const table = DEATHMATCH_VERDICTS[variant] ?? DEATHMATCH_VERDICTS.standard;
    return table.find(([floor]) => survived >= floor)[1];
  }

  // ---------- best score ----------

  // The clock changes the game enough that scores aren't comparable across it,
  // so a 10s run gets its own record rather than competing with an untimed one.
  const bestKeyFor = (s) =>
    `${s.pool}:${s.deathmatch ? `dm-${s.variant}` : s.rounds}:${s.timeLimit ?? "free"}`;

  function readBest() {
    try {
      return JSON.parse(localStorage.getItem(BEST_KEY)) || {};
    } catch {
      return {}; // private browsing, or someone hand-edited the value
    }
  }

  function saveBest() {
    const best = readBest();
    const key = bestKeyFor(settings);
    const previous = best[key];

    let entry;
    if (game.deathmatch) {
      // Stations survived is the score; life left breaks a tie between two runs
      // that got equally far.
      entry = { survived: game.survived, hp: game.hp };
      if (
        previous &&
        (previous.survived > entry.survived ||
          (previous.survived === entry.survived && (previous.hp ?? 0) >= entry.hp))
      ) {
        return;
      }
    } else {
      entry = { score: game.totalScore, max: game.maxScore };
      if (previous && previous.score >= entry.score) return;
    }

    best[key] = entry;
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch {
      /* storage unavailable - the score just won't persist */
    }
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  // ---------- events ----------

  ui.poolOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pool");
    if (!btn) return;
    settings.pool = btn.dataset.pool;
    selectIn(ui.poolOptions, ".pool", btn);
    renderBest();
  });

  ui.roundOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pill");
    if (!btn) return;
    settings.deathmatch = btn.dataset.rounds === "dm";
    // Keep the last numeric choice, so flipping out of deathmatch lands back on it.
    if (!settings.deathmatch) settings.rounds = Number(btn.dataset.rounds);
    selectIn(ui.roundOptions, ".pill", btn);
    renderDeathmatch();
    renderBest();
  });

  ui.variantOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pill");
    if (!btn) return;
    settings.variant = btn.dataset.variant;
    selectIn(ui.variantOptions, ".pill", btn);
    renderDeathmatch();
    renderBest();
  });

  ui.timerOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pill");
    if (!btn) return;
    settings.timeLimit = btn.dataset.time ? Number(btn.dataset.time) : null;
    selectIn(ui.timerOptions, ".pill", btn);
    renderBest();
  });

  ui.startBtn.addEventListener("click", startGame);
  ui.againBtn.addEventListener("click", () => {
    ui.endScreen.hidden = true;
    ui.startScreen.hidden = false;
    buildStartScreen();
  });
  ui.confirmBtn.addEventListener("click", onConfirm);
  ui.quitBtn.addEventListener("click", () => {
    stopClock();
    game = null;
    clearLayers();
    ui.hud.hidden = true;
    ui.actionbar.hidden = true;
    ui.map.classList.remove("is-guessing");
    ui.startScreen.hidden = false;
    buildStartScreen();
  });

  // Enter drives the whole loop so a round is click-map-then-Enter.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    if (!ui.startScreen.hidden) {
      startGame();
    } else if (!ui.endScreen.hidden) {
      ui.againBtn.click();
    } else if (!ui.confirmBtn.disabled) {
      onConfirm();
    }
  });

  // ---------- boot ----------

  if (!window.STATIONS || !window.STATIONS.length) {
    document.body.innerHTML =
      '<div class="overlay"><div class="card"><h1>No station data</h1>' +
      "<p class=tagline>Run <code>python3 build-stations.py</code> to fetch it.</p></div></div>";
    return;
  }

  initMap();
  buildStartScreen();
})();
