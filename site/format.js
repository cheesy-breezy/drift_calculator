/* Display rounding only; exported data and numerical calculations keep full precision. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MagboltzDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function number(value, errorPercent = null, significantDigits = 4) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    if (value === 0) return "0";
    const magnitude = Math.floor(Math.log10(Math.abs(value)));
    let place = magnitude - significantDigits + 1;
    if (typeof errorPercent === "number" && Number.isFinite(errorPercent) && errorPercent > 0) {
      const absolute = Math.abs(value) * errorPercent / 100;
      if (absolute > 0 && Number.isFinite(absolute)) place = Math.max(place, Math.floor(Math.log10(absolute)) - 1);
    }
    const digits = Math.max(1, Math.min(significantDigits, magnitude - place + 1));
    if (magnitude < -4 || magnitude > 6) return value.toExponential(digits - 1).replace(".", ",").replace("e+", "e");
    const decimals = Math.max(0, -place);
    const scale = 10 ** place;
    const rounded = place > 0 ? Math.sign(value) * Math.round(Math.abs(value) / scale) * scale : value;
    return rounded.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  return { number };
});
