"use strict";
(function () {
  const data = MagboltzChartData, format = MagboltzDisplay.number;
  const form = document.getElementById("chart-form"), quantity = document.getElementById("chart-quantity");
  const xAxis = document.getElementById("chart-x"), family = document.getElementById("chart-family");
  const buildButton = document.getElementById("chart-build"), copyButton = document.getElementById("chart-copy"), csvButton = document.getElementById("chart-csv");
  const status = document.getElementById("chart-status"), graph = document.getElementById("transport-chart"), conditions = document.getElementById("chart-conditions");
  const key = document.getElementById("chart-key");
  let model = null, dataset = null, revision = 0, loadingPlotly = null;
  const colors = ["#175d7c", "#c4672a", "#2c866c", "#885ca5", "#bb4b68"];
  function option(parent, value, text) {
    const item = document.createElement("option"); item.value = value; item.textContent = text; parent.append(item);
  }
  for (const group of ["Скорость", "Диффузия", "Тензор диффузии"]) {
    const choices = document.createElement("optgroup"); choices.label = group;
    data.quantities.filter(item => item.group === group).forEach(item => option(choices, item.key, `${item.label}, ${item.unit}`));
    quantity.append(choices);
  }
  const controls = {};
  for (const parameter of data.parameters) {
    const { key: name, label, symbol, unit } = parameter;
    option(xAxis, name, `${label} ${symbol}`); option(family, name, `${label} ${symbol}`);
    const card = document.createElement("div"); card.className = "chart-parameter";
    const heading = document.createElement("h3"); heading.textContent = `${label} ${symbol}, ${unit}`;
    const mode = document.createElement("p"); mode.className = "chart-parameter-mode";
    const fixed = document.createElement("div"), range = document.createElement("div"); range.className = "chart-range";
    const inputs = {};
    for (const [role, text] of [["value", "Значение"], ["start", "От"], ["stop", "До"]]) {
      const caption = document.createElement("label"), input = document.createElement("input");
      input.type = "number"; input.step = "any"; input.required = true; input.id = `chart-${name}-${role}`; input.value = parameter[role];
      input.setAttribute("aria-label", `${label}: ${text.toLowerCase()}, ${unit}`);
      if (name === "magnetic_field_t" || name === "angle_deg") input.min = "0";
      if (name === "angle_deg") input.max = "180";
      caption.textContent = text; caption.htmlFor = input.id; caption.append(input);
      (role === "value" ? fixed : range).append(caption); inputs[role] = input;
    }
    card.append(heading, mode, fixed, range); document.getElementById("chart-parameters").append(card);
    controls[name] = { ...inputs, fixed, range, mode };
  }
  function message(text, error = false) { status.textContent = text; status.dataset.kind = error ? "error" : "info"; }
  function invalidate() {
    revision++; dataset = null; csvButton.disabled = true;
    graph.hidden = true; key.hidden = true; conditions.hidden = true;
    if (model) message("Параметры графика изменены. Нажмите «Построить график».");
  }
  function syncParameters() {
    if (family.value === xAxis.value) family.value = "";
    for (const choice of family.options) choice.disabled = choice.value === xAxis.value;
    for (const parameter of data.parameters) {
      const control = controls[parameter.key], isX = parameter.key === xAxis.value, isFamily = parameter.key === family.value;
      control.fixed.hidden = isX || isFamily; control.range.hidden = !isX && !isFamily;
      control.value.disabled = isX || isFamily; control.start.disabled = control.stop.disabled = !isX && !isFamily;
      control.mode.textContent = isX ? "Диапазон по оси X" : isFamily ? "Диапазон семейства · 5 кривых" : "Фиксированный параметр";
    }
    document.getElementById("chart-family-note").hidden = !family.value;
  }
  function request() {
    return { quantity: quantity.value, xAxis: xAxis.value, seriesAxis: family.value,
      parameters: Object.fromEntries(data.parameters.map(parameter => [parameter.key,
        Object.fromEntries(["value", "start", "stop"].map(role => [role, controls[parameter.key][role].value]))])) };
  }
  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = path;
      script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error("Не удалось загрузить Plotly. Обновите страницу и попробуйте снова.")); };
      document.head.append(script);
    });
  }
  async function plotly() {
    if (!loadingPlotly) loadingPlotly = (async () => {
      if (!window.Plotly) await loadScript("vendor/plotly-basic-4.1.1.min.js");
      await loadScript("vendor/plotly-locale-ru-4.1.1.js");
      if (!window.Plotly) throw new Error("Библиотека Plotly недоступна.");
      return window.Plotly;
    })().catch(error => { loadingPlotly = null; throw error; });
    return loadingPlotly;
  }
  function seriesLabel(value, seriesValue) {
    if (value.family < 0) return value.quantity.label;
    const parameter = data.parameters[value.family];
    return `${parameter.symbol} = ${seriesValue.replace(".", ",")} ${parameter.unit}`;
  }
  async function draw(value, library) {
    const x = data.parameters[value.axis], q = value.quantity;
    const traces = value.curves.map((curve, i) => ({
      type: "scatter", mode: "lines+markers", name: seriesLabel(value, curve.seriesValue) + (curve.available ? "" : " — нет данных"),
      x: curve.points.map(point => Number(point.x)), y: curve.points.map(point => point.value),
      connectgaps: false, line: { color: colors[i], width: 2, shape: "linear" },
      marker: { color: colors[i], size: curve.points.map(point => point.measured ? 7 : 0), line: { color: "#fff", width: 1 } },
      customdata: curve.points.map(point => [point.x.replace(".", ","), format(point.value), point.source === "Magboltz" ? "Расчёт Magboltz" : "Интерполяция"]),
      hovertemplate: `${x.symbol}: %{customdata[0]} ${x.unit}<br>${q.symbol}: %{customdata[1]} ${q.unit}<br>%{customdata[2]}<extra>%{fullData.name}</extra>`,
    }));
    graph.hidden = false;
    await library.react(graph, traces, {
      autosize: true, margin: { l: 70, r: 15, t: 32, b: value.family < 0 ? 65 : 110 },
      font: { family: '"Segoe UI", sans-serif', color: "#182f3c", size: 12 },
      paper_bgcolor: "#fff", plot_bgcolor: "#fff", hovermode: "closest", separators: ", ",
      xaxis: { title: { text: `${x.label} ${x.symbol}, ${x.unit}`, standoff: 16 }, gridcolor: "#edf0f3", zeroline: false, automargin: true },
      yaxis: { title: { text: `${q.symbol}, ${q.unit}`, standoff: 12 }, tickformat: ".5g", gridcolor: "#edf0f3", zeroline: false, automargin: true },
      showlegend: value.family >= 0, legend: { orientation: "h", y: -0.25, x: 0 },
    }, { responsive: true, displaylogo: false, locale: "ru", scrollZoom: false,
      modeBarButtons: [["zoom2d", "pan2d"], ["zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d"], ["toImage"]],
      toImageButtonOptions: { filename: `magboltz_${q.key}`, format: "png", scale: 2 } });
    graph.setAttribute("aria-label", `${q.label} как функция ${x.label.toLowerCase()}; кривых: ${value.curves.length}`);
  }
  form.addEventListener("input", invalidate);
  xAxis.addEventListener("change", () => { syncParameters(); invalidate(); });
  family.addEventListener("change", () => { syncParameters(); invalidate(); });
  quantity.addEventListener("change", invalidate);
  copyButton.addEventListener("click", () => {
    for (const parameter of data.parameters) {
      const input = document.querySelector(`#calculator [name="${parameter.key}"]`);
      if (input) controls[parameter.key].value.value = input.value;
    }
    invalidate(); message("Фиксированные параметры скопированы из калькулятора. Диапазоны сохранены.");
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!model || !form.reportValidity()) return;
    invalidate(); const task = revision;
    buildButton.disabled = true; buildButton.textContent = "Строю график…"; message("Построение графика…");
    try {
      const input = request(); data.normalize(input);
      const library = await plotly();
      await new Promise(resolve => setTimeout(resolve, 0));
      if (task !== revision) return;
      const value = data.build(model, input);
      if (task !== revision) return;
      await draw(value, library);
      if (task !== revision) { graph.hidden = true; return; }
      dataset = value; csvButton.disabled = !value.curves.some(curve => curve.available);
      const available = value.curves.filter(curve => curve.available), empty = value.curves.filter(curve => !curve.available);
      const partial = available.some(curve => curve.available < curve.points.length);
      message(!available.length ? "Для выбранных диапазонов и фиксированных параметров нет данных. Измените параметры или диапазоны."
        : value.family < 0 ? "Построена одна кривая." + (partial ? " Часть диапазона не покрыта расчётами." : "")
        : `Кривых в семействе: 5; с данными: ${available.length}.` + (partial ? " Есть участки без данных." : ""), !available.length);
      if (empty.length && value.family >= 0) status.textContent += ` Нет данных: ${empty.map(curve => seriesLabel(value, curve.seriesValue)).join("; ")}.`;
      const fixed = data.parameters.flatMap((parameter, i) => i === value.axis || i === value.family ? []
        : [`${parameter.symbol} = ${value.values[i].value.replace(".", ",")} ${parameter.unit}`]);
      conditions.textContent = `Фиксировано: ${fixed.join("; ")}.`;
      if (value.values[1].value === "0" && (value.axis === 2 || value.family === 2)) {
        conditions.textContent += " При B = 0 угол не влияет на результат; кривые для разных углов совпадают.";
      }
      conditions.hidden = false; key.hidden = !available.length;
    } catch (error) {
      if (task === revision) { graph.hidden = true; dataset = null; csvButton.disabled = true; message(error.message, true); }
    } finally {
      buildButton.disabled = !model; buildButton.textContent = "Построить график";
    }
  });
  csvButton.addEventListener("click", () => {
    if (!dataset) return;
    const blob = new Blob([data.csv(dataset)], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `magboltz_${dataset.quantity.key}_vs_${data.parameters[dataset.axis].key}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener("magboltz:model-ready", event => {
    model = event.detail; buildButton.disabled = copyButton.disabled = false;
    message("Задайте диапазон и нажмите «Построить график».");
  });
  document.addEventListener("magboltz:model-error", () => message("Расчётные данные не загрузились. Обновите страницу.", true));
  syncParameters();
})();
