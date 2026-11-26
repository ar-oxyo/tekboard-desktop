// Runs before the first paint (a classic script in <head>, allowed by the CSP as 'self'):
// the last design, mode, animation and density choices, so the launch screen and the first
// frame already look right. Mirrors written by the app (lib/appearance.ts, lib/hooks.ts).
(function () {
  try {
    var root = document.documentElement;
    var store = window.localStorage;
    var theme = store.getItem("tekboard.theme") || "aurora";
    var mode = store.getItem("tekboard.colorMode") || "dark";
    var hasLight = ["aurora", "sauge", "ardoise", "prune", "sumi"].indexOf(theme) >= 0;
    var dark = !hasLight || (mode === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : mode !== "light");
    root.dataset.theme = theme;
    root.dataset.mode = dark ? "dark" : "light";
    root.style.colorScheme = dark ? "dark" : "light";
    if (store.getItem("tekboard.motion") === "off") root.dataset.motion = "off";
    if (store.getItem("tekboard.lite") === "on") root.dataset.lite = "on";
  } catch (e) {
    // No storage: the defaults of index.html apply.
  }
})();
