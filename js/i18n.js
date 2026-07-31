// Interface strings, in English and French. No DOM: this file is a dictionary
// plus four helpers, so the rules layer can hand display keys around without
// ever holding prose.
//
// Station and line names are never in here. They are French proper nouns in
// both locales - and they are the answer to the game.

(function () {
  "use strict";

  const LANG_KEY = "paris-metro-guessr.lang";

  // Number formatting locale per language: "20,000" against "20 000", and the
  // decimal comma French wants in "1,45 km".
  const LOCALES = { en: "en", fr: "fr-FR" };

  const PLURAL = {
    en: (n) => (Math.abs(n) === 1 ? "one" : "other"),
    // French keeps the singular through zero: "0 station", "2 stations".
    fr: (n) => (Math.abs(n) < 2 ? "one" : "other"),
  };

  window.STRINGS = {
    en: {
      // start screen
      "start.tagline":
        "A station is named. Pin it on the map. The closer you land, the more you score.",
      "start.play": "Start playing",
      "start.demo": "Preview basemaps",
      "start.fineprint":
        "Station data from Île-de-France Mobilités open data (ODbL). The basemap " +
        "deliberately carries no place labels.",
      "legend.network": "Network",
      "legend.rounds": "Rounds",
      "legend.difficulty": "Difficulty",
      "legend.timer": "Time per round",

      // network pools
      "pool.metro.label": "Métro",
      "pool.metro.blurb": "Paris and the inner suburbs",
      "pool.rer.label": "RER only",
      "pool.rer.blurb": "the whole région, out to Cergy and Melun",
      "pool.all.label": "Everything",
      "pool.all.blurb": "métro and RER combined",
      "pool.count.one": "{count} station",
      "pool.count.other": "{count} stations",

      // rounds and deathmatch
      "rounds.deathmatch": "Deathmatch",
      "variant.standard": "Standard",
      "variant.burn": "Burn",
      "variant.note.standard":
        "{hp} life points. Every round costs you the points you missed — a " +
        "perfect pin is free, a wild one is {max}. Last as long as you can.",
      "variant.note.burn":
        "{hp} life points, draining {drain} every second. The miss still costs " +
        "you the same, but answering a station pays {restore} back. Pin well, " +
        "and quickly.",

      // difficulty and clock
      "difficulty.standard": "Standard",
      "difficulty.easy": "Easy",
      "difficulty.note":
        "The network is drawn on the map while you guess. You still have to " +
        "know which station is which, but the lines tell you where to look.",
      "timer.none": "No limit",

      // best score
      "best.score": "Best on this setup: {score} / {max} ({pct}%)",
      "best.dm.one": "Best on this setup: survived {count} station",
      "best.dm.other": "Best on this setup: survived {count} stations",

      // HUD
      "hud.round": "Round {n} / {total}",
      "hud.station": "Station {n}",
      "hud.points": "{n} pts",
      // A bare unit: it is appended to the tally and to the per-round delta.
      "unit.hp": "HP",
      "hud.quit": "Quit",
      "hud.quitTitle": "Abandon this game",

      // round flow
      "hint.place": "Click the map to drop your pin.",
      "hint.placed": "Drop again to move it, or lock in your guess.",
      "confirm.guess": "Guess",
      "confirm.next": "Next station",
      "confirm.burntOut": "Burnt out",
      "confirm.died": "You died",
      "confirm.results": "See results",
      "result.noGuess": "no guess",

      // ratings - keys travel through game state, so they are resolved on render
      "rating.bangOn": "Bang on",
      "rating.superb": "Superb",
      "rating.excellent": "Excellent",
      "rating.solid": "Solid",
      "rating.notBad": "Not bad",
      "rating.wide": "Wide",
      "rating.lost": "Lost",
      "rating.wrongArrondissement": "Wrong arrondissement entirely",
      "rating.outOfTime": "Out of time",
      "rating.burntOut": "Burnt out",

      // end screen
      "end.title.final": "Final score",
      "end.title.burnt": "You burnt out",
      "end.title.died": "You died",
      "end.title.cleared": "You cleared the network",
      "end.outOf": "/ {max}",
      "end.stations.one": "station",
      "end.stations.other": "stations",
      "end.again": "Play again",
      "bd.outOfTime": "out of time",
      "bd.average": "Average miss",
      "bd.averageTimedOut": "Average miss ({count} timed out)",

      // verdicts, scored game
      "verdict.90": "You are the map. Do you drive a 96 bus?",
      "verdict.75": "Genuinely strong. You know this network.",
      "verdict.55": "Good instincts, shaky on the outskirts.",
      "verdict.35": "You know the centre. The suburbs know you don't.",
      "verdict.15": "Right city, at least.",
      "verdict.0": "Consider buying a paper map.",

      // verdicts, deathmatch
      "verdict.dm.standard.50": "Fifty stations deep. You are the map.",
      "verdict.dm.standard.30": "A serious run. The suburbs didn't scare you.",
      "verdict.dm.standard.18": "Strong. You died somewhere past the périph.",
      "verdict.dm.standard.10": "Respectable. Two bad pins cost you the run.",
      "verdict.dm.standard.5": "Bled out early. The outskirts got you.",
      "verdict.dm.standard.0": "Barely left Châtelet.",
      "verdict.dm.burn.30": "Thirty under the drain. Frightening.",
      "verdict.dm.burn.18": "Fast and accurate. Very few last this long.",
      "verdict.dm.burn.12": "Strong run — you were still gaining ground on the clock.",
      "verdict.dm.burn.7": "Solid. The drain caught you in the suburbs.",
      "verdict.dm.burn.4": "The clock beat you before the map did.",
      "verdict.dm.burn.0": "Burnt out at the gates.",

      // basemap preview (development tool; the per-basemap blurbs stay English)
      "demo.title": "Basemap preview",
      "demo.back": "Back",
      "demo.pin": "Drop a sample reveal",
      "demo.hint":
        "Zoom past z17 and pan around: any style that prints a station name is " +
        "unusable. Esc goes back.",
    },

    fr: {
      "start.tagline":
        "Une station est annoncée. Pose-la sur la carte. Plus tu tombes près, plus tu marques.",
      "start.play": "Commencer",
      "start.demo": "Aperçu des fonds de carte",
      "start.fineprint":
        "Données stations : open data Île-de-France Mobilités (ODbL). Le fond " +
        "de carte ne porte volontairement aucun nom de lieu.",
      "legend.network": "Réseau",
      "legend.rounds": "Manches",
      "legend.difficulty": "Difficulté",
      "legend.timer": "Temps par manche",

      "pool.metro.label": "Métro",
      "pool.metro.blurb": "Paris et la petite couronne",
      "pool.rer.label": "RER seul",
      "pool.rer.blurb": "toute la région, jusqu'à Cergy et Melun",
      "pool.all.label": "Tout",
      "pool.all.blurb": "métro et RER réunis",
      "pool.count.one": "{count} station",
      "pool.count.other": "{count} stations",

      "rounds.deathmatch": "Deathmatch",
      "variant.standard": "Standard",
      "variant.burn": "Brûlure",
      "variant.note.standard":
        "{hp} points de vie. Chaque manche te coûte les points que tu n'as pas " +
        "marqués — un pion parfait est gratuit, un pion à côté coûte {max}. " +
        "Tiens le plus longtemps possible.",
      "variant.note.burn":
        "{hp} points de vie, qui fondent de {drain} par seconde. L'erreur coûte " +
        "toujours autant, mais répondre à une station t'en rend {restore}. Vise " +
        "juste, et vite.",

      "difficulty.standard": "Standard",
      "difficulty.easy": "Facile",
      "difficulty.note":
        "Le réseau est dessiné sur la carte pendant que tu joues. Il faut " +
        "toujours savoir quelle station est laquelle, mais les lignes te disent " +
        "où chercher.",
      "timer.none": "Sans limite",

      "best.score": "Meilleur sur ce réglage : {score} / {max} ({pct} %)",
      "best.dm.one": "Meilleur sur ce réglage : {count} station tenue",
      "best.dm.other": "Meilleur sur ce réglage : {count} stations tenues",

      "hud.round": "Manche {n} / {total}",
      "hud.station": "Station {n}",
      "hud.points": "{n} pts",
      "unit.hp": "PV",
      "hud.quit": "Quitter",
      "hud.quitTitle": "Abandonner la partie",

      "hint.place": "Clique sur la carte pour poser ton pion.",
      "hint.placed": "Clique ailleurs pour le déplacer, ou valide ta réponse.",
      "confirm.guess": "Deviner",
      "confirm.next": "Station suivante",
      "confirm.burntOut": "Grillé",
      "confirm.died": "Tu es mort",
      "confirm.results": "Voir les résultats",
      "result.noGuess": "sans réponse",

      "rating.bangOn": "Pile dessus",
      "rating.superb": "Superbe",
      "rating.excellent": "Excellent",
      "rating.solid": "Solide",
      "rating.notBad": "Pas mal",
      "rating.wide": "Large",
      "rating.lost": "Perdu",
      "rating.wrongArrondissement": "Même pas le bon arrondissement",
      "rating.outOfTime": "Temps écoulé",
      "rating.burntOut": "Grillé",

      "end.title.final": "Score final",
      "end.title.burnt": "Tu as grillé",
      "end.title.died": "Tu es mort",
      "end.title.cleared": "Tu as bouclé le réseau",
      "end.outOf": "/ {max}",
      "end.stations.one": "station",
      "end.stations.other": "stations",
      "end.again": "Rejouer",
      "bd.outOfTime": "temps écoulé",
      "bd.average": "Erreur moyenne",
      "bd.averageTimedOut": "Erreur moyenne ({count} hors délai)",

      "verdict.90": "Tu es le plan. Tu conduis le 96 ?",
      "verdict.75": "Vraiment solide. Tu connais ce réseau.",
      "verdict.55": "Du flair, mais ça flanche dès la banlieue.",
      "verdict.35": "Tu connais le centre. La banlieue sait bien que non.",
      "verdict.15": "La bonne ville, au moins.",
      "verdict.0": "Pense à acheter un plan papier.",

      "verdict.dm.standard.50": "Cinquante stations au compteur. Tu es le plan.",
      "verdict.dm.standard.30": "Une sacrée course. La banlieue ne t'a pas fait peur.",
      "verdict.dm.standard.18": "Costaud. Tu es tombé quelque part après le périph.",
      "verdict.dm.standard.10": "Honorable. Deux mauvais pions t'ont coûté la partie.",
      "verdict.dm.standard.5": "Vidé trop tôt. La banlieue a eu ta peau.",
      "verdict.dm.standard.0": "Tu n'as pas vraiment quitté Châtelet.",
      "verdict.dm.burn.30": "Trente sous la fonte. Effrayant.",
      "verdict.dm.burn.18": "Vite et juste. Très peu tiennent aussi longtemps.",
      "verdict.dm.burn.12": "Belle course — tu gagnais encore du terrain sur le chrono.",
      "verdict.dm.burn.7": "Solide. La fonte t'a rattrapé en banlieue.",
      "verdict.dm.burn.4": "Le chrono t'a battu avant la carte.",
      "verdict.dm.burn.0": "Grillé dès la sortie.",

      "demo.title": "Aperçu des fonds de carte",
      "demo.back": "Retour",
      "demo.pin": "Poser un exemple de révélation",
      "demo.hint":
        "Zoome au-delà de z17 et déplace-toi : tout style qui affiche un nom de " +
        "station est inutilisable. Échap pour revenir.",
    },
  };

  // Stored choice first, then the browser's preference, then English.
  function detect() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && window.STRINGS[saved]) return saved;
    } catch {
      /* private browsing - fall through to the browser preference */
    }
    return String(navigator.language || "").toLowerCase().startsWith("fr") ? "fr" : "en";
  }

  let lang = detect();

  function fill(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name) =>
      name in params ? params[name] : whole
    );
  }

  /**
   * Resolve a key in the current language. Falls back to English, then to the
   * key itself, so a missing translation degrades to something readable rather
   * than to "undefined". Pass `count` to pick between the `.one` and `.other`
   * variants of a key.
   */
  window.t = function (key, params) {
    const candidates =
      params && typeof params.count === "number"
        ? [`${key}.${PLURAL[lang](params.count)}`, key]
        : [key];
    const template =
      candidates
        .map((k) => window.STRINGS[lang][k] ?? window.STRINGS.en[k])
        .find((v) => v !== undefined) ?? key;
    return fill(template, params);
  };

  window.fmtNum = (n) => Number(n).toLocaleString(LOCALES[lang]);
  window.numberLocale = () => LOCALES[lang];
  window.getLang = () => lang;

  /** Returns false for an unknown language, so a stale link can't blank the UI. */
  window.setLang = function (next) {
    if (!window.STRINGS[next]) return false;
    lang = next;
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* storage unavailable - the choice just won't persist */
    }
    return true;
  };
})();
