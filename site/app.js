"use strict";
(async function () {
  const form = document.getElementById("calculator");
  const button = document.getElementById("calculate");
  const source = document.getElementById("source");
  const velocity = document.getElementById("velocity");
  const driftTime = document.getElementById("drift-time");
  const message = document.getElementById("message");
  const accuracy = document.getElementById("accuracy");
  const angle = document.getElementById("angle");
  const magnetic = document.getElementById("magnetic-field");
  const length = document.getElementById("length");
  const physicalInputs = ["electric-field", "magnetic-field", "angle", "temperature"].map(id => document.getElementById(id));
  const format = MagboltzDisplay.number;
  const percent = value => format(value, 2);
  let model = null, current = null;
  const tooltip = document.createElement("div");
  tooltip.id = "interpolation-tooltip"; tooltip.className = "formula-tooltip";
  tooltip.setAttribute("role", "tooltip"); tooltip.hidden = true;
  document.body.append(tooltip);
  let tooltipButton = null, closeTimer;
  function hideTooltip() {
    clearTimeout(closeTimer);
    if (tooltipButton) {
      tooltipButton.removeAttribute("aria-describedby");
      tooltipButton.setAttribute("aria-expanded", "false");
    }
    tooltipButton = null; tooltip.hidden = true;
  }
  function positionTooltip() {
    if (!tooltipButton) return;
    const anchor = tooltipButton.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) { hideTooltip(); return; }
    tooltip.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`;
    const top = anchor.bottom + 8 + box.height <= window.innerHeight - 12 ? anchor.bottom + 8 : anchor.top - box.height - 8;
    tooltip.style.top = `${Math.max(12, Math.min(top, window.innerHeight - box.height - 12))}px`;
  }
  function formulaButton(field) {
    const description = MagboltzFormulas.describe(current, field);
    if (!description) return null;
    const info = document.createElement("button");
    info.type = "button"; info.className = "formula-trigger"; info.textContent = "i";
    info.dataset.field = field;
    info.setAttribute("aria-label", "Показать формулу интерполяции");
    info.setAttribute("aria-controls", tooltip.id); info.setAttribute("aria-expanded", "false");
    function show() {
      hideTooltip(); tooltipButton = info;
      const title = document.createElement("strong"); title.textContent = description.title;
      tooltip.replaceChildren(title);
      for (const [className, lines] of [["formula-equation", description.lines], ["formula-note", description.notes]]) {
        for (const text of lines) {
          const line = document.createElement("p"); line.className = className; line.textContent = text;
          tooltip.append(line);
        }
      }
      info.setAttribute("aria-describedby", tooltip.id); info.setAttribute("aria-expanded", "true");
      tooltip.scrollTop = 0; tooltip.hidden = false; positionTooltip();
    }
    info.addEventListener("pointerenter", show);
    info.addEventListener("focus", show);
    info.addEventListener("click", show);
    info.addEventListener("pointerleave", () => { if (document.activeElement !== info) closeTimer = setTimeout(hideTooltip, 180); });
    info.addEventListener("blur", () => {
      closeTimer = setTimeout(() => { if (!tooltip.matches(":hover")) hideTooltip(); }, 180);
    });
    return info;
  }
  tooltip.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  tooltip.addEventListener("pointerleave", () => { if (document.activeElement !== tooltipButton) closeTimer = setTimeout(hideTooltip, 180); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") hideTooltip(); });
  document.addEventListener("pointerdown", event => {
    if (!tooltip.contains(event.target) && !tooltipButton?.contains(event.target)) hideTooltip();
  });
  window.addEventListener("resize", positionTooltip);
  document.addEventListener("scroll", positionTooltip, true);

  function renderTransport() {
    hideTooltip();
    const velocityFormula = document.getElementById("velocity-formula");
    velocityFormula.replaceChildren();
    const info = formulaButton("velocity_z_um_ns");
    if (info) velocityFormula.append(info);
    const data = current?.transport || {};
    const diffusion = document.getElementById("diffusion-values"), transverse = document.getElementById("transverse-values"), tensor = document.getElementById("tensor-values");
    [diffusion, transverse, tensor].forEach(body => body.replaceChildren());
    function cell(item, field) {
      const td = document.createElement("td");
      if (!item) { td.textContent = "—"; return td; }
      td.textContent = format(item.value);
      const info = formulaButton(field);
      if (info) td.append(info);
      const note = document.createElement("small");
      note.textContent = item.statistical_error_percent !== null ? `±${percent(item.statistical_error_percent)}%`
        : item.interpolation_accuracy?.sample_count >= 2 ? `проверка интерполяции: макс. ${percent(item.interpolation_accuracy.max_relative_error_percent)}%`
        : "погрешность не оценена";
      td.append(note);
      return td;
    }
    function row(body, label, fields) {
      const tr = document.createElement("tr"), heading = document.createElement("th");
      heading.scope = "row"; heading.innerHTML = label; tr.append(heading);
      fields.forEach(field => tr.append(cell(data[field], field))); body.append(tr);
    }
    for (const [axis, label] of [["longitudinal", "Продольная D<sub>L</sub>"], ["transverse", "Поперечная D<sub>T</sub>"]]) {
      const name = `diffusion_${axis}`;
      if (data[name] || data[`${name}_spread`]) row(diffusion, label, [name, `${name}_spread`]);
    }
    for (const axis of ["x", "y"]) if (data[`drift_${axis}`]) row(transverse, `v<sub>${axis}</sub>`, [`drift_${axis}`]);
    for (const axis of ["xx", "yy", "zz", "xy", "xz", "yz"]) {
      if (!data[`diffusion_${axis}`]) continue;
      const label = `D<sub>${axis}</sub>` + (axis[0] === axis[1] ? "" : ` = D<sub>${axis[1]}${axis[0]}</sub>`);
      row(tensor, label, [`diffusion_${axis}`]);
    }
    document.getElementById("diffusion").hidden = !diffusion.children.length;
    document.getElementById("transverse").hidden = !transverse.children.length;
    document.getElementById("tensor").hidden = !tensor.children.length;
    document.getElementById("transport").hidden = !(diffusion.children.length || transverse.children.length || tensor.children.length);
    const projected = data.diffusion_longitudinal?.origin === "tensor_projection";
    document.getElementById("diffusion-basis").textContent = current?.diffusion_basis === "drift_velocity"
      ? "При α = 90° Magboltz задаёт DL вдоль скорости дрейфа и DT поперёк неё в плоскости, перпендикулярной B. Вторая поперечная компонента вдоль B — Dxx. Длина s в σ/√s направлена вдоль скорости дрейфа."
      : projected ? "Проекции тензора: DL = Dzz вдоль E, DT = (Dxx + Dyy)/2. Длина s в σ/√s направлена вдоль E."
      : "DL — вдоль E; DT — средняя диффузия поперёк E. Длина s в σ/√s направлена вдоль E.";
    const negative = ["xy", "xz", "yz"].some(axis => data[`diffusion_${axis}`]?.value < 0);
    const tensorNote = document.getElementById("tensor-note");
    tensorNote.textContent = current?.tensor_status === "not_positive_semidefinite"
      ? "Тензор не прошёл проверку неотрицательности: возможен статистический шум или проблема исходного расчёта. Исходные значения сохранены."
      : negative ? "" : "Dᵢⱼ = Dⱼᵢ. Показаны имеющиеся компоненты тензора.";
    tensorNote.hidden = !tensorNote.textContent;
    document.getElementById("transport-accuracy").textContent = current?.source === "Interpolated"
      ? "Каждая величина проверяется отдельно с исключением опорных точек. Эти оценки не являются гарантированной погрешностью; проверка скорости не переносится на диффузию."
      : "±% — статистическая погрешность из Magboltz. Для дополнительно вычисленных величин без собственной оценки она не указана.";
  }

  function setMessage(text, error = false) { message.textContent = text; message.dataset.kind = error ? "error" : "info"; }
  function setSource(value) {
    const labels = { Magboltz: "Расчёт Magboltz", Interpolated: "Интерполяция", Unavailable: "Нет данных" };
    source.textContent = labels[value] || labels.Unavailable;
    source.dataset.source = value;
  }
  function coverageMessage(query) {
    const fallback = "Для заданной точки недостаточно опорных расчётов. Интерполяция возможна между рассчитанными точками; экстраполяция не выполняется.";
    const context = model.contexts.find(item => item.id === model.default_context_id);
    if (!context) return fallback;
    const coordinates = MagboltzCore.normalizeQuery(query);
    const labels = ["E", "B", "α", "T"], units = ["В/см", "Тл", "°", "°C"];
    for (let axis = 0; axis < coordinates.length; axis++) {
      const slice = context.points.filter(point => point.coordinates.every((value, other) => other === axis || value === coordinates[other]));
      if (slice.length < 2) continue;
      const values = slice.map(point => point.coordinates[axis]).sort(MagboltzCore.compare);
      if (MagboltzCore.compare(coordinates[axis], values[0]) >= 0 && MagboltzCore.compare(coordinates[axis], values[values.length - 1]) <= 0) continue;
      const lower = format(Number(values[0])), upper = format(Number(values[values.length - 1]));
      return `При остальных заданных параметрах рассчитанные значения ${labels[axis]} лежат в диапазоне ${lower}–${upper} ${units[axis]}. Введённое значение выходит за этот диапазон; для интерполяции нужна опорная точка с другой стороны. Экстраполяция не выполняется.`;
    }
    return fallback;
  }
  function updateTime() {
    length.setCustomValidity("");
    if (!current || current.velocity_cm_us === null) return;
    try {
      driftTime.textContent = format(MagboltzCore.driftTime(current.velocity_cm_us, length.value));
      length.setCustomValidity("");
      setMessage(current.source === "Magboltz" ? "Непосредственный результат Magboltz." : "Локальная интерполяция по опорным расчётам.");
      if (current.provenance_warning) setMessage("Полный результат Magboltz проверен; исходный процесс завершился с ошибкой чтения после вывода результата.");
    } catch (_) {
      driftTime.textContent = "—";
      length.setCustomValidity("Введите конечную неотрицательную длину в сантиметрах.");
      setMessage("Для времени дрейфа введите корректную неотрицательную длину L.", true);
    }
  }
  function invalidate() {
    current = null; velocity.textContent = "—"; driftTime.textContent = "—";
    accuracy.textContent = ""; setSource("Unavailable");
    renderTransport();
    setMessage("Параметры изменены. Нажмите «Рассчитать».");
  }
  function syncAngle() {
    angle.disabled = magnetic.value.trim() !== "" && Number(magnetic.value) === 0;
    if (angle.disabled) angle.value = "0";
    document.getElementById("angle-note").hidden = !angle.disabled;
  }
  function calculate() {
    if (!model) return;
    const query = Object.fromEntries(physicalInputs.map(input => [input.name, input.value]));
    current = MagboltzCore.evaluate(model, query);
    setSource(current.source);
    accuracy.textContent = "";
    renderTransport();
    if (current.source === "Unavailable") {
      velocity.textContent = "—"; driftTime.textContent = "—";
      const reasons = {
        invalid_input: "Проверьте E, B, угол и температуру: значения должны быть конечными, E > 0, B ≥ 0, T > −273,15 °C, угол от 0° до 180°.",
        invalid_velocity: "Для этой точки отсутствует корректная положительная продольная скорость.",
        unsupported_precision: "Указана точность ввода, не поддерживаемая численным интерполятором.",
        context_unavailable: "В экспортированных данных нет результатов для P10 при 1 атм.",
      };
      setMessage(current.reason === "outside_supported_cells" ? coverageMessage(query) : reasons[current.reason] || "Численный результат недоступен.", true);
      return;
    }
    velocity.textContent = format(current.velocity_cm_us);
    if (current.source === "Magboltz" && current.statistical_error_percent !== null) {
      accuracy.textContent = `Статистическая погрешность скорости Magboltz: ±${percent(current.statistical_error_percent)}%.`;
    } else if (current.source === "Interpolated") {
      const info = current.interpolation_accuracy;
      accuracy.textContent = info && info.sample_count > 0
        ? `Проверка с исключением точек: ${info.sample_count}; максимальное наблюдаемое отклонение ${percent(info.max_relative_error_percent)}%. Это не гарантированная погрешность.`
        : "Точность интерполяции в этой области ещё не оценена.";
      if (info?.used_for_model_selection && info.sample_count > 0) {
        accuracy.textContent += " Эти точки также использованы для выбора метода.";
        if (info.max_support_gap_factor > 1) accuracy.textContent += " При исключении точки расстояние между опорами увеличивалось.";
      }
    }
    updateTime();
  }
  physicalInputs.forEach(input => input.addEventListener("input", () => { syncAngle(); invalidate(); }));
  length.addEventListener("input", updateTime);
  form.addEventListener("submit", event => { event.preventDefault(); if (form.reportValidity()) calculate(); });
  syncAngle();
  try {
    const response = await fetch("data/magboltz.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Data request failed");
    model = await response.json();
    if (model.format_version !== 1 || !Array.isArray(model.contexts)) throw new Error("Unsupported data format");
    const context = model.contexts.find(item => item.id === model.default_context_id);
    const date = new Date(model.generated_at).toLocaleString("ru-RU");
    document.getElementById("data-status").textContent = `Данные: ${context ? context.points.length : 0} опорных точек P10 · экспорт ${date}.`;
    button.disabled = false;
    calculate();
  } catch (_) {
    setMessage("Не удалось загрузить данные. Для локального запуска используйте python -m http.server 8000 --directory site и откройте http://localhost:8000.", true);
  } finally {
    document.getElementById("result").setAttribute("aria-busy", "false");
  }
})();
