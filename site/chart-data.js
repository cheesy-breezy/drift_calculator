/* Sample the calculator kernel, retaining unsupported intervals and provenance. */
(function (root, factory) {
  const core = typeof module === "object" && module.exports ? require("./core.js") : root.MagboltzCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MagboltzChartData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";
  const parameters = [
    { key: "electric_field_v_cm", label: "Электрическое поле", symbol: "E", unit: "В/см", value: "140", start: "120", stop: "160" },
    { key: "magnetic_field_t", label: "Магнитное поле", symbol: "B", unit: "Тл", value: "0", start: "0.475", stop: "0.525" },
    { key: "angle_deg", label: "Угол между полями", symbol: "α", unit: "°", value: "0", start: "0", stop: "1" },
    { key: "temperature_c", label: "Температура газа", symbol: "T", unit: "°C", value: "25", start: "22", stop: "26" },
  ];
  const quantities = [
    { key: "velocity_z_um_ns", label: "Продольная скорость v∥", symbol: "v∥", unit: "см/мкс", group: "Скорость" },
    ...["x", "y"].map(axis => ({ key: `drift_${axis}`, label: `Поперечная скорость v${axis}`, symbol: `v${axis}`, unit: "см/мкс", group: "Скорость" })),
    ...[["longitudinal", "Продольная", "Dₗ"], ["transverse", "Поперечная", "Dₜ"]].flatMap(([axis, label, symbol]) => [
      { key: `diffusion_${axis}`, label: `${label} диффузия ${symbol}`, symbol, unit: "см²/с", group: "Диффузия" },
      { key: `diffusion_${axis}_spread`, label: `${label} диффузия σ/√s`, symbol: "σ/√s", unit: "мкм/√см", group: "Диффузия" },
    ]),
    ...["xx", "yy", "zz", "xy", "xz", "yz"].map(axis => ({ key: `diffusion_${axis}`, label: `Компонента тензора D${axis}`, symbol: `D${axis}`, unit: "см²/с", group: "Тензор диффузии" })),
  ];
  const decimal = value => core.canonical(value);
  const numberText = value => decimal(Number(value.toPrecision(15)));
  function parameterValue(value, axis) {
    const text = decimal(value), number = Number(text);
    if (!Number.isFinite(number) || decimal(number) !== text) throw new Error("Параметр выходит за поддерживаемую численную точность.");
    if ((axis === 0 && number <= 0) || (axis === 1 && number < 0) || (axis === 2 && (number < 0 || number > 180)) || (axis === 3 && number <= -273.15)) {
      throw new Error("Допустимы E > 0, B ≥ 0, угол от 0° до 180°, T > −273,15 °C.");
    }
    return text;
  }
  function evenlySpaced(start, stop, count) {
    return Array.from({ length: count }, (_, i) => i === 0 ? start : i === count - 1 ? stop
      : numberText(Number(start) + (Number(stop) - Number(start)) * i / (count - 1)));
  }
  function normalize(request) {
    const axis = parameters.findIndex(p => p.key === request.xAxis);
    const family = request.seriesAxis ? parameters.findIndex(p => p.key === request.seriesAxis) : -1;
    const quantity = quantities.find(item => item.key === request.quantity);
    if (axis < 0 || (request.seriesAxis && family < 0) || family === axis || !quantity) throw new Error("Выберите одну величину и не более двух разных изменяемых параметров.");
    const values = parameters.map((parameter, i) => {
      const input = request.parameters[parameter.key];
      if (i !== axis && i !== family) return { value: parameterValue(input.value, i) };
      const start = parameterValue(input.start, i), stop = parameterValue(input.stop, i);
      if (core.compare(start, stop) >= 0) throw new Error(`Для «${parameter.label}» начало диапазона должно быть меньше конца.`);
      return { start, stop };
    });
    const series = family < 0 ? [null] : evenlySpaced(values[family].start, values[family].stop, 5);
    if (new Set(series).size !== series.length) throw new Error("Диапазон второго параметра слишком узкий для пяти разных значений.");
    return { axis, family, quantity, values, series };
  }
  function samples(context, query, axis, start, stop) {
    const critical = new Set([start, stop]);
    function add(value) { if (core.compare(start, value) <= 0 && core.compare(value, stop) <= 0) critical.add(value); }
    const key = parameters[axis].key;
    for (const point of [...context.points, ...(context.unavailable_points || [])]) {
      const coordinates = core.normalizeQuery({ ...query, [key]: point.coordinates[axis] });
      if (point.coordinates.every((value, i) => i === axis || value === coordinates[i])) add(point.coordinates[axis]);
    }
    for (const cell of context.cells) {
      const coordinates = core.normalizeQuery({ ...query, [key]: cell.lower[axis] });
      if (cell.lower.every((lo, i) => i === axis || (core.compare(lo, coordinates[i]) <= 0 && core.compare(coordinates[i], cell.upper[i]) <= 0))) {
        add(cell.lower[axis]); add(cell.upper[axis]);
      }
    }
    const boundaries = [...critical].sort(core.compare);
    const grid = new Set([...evenlySpaced(start, stop, 201), ...boundaries]);
    // Sample inside every interval bounded by a cell or observation. Even very
    // narrow uncovered gaps must produce nulls rather than connecting curves.
    boundaries.slice(1).forEach((right, i) => {
      const middle = numberText(Number(boundaries[i]) + (Number(right) - Number(boundaries[i])) / 2);
      if (core.compare(boundaries[i], middle) < 0 && core.compare(middle, right) < 0) grid.add(middle);
    });
    return [...grid].sort(core.compare);
  }
  function build(model, request) {
    const normalized = normalize(request), { axis, family, quantity, values, series } = normalized;
    const context = model.contexts.find(item => item.id === model.default_context_id);
    if (!context) throw new Error("Нет данных для газовой смеси калькулятора.");
    const base = Object.fromEntries(parameters.map((parameter, i) => [parameter.key, values[i].value || values[i].start]));
    const curves = series.map((seriesValue, index) => {
      const query = { ...base };
      if (family >= 0) query[parameters[family].key] = seriesValue;
      const points = samples(context, query, axis, values[axis].start, values[axis].stop).map(x => {
        const coordinates = { ...query, [parameters[axis].key]: x };
        const result = core.evaluate(model, coordinates);
        const item = quantity.key === "velocity_z_um_ns" ? { value: result.velocity_cm_us, ...result, origin: "longitudinal_velocity" }
          : result.transport[quantity.key];
        const value = result.source !== "Unavailable" && Number.isFinite(item?.value) ? item.value : null;
        const source = value === null ? "Unavailable" : result.source;
        const basis = quantity.key.endsWith("_spread") ? result.transport[quantity.key.slice(0, -7)] : item;
        const method = source === "Interpolated" ? basis?.interpolation_method || "multilinear" : "";
        return { x, value, source, coordinates, effectiveAngle: result.coordinates?.[2] ?? core.normalizeQuery(coordinates)[2],
          method, origin: item?.origin || "", supportRunIds: result.support_run_ids,
          reason: value === null ? result.reason || "quantity_unavailable" : "",
          measured: source === "Magboltz" && x === result.coordinates[axis] };
      });
      return { index: index + 1, seriesValue, points, available: points.filter(point => point.value !== null).length };
    });
    return { ...normalized, curves, conditions: context.conditions, generatedAt: model.generated_at };
  }
  function csv(dataset) {
    const headers = ["curve", ...parameters.map(p => p.key), "effective_angle_deg", "quantity", "unit", "value", "source",
      "interpolation_method", "quantity_origin", "unavailable_reason", "support_run_ids", "gas_mixture", "pressure_atm", "engine_version", "data_exported_at"];
    const escape = value => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const rows = [headers];
    for (const curve of dataset.curves) for (const point of curve.points) rows.push([
      curve.index, ...parameters.map(p => point.coordinates[p.key]), point.effectiveAngle,
      dataset.quantity.key, dataset.quantity.unit, point.value, point.source, point.method, point.origin, point.reason,
      point.supportRunIds.join("|"), JSON.stringify(dataset.conditions.gas_mixture), Number(dataset.conditions.pressure_torr) / 760,
      dataset.conditions.engine_version, dataset.generatedAt,
    ]);
    return "\ufeff" + rows.map(row => row.map(escape).join(",")).join("\r\n") + "\r\n";
  }
  return { parameters, quantities, normalize, build, csv };
});
