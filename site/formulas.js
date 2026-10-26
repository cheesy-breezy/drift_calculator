/* Descriptions use the recipe selected by the numerical kernel for each quantity. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MagboltzFormulas = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const axes = ["E", "B", "α", "T"];
  const units = ["В/см", "Тл", "°", "°C"];
  const symbols = { velocity_z_um_ns: "v∥", drift_x: "vₓ", drift_y: "vᵧ",
    diffusion_longitudinal: "Dₗ", diffusion_transverse: "Dₜ",
    diffusion_xx: "Dₓₓ", diffusion_yy: "Dᵧᵧ", diffusion_zz: "D𝓏𝓏",
    diffusion_xy: "Dₓᵧ", diffusion_xz: "Dₓ𝓏", diffusion_yz: "Dᵧ𝓏" };
  const names = { linear: "Линейная интерполяция", quadratic_hermite: "Кубическая интерполяция Эрмита",
    pchip: "Кубическая интерполяция с сохранением формы (PCHIP)", power_law: "Локальная степенная модель",
    log_hermite: "Интерполяция Эрмита в логарифмических координатах",
    log_pchip: "Логарифмическая интерполяция с сохранением формы (PCHIP)",
    small_angle: "Модель малых углов", drude: "Магнитная модель релаксации" };

  function describe(result, field = "velocity_z_um_ns") {
    if (result?.source !== "Interpolated") return null;
    const item = field === "velocity_z_um_ns" ? result : result.transport?.[field];
    if (!item) return null;
    if (field.endsWith("_spread")) {
      const base = describe(result, field.slice(0, -7));
      if (!base || item.origin !== "diffusion_speed_conversion") return null;
      return { title: "Диффузионное уширение", lines: [...base.lines, "σ/√s = 10⁴ √[2D / (10⁶ vₛ)]"],
        notes: [...base.notes, "D — в см²/с, vₛ — в см/мкс; результат — в мкм/√см.",
          result.diffusion_basis === "drift_velocity" ? "vₛ = √(v∥² + vₓ² + vᵧ²)." : "vₛ = v∥.",
          "Уширение вычислено из интерполированных D и скорости; отдельно не интерполируется."] };
    }
    const symbol = symbols[field] || "q";
    const recipe = item.interpolation_recipe;
    const lines = [], notes = [];
    let title;
    if (recipe) {
      title = names[recipe.method] || "Интерполяция";
      const x = { native: axes[recipe.axis], reduced_field: "ξ", log_reduced_field: "ln ξ",
        magnetic_squared: "(B Tₖ / 298,15)²", tan: "tan α", tan_squared: "tan² α" }[recipe.x];
      lines.push(`x = ${x}`);
      if (recipe.x.includes("reduced_field")) notes.push("ξ = (E / 140) · (Tₖ / 298,15); E — в В/см.");
      if (recipe.x.includes("reduced_field") || recipe.x === "magnetic_squared" || recipe.y === "log_density") notes.push("Tₖ = T + 273,15 — температура в кельвинах.");
      if (recipe.x === "magnetic_squared") notes.push("B — в Тл.");
      if (recipe.x.startsWith("tan")) notes.push("Угол α задан в градусах; тангенс вычисляется после перевода в радианы.");
      if (recipe.y === "log_density") {
        lines.push(`${symbol} = Tₖ exp[S(x)]`, `yᵢ = ln(${symbol}ᵢ / Tₖ,ᵢ)`);
      } else if (recipe.y === "inverse") {
        lines.push(`${symbol} = 1 / S(x)`, `yᵢ = 1 / ${symbol}ᵢ`);
      } else {
        lines.push(`${symbol} = S(x)`, `yᵢ = ${symbol}ᵢ`);
      }
      if (recipe.algorithm === "linear") lines.push("S(x) = (1 − u)yᵢ + u yᵢ₊₁");
      else {
        lines.push("S(x) = h₀₀ yᵢ + h₁₀ h mᵢ", "        + h₀₁ yᵢ₊₁ + h₁₁ h mᵢ₊₁",
          "h₀₀ = 2u³ − 3u² + 1;  h₁₀ = u³ − 2u² + u",
          "h₀₁ = −2u³ + 3u²;  h₁₁ = u³ − u²");
        notes.push(recipe.algorithm === "pchip"
          ? "mᵢ — производные PCHIP: ограничиваются для сохранения формы опорных данных."
          : "mᵢ — производные квадратичных полиномов через три соседние опорные точки.");
      }
      lines.push("u = (x − xᵢ) / h;  h = xᵢ₊₁ − xᵢ");
    } else {
      const active = result.cell.axes;
      title = active.length === 1 ? "Линейная интерполяция" : "Многомерная линейная интерполяция";
      if (active.length === 1) {
        const x = axes[active[0]];
        lines.push(`${symbol} = (1 − u)${symbol}₀ + u ${symbol}₁`, `u = (${x} − ${x}₀) / (${x}₁ − ${x}₀)`);
      } else {
        lines.push(`${symbol} = Σᵥ ${symbol}ᵥ · ∏ₐ wᵥ,ₐ`, "uₐ = (Xₐ − Xₐ,₀) / (Xₐ,₁ − Xₐ,₀)",
          "wᵥ,ₐ = 1 − uₐ на нижней грани; uₐ — на верхней");
        notes.push(`Xₐ: ${active.map(axis => axes[axis]).join(", ")}; сумма — по вершинам ячейки.`);
      }
      if (item.origin === "tensor_projection") lines.push(field === "diffusion_longitudinal"
        ? "Dₗ = D𝓏𝓏" : "Dₜ = (Dₓₓ + Dᵧᵧ) / 2");
    }
    const bounds = result.cell.axes.map(axis => `${axes[axis]}: ${result.cell.lower[axis]}–${result.cell.upper[axis]} ${units[axis]}`);
    notes.push("Индексы обозначают опорные расчёты Magboltz.", `Интервал: ${bounds.join("; ").replaceAll(".", ",")}.`);
    return { title, lines, notes };
  }
  return { describe };
});
