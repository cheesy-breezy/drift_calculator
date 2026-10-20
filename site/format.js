/* Display rounding only; exported data and numerical calculations keep full precision. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MagboltzDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function number(value, significantDigits = 5) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    const magnitude = Math.floor(Math.log10(Math.abs(value)));
    if (value !== 0 && (magnitude < -4 || magnitude > 6)) return value.toExponential(significantDigits - 1).replace(".", ",").replace("e+", "e");
    return (value === 0 ? 0 : value).toLocaleString("ru-RU", {
      minimumSignificantDigits: significantDigits,
      maximumSignificantDigits: significantDigits,
    });
  }
  return { number };
});
