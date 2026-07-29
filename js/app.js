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
    startBtn: el("start-btn"),
    bestLine: el("best-line"),
    hud: el("hud"),
    roundLabel: el("round-label"),
    scoreLabel: el("score-label"),
    stationName: el("station-name"),
    stationLines: el("station-lines"),
    quitBtn: el("quit-btn"),
    actionbar: el("actionbar"),
    hint: el("hint"),
    result: el("result"),
    resultRating: el("result-rating"),
    resultDistance: el("result-distance"),
    resultPoints: el("result-points"),
    confirmBtn: el("confirm-btn"),
    endScreen: el("end-screen"),
    finalScore: el("final-score"),
    finalMax: el("final-max"),
    finalVerdict: el("final-verdict"),
    breakdown: el("breakdown"),
    againBtn: el("again-btn"),
  };

  let map;
  let layers = { guess: null, truth: null, link: null, label: null };
  let game = null;
  let settings = { pool: "metro", rounds: 10 };

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

  // ---------- round flow ----------

  function onMapClick(ev) {
    if (!game || game.isRevealed || game.isOver) return;
    if (!game.place(ev.latlng)) return;

    if (layers.guess) map.removeLayer(layers.guess);
    layers.guess = dot(ev.latlng, "guess");

    ui.confirmBtn.disabled = false;
    ui.hint.textContent = "Drop again to move it, or lock in your guess.";
  }

  function startRound() {
    clearLayers();
    const station = game.station;

    ui.roundLabel.textContent = `Round ${game.roundNumber} / ${game.rounds}`;
    ui.scoreLabel.textContent = `${game.totalScore.toLocaleString("en")} pts`;
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
  }

  function revealRound() {
    const result = game.submit();
    if (!result) return;

    const truth = L.latLng(result.station.lat, result.station.lon);
    const guess = L.latLng(result.guess.lat, result.guess.lon);

    layers.truth = dot(truth, "truth");
    layers.link = L.polyline([guess, truth], {
      color: "#1f2430", // dark: the basemap under it is light
      weight: 2.5,
      opacity: 0.8,
      dashArray: "5 7",
    }).addTo(map);
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

    map.fitBounds(L.latLngBounds([guess, truth]), {
      paddingTopLeft: [70, 150],
      paddingBottomRight: [70, 130],
      maxZoom: 15,
    });

    ui.hint.hidden = true;
    ui.result.hidden = false;
    ui.resultRating.textContent = result.rating;
    ui.resultDistance.textContent = window.formatDistance(result.km);
    ui.resultPoints.textContent = `+${result.score.toLocaleString("en")}`;
    ui.scoreLabel.textContent = `${game.totalScore.toLocaleString("en")} pts`;
    ui.confirmBtn.textContent = game.isOver ? "See results" : "Next station";
    ui.confirmBtn.disabled = false;
    ui.map.classList.remove("is-guessing");
  }

  function onConfirm() {
    if (!game) return;
    if (!game.isRevealed) {
      revealRound();
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
    renderBest();
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
    const pct = Math.round((entry.score / entry.max) * 100);
    ui.bestLine.hidden = false;
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
    clearLayers();
    ui.hud.hidden = true;
    ui.actionbar.hidden = true;
    ui.map.classList.remove("is-guessing");

    const total = game.totalScore;
    const max = game.maxScore;
    const pct = Math.round((total / max) * 100);

    ui.finalScore.textContent = total.toLocaleString("en");
    ui.finalMax.textContent = `/ ${max.toLocaleString("en")}`;
    ui.finalVerdict.textContent = verdictFor(pct);

    const avgKm = game.results.reduce((s, r) => s + r.km, 0) / game.results.length;
    ui.breakdown.textContent = "";
    game.results.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="bd-name">${escapeHtml(r.station.name)}</span>` +
        `<span class="bd-km">${window.formatDistance(r.km)}</span>` +
        `<span class="bd-pts">${r.score.toLocaleString("en")}</span>`;
      ui.breakdown.appendChild(li);
    });
    const summary = document.createElement("li");
    summary.innerHTML =
      `<span class="bd-name"><em>Average miss</em></span>` +
      `<span class="bd-km">${window.formatDistance(avgKm)}</span>` +
      `<span class="bd-pts">${pct}%</span>`;
    ui.breakdown.appendChild(summary);

    saveBest(total, max);
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

  // ---------- best score ----------

  const bestKeyFor = (s) => `${s.pool}:${s.rounds}`;

  function readBest() {
    try {
      return JSON.parse(localStorage.getItem(BEST_KEY)) || {};
    } catch {
      return {}; // private browsing, or someone hand-edited the value
    }
  }

  function saveBest(score, max) {
    const best = readBest();
    const key = bestKeyFor(settings);
    if (!best[key] || score > best[key].score) {
      best[key] = { score, max };
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(best));
      } catch {
        /* storage unavailable - the score just won't persist */
      }
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
    settings.rounds = Number(btn.dataset.rounds);
    selectIn(ui.roundOptions, ".pill", btn);
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
