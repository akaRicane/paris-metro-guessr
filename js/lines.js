// Official Ile-de-France Mobilites line colours.
// Some pairs genuinely share a colour in the real palette (3bis/13, 6/7bis).
window.LINE_COLORS = {
  metro: {
    "1": "#FFCE00",
    "2": "#0064B0",
    "3": "#9F9825",
    "3bis": "#98D4E2",
    "4": "#C04191",
    "5": "#F28E42",
    "6": "#83C491",
    "7": "#F3A4BA",
    "7bis": "#83C491",
    "8": "#CEADD2",
    "9": "#D5C900",
    "10": "#E3B32A",
    "11": "#8D5E2A",
    "12": "#00814F",
    "13": "#98D4E2",
    "14": "#662483",
  },
  rer: {
    A: "#E3051C",
    B: "#5291CE",
    C: "#FFCE00",
    D: "#00814F",
    E: "#A0006E",
  },
};

// Pale line colours (M1 yellow, M8 lilac) need dark text; deep ones need white.
// Relative luminance per WCAG, so the badge stays readable without a lookup table.
window.textOn = function (hex) {
  const channel = (v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(channel);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.42 ? "#1a1a1a" : "#ffffff";
};
