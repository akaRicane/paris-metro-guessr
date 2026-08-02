// DOM + Leaflet wiring. All rules live in game.js; this file only renders state
// and forwards input.

(function () {
  "use strict";

  const BEST_KEY = "paris-metro-guessr.best";

  // Panning off to Normandy has no gameplay value and just gets you lost.
  const REGION_BOUNDS = L.latLngBounds([48.0, 1.6], [49.4, 3.3]);

  // The game stops short of the tile ceiling: past this you are reading kerbs.
  const GAME_MAX_ZOOM = 17;

  const CARTO_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; ' +
    "stations: Île-de-France Mobilités (ODbL)";
  const ESRI_ATTR =
    "Imagery &copy; Esri, Maxar, Earthstar Geographics &middot; " +
    "stations: Île-de-France Mobilités (ODbL)";

  // Every basemap here was checked against a z15 tile over Châtelet: a style
  // that prints one place name hands over the answer, so "nolabels" in the slug
  // is not enough on its own. Esri's Canvas Light/Dark Gray look like obvious
  // candidates and are disqualified - they bake park and district names into the
  // tiles. Stadia's Stamen styles need an API key (401 without one).
  const BASEMAPS = {
    voyager: {
      label: "Voyager",
      blurb: "Colour. Blue Seine, green parks, yellow arterials — the fairest read.",
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png",
      options: { subdomains: "abcd", maxZoom: 20, attribution: CARTO_ATTR },
    },
    light: {
      label: "Positron",
      blurb: "Near-white. The Seine barely registers, so you navigate on street grain.",
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}{r}.png",
      options: { subdomains: "abcd", maxZoom: 20, attribution: CARTO_ATTR },
    },
    dark: {
      label: "Dark Matter",
      blurb: "Same geometry as Positron, inverted. Easy on the eyes, low contrast.",
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}{r}.png",
      options: { subdomains: "abcd", maxZoom: 20, attribution: CARTO_ATTR },
    },
    satellite: {
      // Esri wants {y} before {x}; Leaflet substitutes by name, so it just works.
      label: "Satellite",
      blurb: "Esri imagery. No cartography at all — rooflines, rail yards, parks.",
      url:
        "https://server.arcgisonline.com/ArcGIS/rest/services/" +
        "World_Imagery/MapServer/tile/{z}/{y}/{x}",
      options: { maxZoom: 19, attribution: ESRI_ATTR },
    },
  };

  const SHOW_BASEMAP_DEMO_OPTIONS = false;
  const GAME_BASEMAP = "voyager";

  const t = window.t;
  const fmtNum = window.fmtNum;

  const el = (id) => document.getElementById(id);
  const ui = {
    map: el("map"),
    startScreen: el("start-screen"),
    langOptions: el("lang-options"),
    poolOptions: el("pool-options"),
    linePicker: el("line-picker"),
    lineMetro: el("line-metro"),
    lineRer: el("line-rer"),
    linesAll: el("lines-all"),
    linesNone: el("lines-none"),
    linesNote: el("lines-note"),
    roundOptions: el("round-options"),
    variantOptions: el("variant-options"),
    difficultyOptions: el("difficulty-options"),
    difficultyNote: el("difficulty-note"),
    roundsNote: el("rounds-note"),
    startBtn: el("start-btn"),
    demoBtn: el("demo-btn"),
    demo: el("demo"),
    demoLayers: el("demo-layers"),
    demoNote: el("demo-note"),
    demoZoom: el("demo-zoom"),
    demoPin: el("demo-pin"),
    demoClose: el("demo-close"),
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
  let basemapLayer = null;
  let basemapKey = GAME_BASEMAP;
  let layers = { guess: null, truth: null, link: null, label: null, lines: null };
  let networkLayer = null; // easy mode's backdrop, outside the per-round layers
  let game = null;
  let settings = {
    pool: "metro",
    // The "pick your lines" shortlist. Kept across pool switches, so flipping to
    // Métro and back doesn't lose the selection you just made.
    lines: { metro: [], rer: [] },
    rounds: 10,
    timeLimit: null,
    deathmatch: false,
    variant: "standard",
    easy: false,
  };
  let clock = { handle: null, deadline: 0, last: 0 };

  // The figures come from the rules rather than from the copy, so the numbers in
  // the blurb can't drift from the ones the game actually charges - and they
  // pick up the locale's thousands separator on the way through.
  function variantNote(key) {
    const rules = window.DEATHMATCH_VARIANTS[key];
    return t(`variant.note.${key}`, {
      hp: fmtNum(rules.hp),
      max: fmtNum(window.MAX_ROUND_SCORE),
      drain: fmtNum(rules.drainPerSecond),
      restore: fmtNum(rules.restore),
    });
  }

  // ---------- map ----------

  function initMap() {
    map = L.map("map", {
      center: window.POOLS.metro.view.center,
      zoom: window.POOLS.metro.view.zoom,
      minZoom: 9,
      maxZoom: GAME_MAX_ZOOM,
      maxBounds: REGION_BOUNDS,
      maxBoundsViscosity: 0.85,
      zoomControl: true,
      attributionControl: true,
    });

    // A labelled basemap would print the station names straight onto the board,
    // so the game runs on Carto's no-label voyager raster. Voyager over the
    // paler variants because you need to actually read the city: blue Seine,
    // green parks, yellow arterials, grey rail corridors are the only cues you
    // get, and that is the whole game.
    setBasemap(GAME_BASEMAP);

    map.on("click", onMapClick);
    map.on("zoomend", paintDemoZoom);
    document.getElementById("map").removeAttribute("aria-hidden");
  }

  /**
   * Swap the basemap. A fresh layer rather than tiles.setUrl(): each provider
   * carries its own attribution and zoom ceiling, and setUrl would leave the
   * credit in the corner pointing at the wrong company.
   */
  function setBasemap(key, { maxZoom = GAME_MAX_ZOOM } = {}) {
    const basemap = BASEMAPS[key];
    if (!basemap) return;
    basemapKey = key;
    if (basemapLayer) map.removeLayer(basemapLayer);
    basemapLayer = L.tileLayer(basemap.url, basemap.options).addTo(map);
    map.setMaxZoom(Math.min(maxZoom, basemap.options.maxZoom));
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

  // ---------- network geometry ----------

  const colorOf = (segment) => window.LINE_COLORS[segment.kind][segment.line] || "#666";

  /**
   * The lines a pool plays on. Métro-only games have no business showing the
   * RER out to Melun, and the RER game shouldn't sketch the métro underneath it.
   * A shortlist gets exactly what it asked for - the point of picking B and D is
   * a board with B and D on it.
   */
  function segmentsForPool(poolKey, lines = window.NO_LINES) {
    if (poolKey === "custom") {
      return window.LINES.filter((s) => lines[s.kind].includes(s.line));
    }
    if (poolKey === "paris") return clipToParis(window.LINES);
    if (poolKey === "metro") return window.LINES.filter((s) => s.kind === "metro");
    if (poolKey === "rer") return window.LINES.filter((s) => s.kind === "rer");
    return window.LINES;
  }

  /**
   * Cut the network at the city limits, for the intra-muros backdrop. Dropping
   * whole segments would leave line 1 stopping at Concorde, so each one is
   * walked point by point and every run of consecutive points inside Paris
   * becomes a segment of its own - the lines end at the boundary the pool is
   * defined by, which is the shape the mode is asking you to learn.
   */
  function clipToParis(segments) {
    const clipped = [];
    segments.forEach((segment) => {
      let run = [];
      const flush = () => {
        if (run.length > 1) clipped.push({ ...segment, pts: run });
        run = [];
      };
      segment.pts.forEach((pt) => {
        if (window.inParis({ lat: pt[0], lon: pt[1] })) run.push(pt);
        else flush();
      });
      flush();
    });
    return clipped;
  }

  function segmentsForStation(station) {
    return window.LINES.filter(
      (s) =>
        (s.kind === "metro" && station.metro.includes(s.line)) ||
        (s.kind === "rer" && station.rer.includes(s.line))
    );
  }

  /**
   * Easy mode's backdrop: the whole pool, thin and half-transparent so it reads
   * as a hint rather than as the answer. Built once per game and left on the map
   * between rounds - 660 polylines is not something to rebuild every round.
   */
  function showNetwork(poolKey, lines) {
    hideNetwork();
    networkLayer = L.layerGroup(
      segmentsForPool(poolKey, lines).map((s) =>
        L.polyline(s.pts, {
          color: colorOf(s),
          weight: 2.5,
          opacity: 0.5,
          interactive: false,
        })
      )
    ).addTo(map);
  }

  function hideNetwork() {
    if (networkLayer) map.removeLayer(networkLayer);
    networkLayer = null;
  }

  /**
   * The reveal's teaching moment: the lines that actually serve this station,
   * full strength over a white casing so they hold up on satellite and on the
   * pale basemaps alike.
   */
  function drawStationLines(station) {
    const segments = segmentsForStation(station);
    if (!segments.length) return null;

    const casing = segments.map((s) =>
      L.polyline(s.pts, {
        color: "#ffffff",
        weight: 7,
        opacity: 0.55,
        interactive: false,
      })
    );
    const strokes = segments.map((s) =>
      L.polyline(s.pts, {
        color: colorOf(s),
        weight: 4,
        opacity: 0.95,
        interactive: false,
      })
    );
    return L.layerGroup([...casing, ...strokes]).addTo(map);
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
        const result = game.expire("rating.burntOut");
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
    ui.hint.textContent = t("hint.placed");
  }

  // What a deathmatch round did to the bar. Burn's restore can outweigh the
  // miss, and the round the drain killed you on charged you nothing extra.
  function deathmatchDelta(result, suffix = "") {
    if (result.burntOut) return "—";
    const sign = result.damage > 0 ? "−" : "+";
    return `${sign}${fmtNum(Math.abs(result.damage))}${suffix}`;
  }

  // The HUD counter is points banked in a normal game, life left in deathmatch.
  function paintTally() {
    if (!game.deathmatch) {
      ui.scoreLabel.textContent = t("hud.points", { n: fmtNum(game.totalScore) });
      ui.scoreLabel.classList.remove("is-critical");
      ui.lifebar.hidden = true;
      return;
    }
    const left = game.hp / game.startHp;
    // Burn drains fractionally between ticks; nobody wants to read 9 342.4 HP.
    ui.scoreLabel.textContent = `${fmtNum(Math.round(game.hp))} ${t("unit.hp")}`;
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
      ? t("hud.station", { n: game.roundNumber })
      : t("hud.round", { n: game.roundNumber, total: game.rounds });
    paintTally();
    ui.stationName.textContent = station.name;
    renderBadges(ui.stationLines, station);

    ui.hint.textContent = t("hint.place");
    ui.hint.hidden = false;
    ui.result.hidden = true;
    ui.confirmBtn.textContent = t("confirm.guess");
    ui.confirmBtn.disabled = true;
    ui.map.classList.add("is-guessing");

    // Reset the viewport every round: a leftover zoom from the previous reveal
    // would otherwise hand out a free hint about where we are. A pool that
    // carries bounds gets fitted to them, so the frame adapts to the screen
    // instead of trusting one zoom level to suit every window.
    if (game.view.bounds) {
      map.fitBounds(game.view.bounds, { animate: false, padding: [10, 10] });
    } else {
      map.setView(game.view.center, game.view.zoom, { animate: false });
    }

    startClock();
  }

  function showReveal(result) {
    stopClock();

    // Under the pins and the miss line: it is context for the answer, not the
    // answer. Drawn first so the dashed link stays readable across it.
    layers.lines = drawStationLines(result.station);

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
    ui.resultRating.textContent = t(result.ratingKey);
    ui.resultDistance.textContent =
      result.km === null ? t("result.noGuess") : window.formatDistance(result.km);
    // Deathmatch reports what the round cost you, not what it earned - and in
    // burn a sharp pin can cost less than the 1000 restore, i.e. heal you.
    ui.resultPoints.textContent = game.deathmatch
      ? deathmatchDelta(result, ` ${t("unit.hp")}`)
      : `+${fmtNum(result.score)}`;
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
      ? t("confirm.next")
      : game.deathmatch && game.hp <= 0
      ? game.isBurning
        ? t("confirm.burntOut")
        : t("confirm.died")
      : t("confirm.results");
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

  // ---------- basemap demo ----------

  // A sandbox for judging a basemap before it ever reaches a round: pan and zoom
  // freely, past the game's ceiling, and check that no station name shows up.
  function buildDemo() {
    ui.demoLayers.textContent = "";
    Object.entries(BASEMAPS).forEach(([key, basemap]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill" + (key === basemapKey ? " is-selected" : "");
      btn.dataset.basemap = key;
      btn.textContent = basemap.label;
      ui.demoLayers.appendChild(btn);
    });
    ui.demoNote.textContent = BASEMAPS[basemapKey].blurb;
  }

  function openDemo() {
    if (!SHOW_BASEMAP_DEMO_OPTIONS) return;
    ui.startScreen.hidden = true;
    ui.demo.hidden = false;
    // Let the preview go deeper than a round ever does - the point is to hunt
    // for labels at the zoom where a style would start printing them.
    setBasemap(basemapKey, { maxZoom: 20 });
    buildDemo();
    map.setView(window.POOLS.metro.view.center, 13, { animate: false });
    paintDemoZoom();
  }

  function closeDemo() {
    ui.demo.hidden = true;
    clearLayers();
    setBasemap(GAME_BASEMAP); // the game is always played on voyager
    ui.startScreen.hidden = false;
    buildStartScreen();
  }

  function paintDemoZoom() {
    if (ui.demo.hidden) return;
    const zoom = map.getZoom();
    ui.demoZoom.textContent = `z${zoom}`;
    // Above the game ceiling you are looking at tiles no round will ever serve.
    ui.demoZoom.classList.toggle("is-past-game", zoom > GAME_MAX_ZOOM);
  }

  /**
   * Drop a reveal onto the preview - truth pin, name label, a guess 600 m off
   * and the dashed link. The markers have to stay legible on every basemap too,
   * and green-on-satellite is exactly the case you cannot eyeball in the
   * abstract.
   */
  function dropSample() {
    clearLayers();
    const centre = map.getCenter();
    const from = { lat: centre.lat, lon: centre.lng };
    const station = window.STATIONS.reduce((best, s) =>
      window.haversineKm(from, s) < window.haversineKm(from, best) ? s : best
    );

    const truth = L.latLng(station.lat, station.lon);
    const guess = L.latLng(station.lat + 0.0054, station.lon);
    layers.guess = dot(guess, "guess");
    layers.truth = dot(truth, "truth");
    layers.link = L.polyline([guess, truth], {
      color: "#1f2430",
      weight: 2.5,
      opacity: 0.8,
      dashArray: "5 7",
    }).addTo(map);
    layers.label = L.marker(truth, {
      icon: L.divIcon({
        className: "",
        html: `<div class="truth-label">${escapeHtml(station.name)}</div>`,
        iconSize: null,
        iconAnchor: [-12, 8],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
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

  const linesPicked = () => settings.lines.metro.length + settings.lines.rer.length;

  function buildStartScreen() {
    ui.poolOptions.textContent = "";
    Object.keys(window.POOLS).forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pool" + (key === settings.pool ? " is-selected" : "");
      btn.dataset.pool = key;
      const label = document.createElement("strong");
      label.textContent = t(`pool.${key}.label`);
      const blurb = document.createElement("span");
      blurb.className = "pool-blurb";
      btn.append(label, blurb);
      ui.poolOptions.appendChild(btn);
    });
    paintPoolBlurbs();
    buildLinePicker();
    paintStartBtn();
    renderDeathmatch();
    renderBest();
  }

  // The station count is the honest measure of what a pool is, and for the
  // shortlist it moves with every badge you tick - so it is painted apart from
  // the buttons rather than baked into them.
  function paintPoolBlurbs() {
    ui.poolOptions.querySelectorAll(".pool").forEach((btn) => {
      const key = btn.dataset.pool;
      const count = window.stationsFor(window.STATIONS, key, settings.lines).length;
      btn.querySelector(".pool-blurb").textContent =
        `${t("pool.count", { count })} · ${t(`pool.${key}.blurb`)}`;
    });
  }

  /**
   * The line roster, in official colours. Every badge is always on the board and
   * a pick lights it up, so the row reads as a plan you are ticking off rather
   * than as a list that grows and shrinks under the cursor.
   */
  function buildLinePicker() {
    ui.linePicker.hidden = settings.pool !== "custom";
    if (ui.linePicker.hidden) return;

    [
      ["metro", ui.lineMetro],
      ["rer", ui.lineRer],
    ].forEach(([kind, host]) => {
      host.textContent = "";
      window.LINE_ORDER[kind].forEach((line) => {
        const color = window.LINE_COLORS[kind][line];
        const picked = settings.lines[kind].includes(line);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `linebadge ${kind}` + (picked ? " is-selected" : "");
        btn.dataset.kind = kind;
        btn.dataset.line = line;
        btn.style.background = color;
        btn.style.color = window.textOn(color);
        btn.textContent = line;
        // The colour is the label here, so the name has to be spelled out for
        // anyone not reading it - and 3bis and 7bis share a colour with 13 and 6.
        btn.setAttribute(
          "aria-label",
          kind === "rer" ? t("lines.rerName", { line }) : t("lines.metroName", { line })
        );
        btn.setAttribute("aria-pressed", String(picked));
        host.appendChild(btn);
      });
    });
    paintLinesNote();
  }

  // Nothing ticked is a dead end rather than a rule, so it says so in the
  // warning colour instead of explaining how the shortlist reads.
  function paintLinesNote() {
    const empty = !linesPicked();
    ui.linesNote.hidden = false;
    ui.linesNote.textContent = empty ? t("lines.empty") : t("lines.note");
    ui.linesNote.classList.toggle("is-warning", empty);
  }

  // A shortlist with nothing on it has no stations to ask about.
  function paintStartBtn() {
    ui.startBtn.disabled = settings.pool === "custom" && !linesPicked();
  }

  // The variant picker and its rules blurb only exist inside deathmatch.
  function renderDeathmatch() {
    ui.variantOptions.hidden = !settings.deathmatch;
    ui.roundsNote.hidden = !settings.deathmatch;
    ui.roundsNote.textContent = variantNote(settings.variant);
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
      ui.bestLine.textContent = t("best.dm", { count: entry.survived });
      return;
    }
    ui.bestLine.textContent = t("best.score", {
      score: fmtNum(entry.score),
      max: fmtNum(entry.max),
      pct: Math.round((entry.score / entry.max) * 100),
    });
  }

  function startGame() {
    // Enter starts a game too, so the empty-shortlist gate lives here rather
    // than only on the button's disabled state.
    if (settings.pool === "custom" && !linesPicked()) return;
    game = new window.Game(window.STATIONS, settings);
    if (settings.easy) showNetwork(game.poolKey, game.lines);
    else hideNetwork();
    ui.startScreen.hidden = true;
    ui.endScreen.hidden = true;
    ui.hud.hidden = false;
    ui.actionbar.hidden = false;
    startRound();
  }

  function showEndScreen() {
    stopClock();
    clearLayers();
    hideNetwork();
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
          ? t("end.title.burnt")
          : t("end.title.died")
        : t("end.title.cleared");
      ui.finalScore.textContent = String(game.survived);
      ui.finalMax.textContent = t("end.stations", { count: game.survived });
      ui.finalVerdict.textContent = deathmatchVerdictFor(game.survived, game.variant);
    } else {
      ui.endTitle.textContent = t("end.title.final");
      ui.finalScore.textContent = fmtNum(total);
      ui.finalMax.textContent = t("end.outOf", { max: fmtNum(max) });
      ui.finalVerdict.textContent = verdictFor(pct);
    }

    ui.breakdown.textContent = "";
    game.results.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="bd-name">${escapeHtml(r.station.name)}</span>` +
        `<span class="bd-km">${escapeHtml(
          r.km === null ? t("bd.outOfTime") : window.formatDistance(r.km)
        )}</span>` +
        `<span class="bd-pts${
          !game.deathmatch || r.burntOut ? "" : r.damage > 0 ? " is-damage" : " is-heal"
        }">${game.deathmatch ? deathmatchDelta(r) : fmtNum(r.score)}</span>`;
      ui.breakdown.appendChild(li);
    });

    // Averaged over answered rounds only. Folding a timeout in as a zero-km miss
    // would read as a perfect guess and flatter the average.
    const answered = game.results.filter((r) => r.km !== null);
    const timedOut = game.results.length - answered.length;
    const summary = document.createElement("li");
    summary.innerHTML =
      `<span class="bd-name"><em>${escapeHtml(
        timedOut ? t("bd.averageTimedOut", { count: timedOut }) : t("bd.average")
      )}</em></span>` +
      `<span class="bd-km">${escapeHtml(
        answered.length
          ? window.formatDistance(
              answered.reduce((s, r) => s + r.km, 0) / answered.length
            )
          : "—"
      )}</span>` +
      `<span class="bd-pts">${pct}%</span>`;
    ui.breakdown.appendChild(summary);

    saveBest();
    ui.endScreen.hidden = false;
  }

  // Thresholds only: the sentence behind each one is looked up by key, so the
  // tables say what a score is worth and i18n.js says it out loud.
  const VERDICT_TIERS = [90, 75, 55, 35, 15, 0];

  function verdictFor(pct) {
    return t(`verdict.${VERDICT_TIERS.find((floor) => pct >= floor)}`);
  }

  // Standard: 20 000 HP against a 5000-point round, so averaging a 1 km miss
  // buys about 12 stations and 400 m buys about 26. Burn runs shorter - half the
  // bar, and the clock takes its cut whether you pin well or not.
  const DEATHMATCH_TIERS = {
    standard: [50, 30, 18, 10, 5, 0],
    burn: [30, 18, 12, 7, 4, 0],
  };

  function deathmatchVerdictFor(survived, variant) {
    const key = DEATHMATCH_TIERS[variant] ? variant : "standard";
    const tier = DEATHMATCH_TIERS[key].find((floor) => survived >= floor);
    return t(`verdict.dm.${key}.${tier}`);
  }

  // ---------- best score ----------

  // The clock changes the game enough that scores aren't comparable across it,
  // so a 10s run gets its own record rather than competing with an untimed one.
  // Easy draws the network on the board, so those runs get their own record too.
  // A shortlist is a pool of its own: line 1 alone and the whole métro are not
  // the same game, so the picked lines go in the key.
  const poolKeyFor = (s) =>
    s.pool === "custom"
      ? `custom-${s.lines.metro.join("+")}/${s.lines.rer.join("+")}`
      : s.pool;

  const bestKeyFor = (s) =>
    `${poolKeyFor(s)}:${s.deathmatch ? `dm-${s.variant}` : s.rounds}:` +
    `${s.timeLimit ?? "free"}` +
    (s.easy ? ":easy" : "");

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

  // ---------- language ----------

  /**
   * Everything the markup spells out itself. The English text stays in
   * index.html as the no-JS fallback; this pass overwrites it with the current
   * language. Dynamic text is not handled here - it is rebuilt from `t()` every
   * time its screen renders.
   */
  function applyStaticStrings() {
    document.documentElement.lang = window.getLang();
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
    });
  }

  function renderLang() {
    ui.langOptions.querySelectorAll(".lang").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.dataset.lang === window.getLang());
    });
  }

  // The switcher only exists on the start screen, so a language change never has
  // to catch a game in flight: the start card is the whole re-render.
  function applyLang() {
    applyStaticStrings();
    renderLang();
    buildStartScreen();
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  // ---------- events ----------

  ui.langOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".lang");
    if (!btn || !window.setLang(btn.dataset.lang)) return;
    applyLang();
  });

  ui.poolOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pool");
    if (!btn) return;
    settings.pool = btn.dataset.pool;
    selectIn(ui.poolOptions, ".pool", btn);
    buildLinePicker();
    paintStartBtn();
    renderBest();
  });

  /**
   * Tick a line on or off. The shortlist is kept in plan order rather than in
   * click order, so picking B then D and picking D then B are the same setup -
   * which matters, because the list is part of the best-score key.
   */
  function toggleLine(kind, line) {
    const picked = settings.lines[kind];
    const at = picked.indexOf(line);
    if (at >= 0) picked.splice(at, 1);
    else picked.push(line);
    picked.sort(
      (a, b) => window.LINE_ORDER[kind].indexOf(a) - window.LINE_ORDER[kind].indexOf(b)
    );
  }

  ui.linePicker.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".linebadge");
    if (!btn) return;
    const { kind, line } = btn.dataset;
    toggleLine(kind, line);
    // Repaint the one badge rather than the whole roster: rebuilding would drop
    // keyboard focus off the badge that was just toggled.
    const picked = settings.lines[kind].includes(line);
    btn.classList.toggle("is-selected", picked);
    btn.setAttribute("aria-pressed", String(picked));
    afterLinesChanged();
  });

  ui.linesAll.addEventListener("click", () => {
    settings.lines = {
      metro: window.LINE_ORDER.metro.slice(),
      rer: window.LINE_ORDER.rer.slice(),
    };
    buildLinePicker();
    afterLinesChanged();
  });

  ui.linesNone.addEventListener("click", () => {
    settings.lines = { metro: [], rer: [] };
    buildLinePicker();
    afterLinesChanged();
  });

  function afterLinesChanged() {
    paintLinesNote();
    paintPoolBlurbs();
    paintStartBtn();
    renderBest();
  }

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

  ui.difficultyOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pill");
    if (!btn) return;
    settings.easy = !!btn.dataset.easy;
    selectIn(ui.difficultyOptions, ".pill", btn);
    ui.difficultyNote.hidden = !settings.easy;
    renderBest();
  });

  ui.timerOptions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pill");
    if (!btn) return;
    settings.timeLimit = btn.dataset.time ? Number(btn.dataset.time) : null;
    selectIn(ui.timerOptions, ".pill", btn);
    renderBest();
  });

  // The preview is a development tool: the flag keeps its entry point out of a
  // released start screen without deleting the sandbox.
  ui.demoBtn.hidden = !SHOW_BASEMAP_DEMO_OPTIONS;
  ui.demoBtn.addEventListener("click", openDemo);
  ui.demoClose.addEventListener("click", closeDemo);
  ui.demoPin.addEventListener("click", dropSample);
  ui.demoLayers.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pill");
    if (!btn) return;
    setBasemap(btn.dataset.basemap, { maxZoom: 20 });
    selectIn(ui.demoLayers, ".pill", btn);
    ui.demoNote.textContent = BASEMAPS[basemapKey].blurb;
    paintDemoZoom();
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
    hideNetwork();
    ui.hud.hidden = true;
    ui.actionbar.hidden = true;
    ui.map.classList.remove("is-guessing");
    ui.startScreen.hidden = false;
    buildStartScreen();
  });

  // Enter drives the whole loop so a round is click-map-then-Enter.
  document.addEventListener("keydown", (ev) => {
    if (!ui.demo.hidden) {
      // The preview owns the keyboard while it is up: Enter must not start a
      // game behind it, and Escape is the way out.
      if (ev.key === "Escape") closeDemo();
      return;
    }
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

  const missing = [
    !window.STATIONS || !window.STATIONS.length ? "build-stations.py" : null,
    !window.LINES || !window.LINES.length ? "build-lines.py" : null,
    !window.PARIS_BOUNDARY || !window.PARIS_BOUNDARY.length ? "build-paris.py" : null,
  ].filter(Boolean);

  // Untranslated on purpose: this screen is for whoever is running the repo, not
  // for a player - a player never sees it with the data files committed.
  if (missing.length) {
    document.body.innerHTML =
      '<div class="overlay"><div class="card"><h1>No map data</h1>' +
      "<p class=tagline>Run <code>python3 " +
      missing.join("</code> and <code>python3 ") +
      "</code> to fetch it.</p></div></div>";
    return;
  }

  initMap();
  applyLang();
})();
