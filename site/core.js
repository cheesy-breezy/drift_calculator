/* Numerical kernel shared by the static browser page and Node.js parity tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MagboltzCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const AXES = ["electric_field_v_cm", "magnetic_field_t", "angle_deg", "temperature_c"];

  function canonical(value) {
    if ((typeof value !== "string" && typeof value !== "number") || String(value).length > 128) throw new Error("Invalid decimal");
    const raw = String(value).trim().replace(/[dD]/g, "e");
    const match = /^([+-]?)(\d*(?:\.\d*)?)(?:[eE]([+-]?\d+))?$/.exec(raw);
    if (!match || !/\d/.test(match[2])) throw new Error("Invalid decimal");
    const exponent = Number(match[3] || 0);
    if (!Number.isFinite(exponent) || Math.abs(exponent) > 400) throw new Error("Decimal outside range");
    const parts = match[2].split(".");
    let digits = parts.join("");
    let position = parts[0].length + exponent;
    if (position <= 0) digits = "0." + "0".repeat(-position) + digits;
    else if (position >= digits.length) digits += "0".repeat(position - digits.length);
    else digits = digits.slice(0, position) + "." + digits.slice(position);
    let [integer, fraction = ""] = digits.split(".");
    integer = integer.replace(/^0+/, "") || "0";
    fraction = fraction.replace(/0+$/, "");
    const result = integer + (fraction ? "." + fraction : "");
    return result === "0" ? "0" : (match[1] === "-" ? "-" : "") + result;
  }

  function compare(left, right) {
    if (left === right) return 0;
    const ln = left[0] === "-", rn = right[0] === "-";
    if (ln !== rn) return ln ? -1 : 1;
    const a = (ln ? left.slice(1) : left).split("."), b = (rn ? right.slice(1) : right).split(".");
    let result = a[0].length - b[0].length;
    if (!result && a[0] !== b[0]) result = a[0] < b[0] ? -1 : 1;
    if (!result) {
      const length = Math.max((a[1] || "").length, (b[1] || "").length);
      const af = (a[1] || "").padEnd(length, "0"), bf = (b[1] || "").padEnd(length, "0");
      result = af === bf ? 0 : af < bf ? -1 : 1;
    }
    return (ln ? -1 : 1) * Math.sign(result);
  }

  function normalizeQuery(query) {
    const coordinates = AXES.map((name, axis) => axis === 2 ? "0" : canonical(query[name]));
    coordinates[2] = coordinates[1] === "0" ? "0" : canonical(query.angle_deg === undefined ? 0 : query.angle_deg);
    if (compare(coordinates[0], "0") <= 0 || compare(coordinates[1], "0") < 0) throw new Error("E must be positive and B nonnegative");
    if (compare(coordinates[3], "-273.15") <= 0 || compare(coordinates[2], "0") < 0 || compare(coordinates[2], "180") > 0) throw new Error("Invalid temperature or angle");
    if (!coordinates.every(value => Number.isFinite(Number(value)))) throw new Error("Input outside numerical range");
    return coordinates;
  }

  function strictNumber(value) {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error("Number required");
    if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(String(value).trim())) throw new Error("Decimal number required");
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error("Finite number required");
    return result;
  }

  function driftTime(velocity, length = 165) {
    velocity = strictNumber(velocity); length = strictNumber(length);
    if (velocity <= 0 || length < 0) throw new Error("Positive velocity and nonnegative length required");
    const result = length / velocity;
    if (!Number.isFinite(result)) throw new Error("Time outside numerical range");
    return result;
  }

  const transportUnits = Object.fromEntries([
    ...["x", "y"].map(axis => [`drift_${axis}`, "micron/ns"]),
    ...["xx", "yy", "zz", "xy", "xz", "yz", "longitudinal", "transverse"].map(axis => [`diffusion_${axis}`, "cm2/s"]),
    ...["longitudinal", "transverse"].map(axis => [`diffusion_${axis}_spread`, "micron/sqrt(cm)"]),
  ]);
  const signed = new Set(["drift_x", "drift_y", "diffusion_xy", "diffusion_xz", "diffusion_yz"]);
  const finite = value => typeof value === "number" && Number.isFinite(value);

  function interpolateTransport(points, cell, coordinates) {
    const fractions = cell.axes.map(axis => (Number(coordinates[axis]) - Number(cell.lower[axis])) / (Number(cell.upper[axis]) - Number(cell.lower[axis])));
    const weights = cell.corners.map(index => {
      let weight = 1;
      cell.axes.forEach((axis, i) => { weight *= points[index].coordinates[axis] === cell.upper[axis] ? fractions[i] : 1 - fractions[i]; });
      return weight;
    });
    const result = {};
    for (const [name, unit] of Object.entries(transportUnits)) {
      if (name.endsWith("_spread")) continue; // Convert interpolated D and v consistently.
      const items = cell.corners.map(index => (points[index].transport || {})[name]);
      if (items.some(item => !item || !finite(item.value) || item.unit !== unit || (!signed.has(name) && item.value < 0))) continue;
      result[name] = { value: items.reduce((sum, item, i) => sum + weights[i] * item.value, 0), unit,
        statistical_error_percent: null, origin: "interpolated" };
    }
    return result;
  }

  function finishTransport(raw, coordinates, velocity) {
    const quantities = {};
    for (const [name, original] of Object.entries(raw)) {
      if (!finite(original.value) || (!signed.has(name) && original.value < 0)) continue;
      const item = { ...original };
      if (name === "drift_x" || name === "drift_y") { item.value *= 0.1; item.unit = "cm/us"; }
      quantities[name] = item;
    }
    function derived(name, value, unit, origin) {
      if (finite(value) && value >= 0) quantities[name] = { value, unit, statistical_error_percent: null, origin };
    }
    const native = ["longitudinal", "transverse"].some(axis => quantities[`diffusion_${axis}`]);
    const basis = native && coordinates[1] !== "0" && coordinates[2] === "90" ? "drift_velocity" : "electric_field";
    if (!native) {
      if (quantities.diffusion_zz) quantities.diffusion_longitudinal = { ...quantities.diffusion_zz, origin: "tensor_projection" };
      if (quantities.diffusion_xx && quantities.diffusion_yy) derived("diffusion_transverse", (quantities.diffusion_xx.value + quantities.diffusion_yy.value) / 2, "cm2/s", "tensor_projection");
    }
    const speed = basis === "drift_velocity"
      ? quantities.drift_x && quantities.drift_y ? Math.hypot(velocity, quantities.drift_x.value, quantities.drift_y.value) : null
      : velocity;
    for (const axis of ["longitudinal", "transverse"]) {
      const name = `diffusion_${axis}`;
      if (quantities[name] && !quantities[`${name}_spread`] && speed > 0) derived(`${name}_spread`, Math.sqrt(2 * quantities[name].value / (speed * 1e6)) * 1e4, "micron/sqrt(cm)", "diffusion_speed_conversion");
    }
    const tensor = ["xx", "yy", "zz", "xy", "xz", "yz"].map(axis => quantities[`diffusion_${axis}`]);
    let status = "incomplete";
    if (tensor.every(Boolean)) {
      const scale = Math.max(...tensor.map(item => Math.abs(item.value))) || 1;
      const [a, b, c, d, e, f] = tensor.map(item => item.value / scale);
      const minors = [a, b, c, a*b-d*d, a*c-e*e, b*c-f*f, a*b*c+2*d*e*f-a*f*f-b*e*e-c*d*d];
      status = Math.min(...minors) >= -1e-10 ? "positive_semidefinite" : "not_positive_semidefinite";
    }
    return { transport: quantities, diffusion_basis: basis, tensor_status: status };
  }

  function curveField(point, field) {
    if (field === "velocity_z_um_ns") return point[field];
    const item = point.transport?.[field], unit = field.startsWith("drift_") ? "micron/ns" : "cm2/s";
    return item?.unit === unit ? item.value : null;
  }
  function curveX(coordinates, axis, transform) {
    if (transform === "native") return Number(coordinates[axis]);
    const temperature = Number(coordinates[3]) + 273.15;
    if (transform === "reduced_field" || transform === "log_reduced_field") {
      const value = Number(coordinates[0]) * temperature / (140 * 298.15);
      return transform === "log_reduced_field" ? Math.log(value) : value;
    }
    if (transform === "magnetic_squared") return (Number(coordinates[1]) * temperature / 298.15) ** 2;
    const tangent = Math.tan(Number(coordinates[2]) * Math.PI / 180);
    return transform === "tan_squared" ? tangent ** 2 : tangent;
  }
  function curveSlopes(x, y, algorithm) {
    const n = x.length;
    const h = x.slice(1).map((value, i) => value - x[i]);
    const s = h.map((value, i) => (y[i + 1] - y[i]) / value);
    if (n === 2) return [s[0], s[0]];
    if (algorithm === "hermite") {
      const d = [((2 * h[0] + h[1]) * s[0] - h[0] * s[1]) / (h[0] + h[1])];
      for (let i = 1; i < n - 1; i++) d.push((h[i] * s[i - 1] + h[i - 1] * s[i]) / (h[i - 1] + h[i]));
      d.push(((2 * h[n - 2] + h[n - 3]) * s[n - 2] - h[n - 2] * s[n - 3]) / (h[n - 2] + h[n - 3]));
      return d;
    }
    const d = Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) if (s[i - 1] * s[i] > 0) {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / s[i - 1] + w2 / s[i]);
    }
    for (const [i, a, b, sa, sb] of [[0, h[0], h[1], s[0], s[1]], [n - 1, h[n - 2], h[n - 3], s[n - 2], s[n - 3]]]) {
      let slope = ((2 * a + b) * sa - a * sb) / (a + b);
      if (slope * sa <= 0) slope = 0;
      else if (sa * sb < 0 && Math.abs(slope) > 3 * Math.abs(sa)) slope = 3 * sa;
      d[i] = slope;
    }
    return d;
  }
  function curveSpline(x, y, q, algorithm) {
    if (x.length < 2 || q < x[0] || q > x[x.length - 1] || x.some((value, i) => i && value <= x[i - 1])) throw new Error("Invalid curve support");
    let i = 0;
    while (i < x.length - 2 && x[i + 1] <= q) i++;
    const h = x[i + 1] - x[i], t = (q - x[i]) / h;
    if (algorithm === "linear" || x.length === 2) return y[i] * (1 - t) + y[i + 1] * t;
    const d = curveSlopes(x, y, algorithm);
    return (2*t**3-3*t**2+1)*y[i] + (t**3-2*t**2+t)*h*d[i] + (-2*t**3+3*t**2)*y[i+1] + (t**3-t**2)*h*d[i+1];
  }
  function curvePredict(points, curve, coordinates) {
    const { recipe, axis, field } = curve;
    const x = [], y = [];
    for (const i of curve.indices) {
      const point = points[i];
      let value = curveField(point, field);
      if (!finite(value)) throw new Error("Invalid curve support");
      x.push(curveX(point.coordinates, axis, recipe.x));
      if (recipe.y === "log_density") value = Math.log(value / (Number(point.coordinates[3]) + 273.15));
      else if (recipe.y === "inverse") value = 1 / value;
      y.push(value);
    }
    let value = curveSpline(x, y, curveX(coordinates, axis, recipe.x), recipe.algorithm);
    if (recipe.y === "log_density") value = Math.exp(value) * (Number(coordinates[3]) + 273.15);
    else if (recipe.y === "inverse") value = 1 / value;
    if (!finite(value) || (field === "velocity_z_um_ns" && value <= 0) || (field.startsWith("diffusion") && value < 0)) throw new Error("Nonphysical curve prediction");
    return value;
  }
  function curveValues(context, cell, coordinates) {
    if (cell.axes.length !== 1) return {};
    const axis = cell.axes[0], fixed = coordinates.filter((value, i) => i !== axis), result = {};
    for (const curve of context.curves || []) {
      if (curve.axis !== axis || JSON.stringify(curve.fixed_coordinates) !== JSON.stringify(fixed) || !cell.corners.every(i => curve.indices.includes(i))) continue;
      if (curve.field.startsWith("diffusion") && cell.corners.every(i => ["xx", "yy", "zz", "xy", "xz", "yz"].every(name => context.points[i].transport?.[`diffusion_${name}`]))) continue;
      if (!curve.accuracy || (curve.recipe.method === "linear" && curve.accuracy.sample_count < 2)) continue;
      result[curve.field] = { value: curvePredict(context.points, curve, coordinates), curve };
    }
    return result;
  }
  function curveAccuracy(curve) {
    return Object.fromEntries(Object.entries(curve.accuracy).filter(([name]) => name !== "samples"));
  }

  function evaluate(model, query, options = {}) {
    const unavailable = { source: "Unavailable", velocity_cm_us: null, drift_time_us: null,
      statistical_error_percent: null, interpolation_accuracy: null, support_run_ids: [], transport: {} };
    let coordinates, length;
    try {
      coordinates = normalizeQuery(query);
      length = strictNumber(options.length_cm === undefined ? 165 : options.length_cm);
      if (length < 0) throw new Error("Drift length must be nonnegative");
    } catch (error) { return { ...unavailable, reason: "invalid_input", message: error.message }; }
    const context = model.contexts.find(item => item.id === (options.context_id || model.default_context_id));
    if (!context) return { ...unavailable, reason: "context_unavailable" };
    const key = coordinates.join("|");
    const exact = context.points.find(point => point.coordinates.join("|") === key);
    if (exact) {
      try {
        const velocity = strictNumber(exact.velocity_z_um_ns) * 0.1;
        return { source: "Magboltz", velocity_cm_us: velocity, drift_time_us: driftTime(velocity, length),
          statistical_error_percent: exact.statistical_error_percent, interpolation_accuracy: null,
          support_run_ids: [exact.run_id], coordinates, provenance_warning: exact.provenance_warning || null,
          ...finishTransport(exact.transport || {}, coordinates, velocity) };
      } catch (_) { return { ...unavailable, reason: "invalid_velocity" }; }
    }
    if ((context.unavailable_points || []).some(point => point.coordinates.join("|") === key)) return { ...unavailable, reason: "invalid_velocity" };
    if (coordinates.some(value => canonical(Number(value)) !== value)) return { ...unavailable, reason: "unsupported_precision" };
    const candidates = context.cells.filter(cell => cell.lower.every((lo, axis) => compare(lo, coordinates[axis]) <= 0 && compare(coordinates[axis], cell.upper[axis]) <= 0));
    candidates.sort((a, b) => {
      if (a.axes.length !== b.axes.length) return a.axes.length - b.axes.length;
      if (a.score !== b.score) return a.score - b.score;
      const al = a.lower.join("|"), bl = b.lower.join("|"), au = a.upper.join("|"), bu = b.upper.join("|");
      return al !== bl ? (al < bl ? -1 : 1) : au === bu ? 0 : au < bu ? -1 : 1;
    });
    if (!candidates.length) return { ...unavailable, reason: "outside_supported_cells" };
    const cell = candidates[0];
    const fractions = cell.axes.map(axis => (Number(coordinates[axis]) - Number(cell.lower[axis])) / (Number(cell.upper[axis]) - Number(cell.lower[axis])));
    let value = 0;
    for (const index of cell.corners) {
      const point = context.points[index];
      if (typeof point.velocity_z_um_ns !== "number" || !Number.isFinite(point.velocity_z_um_ns) || point.velocity_z_um_ns <= 0) return { ...unavailable, reason: "invalid_velocity" };
      let weight = 1;
      cell.axes.forEach((axis, i) => { weight *= point.coordinates[axis] === cell.upper[axis] ? fractions[i] : 1 - fractions[i]; });
      value += weight * point.velocity_z_um_ns;
    }
    let velocity = value * 0.1, curves;
    let time;
    try {
      curves = curveValues(context, cell, coordinates);
      if (curves.velocity_z_um_ns) velocity = curves.velocity_z_um_ns.value * 0.1;
      time = driftTime(velocity, length);
    }
    catch (_) { return { ...unavailable, reason: "invalid_velocity" }; }
    const active = cell.axes.filter(axis => compare(cell.lower[axis], coordinates[axis]) < 0 && compare(coordinates[axis], cell.upper[axis]) < 0);
    const validation = context.validation.find(item => item.region_id === cell.region_id && JSON.stringify(item.axes) === JSON.stringify(active));
    let accuracy = validation ? Object.fromEntries(Object.entries(validation).filter(([name]) => name !== "samples")) : { method: "not_assessed", sample_count: 0, is_error_bound: false };
    let method = "multilinear", recipe = null;
    if (curves.velocity_z_um_ns) {
      accuracy = curveAccuracy(curves.velocity_z_um_ns.curve);
      method = curves.velocity_z_um_ns.curve.recipe.method;
      recipe = { ...curves.velocity_z_um_ns.curve.recipe, axis: curves.velocity_z_um_ns.curve.axis };
    }
    const support = new Set(cell.corners), transport = interpolateTransport(context.points, cell, coordinates);
    for (const [field, prediction] of Object.entries(curves)) {
      prediction.curve.indices.forEach(i => support.add(i));
      if (transport[field]) transport[field] = { ...transport[field], value: prediction.value,
        interpolation_method: prediction.curve.recipe.method,
        interpolation_recipe: { ...prediction.curve.recipe, axis: prediction.curve.axis },
        interpolation_accuracy: curveAccuracy(prediction.curve) };
    }
    return { source: "Interpolated", velocity_cm_us: velocity, drift_time_us: time, statistical_error_percent: null,
      interpolation_accuracy: accuracy, interpolation_method: method, interpolation_recipe: recipe,
      support_run_ids: [...support].sort((a, b) => a - b).map(i => context.points[i].run_id), coordinates, cell,
      ...finishTransport(transport, coordinates, velocity) };
  }
  return { AXES, canonical, compare, normalizeQuery, driftTime, evaluate };
});
