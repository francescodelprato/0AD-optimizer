const CIVILISATION_NAMES = {
  achae: "Achaean",
  athen: "Athenians",
  brit: "Britons",
  cart: "Carthaginians",
  gaul: "Gauls",
  germ: "Germans",
  han: "Han Chinese",
  iber: "Iberians",
  kush: "Kushites",
  mace: "Macedonians",
  maur: "Mauryans",
  ptol: "Ptolemies",
  rome: "Romans",
  sele: "Seleucids",
  spart: "Spartans",
};

const RESOURCE_ICONS = { food: "food", wood: "wood", stone: "stone", metal: "metal" };
const MAX_POOL_SIZE = 6;
const MAX_COMPOSITIONS = 400000;

const AXES = {
  dps: { label: "Raw attack DPS", short: "DPS", digits: 1 },
  health: { label: "Total health", short: "health", digits: 0 },
  range: { label: "Average attack range", short: "range", digits: 1 },
  speed: { label: "Average speed", short: "speed", digits: 1 },
  armor: { label: "Average resistance", short: "resistance", digits: 1 },
};

const state = {
  data: null,
  civ: "athen",
  units: [],
  selectedIds: [],
  compositions: [],
  frontier: [],
  selected: null,
  chartPoints: [],
  truncated: false,
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value, digits = 1) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 0 ? 0 : 0,
  });
}

function unitIsCavalry(unit) {
  return unit.identity_classes.includes("FastMoving") || unit.id.includes("/cavalry_") || unit.id.includes("/elephant_");
}

function unitGlyph(unit) {
  if (unit.attack_type === "ranged" && unitIsCavalry(unit)) return "🏹";
  if (unit.attack_type === "ranged") return "➶";
  if (unitIsCavalry(unit)) return "♞";
  return "⚔";
}

function unitFamily(unit) {
  return unitIsCavalry(unit) ? "cavalry" : "infantry";
}

function costText(unitOrComposition) {
  const cost = unitOrComposition.cost;
  return Object.entries(cost)
    .filter(([, value]) => value > 0)
    .map(([resource, value]) => `${number(value, 0)} ${RESOURCE_ICONS[resource]}`)
    .join(" · ") || "no resource cost";
}

function compositionCostText(composition) {
  return Object.entries(composition.resources)
    .filter(([, value]) => value > 0)
    .map(([resource, value]) => `${number(value, 0)} ${RESOURCE_ICONS[resource]}`)
    .join(" · ") || "no resource cost";
}

function selectedUnits() {
  return state.units.filter((unit) => state.selectedIds.includes(unit.id));
}

function pickDefaultPool(units) {
  const chosen = [];
  const addFirst = (predicate) => {
    const unit = units.find((candidate) => !chosen.includes(candidate) && predicate(candidate));
    if (unit) chosen.push(unit);
  };
  const infantry = (unit) => unitFamily(unit) === "infantry";
  const cavalry = (unit) => unitFamily(unit) === "cavalry";
  addFirst((unit) => infantry(unit) && unit.role === "Spearman");
  addFirst((unit) => infantry(unit) && unit.attack_type === "ranged" && ["Archer", "Slinger"].includes(unit.role));
  addFirst((unit) => infantry(unit) && unit.attack_type === "ranged" && unit.role !== "Spearman");
  addFirst((unit) => infantry(unit) && unit.attack_type === "melee" && unit.role !== "Spearman");
  addFirst((unit) => cavalry(unit) && unit.attack_type === "melee");
  addFirst((unit) => cavalry(unit) && unit.attack_type === "ranged");
  for (const unit of units) {
    if (chosen.length >= MAX_POOL_SIZE) break;
    if (!chosen.includes(unit)) chosen.push(unit);
  }
  return chosen.slice(0, MAX_POOL_SIZE).map((unit) => unit.id);
}

function readBudgets() {
  return Object.fromEntries(["food", "wood", "stone", "metal"].map((resource) => [resource, Math.max(0, Number($("#" + resource).value) || 0)]));
}

function readWeights() {
  return {
    dps: Number($("#weight-dps").value),
    health: Number($("#weight-health").value),
    range: Number($("#weight-range").value),
    speed: Number($("#weight-speed").value),
  };
}

function updateWeightOutputs() {
  for (const key of ["dps", "health", "range", "speed"]) {
    $("#weight-" + key + "-output").value = $("#weight-" + key).value;
    $("#weight-" + key + "-output").textContent = $("#weight-" + key).value;
  }
}

function compositionLabel(composition, units) {
  return composition.counts
    .map((count, index) => count ? `${count}× ${units[index].name}` : null)
    .filter(Boolean)
    .join(" + ");
}

function compositionMix(composition, units) {
  return composition.counts
    .map((count, index) => count ? `${count} ${units[index].role} ${unitFamily(units[index])}` : null)
    .filter(Boolean)
    .join(" · ");
}

function fitsResources(resources, budgets) {
  return Object.keys(budgets).every((resource) => resources[resource] <= budgets[resource] + 1e-8);
}

function enumerateCompositions(units, targetPopulation, budgets) {
  const compositions = [];
  const counts = Array(units.length).fill(0);
  const resourceKeys = Object.keys(budgets);
  const resources = Object.fromEntries(resourceKeys.map((resource) => [resource, 0]));
  const totals = { population: 0, unitCount: 0, dps: 0, health: 0, range: 0, speed: 0, armor: 0 };
  let truncated = false;
  const minimumCostPerPopulation = Array.from({ length: units.length + 1 }, () => Object.fromEntries(resourceKeys.map((resource) => [resource, Infinity])));

  for (let index = units.length - 1; index >= 0; index -= 1) {
    for (const resource of resourceKeys) {
      minimumCostPerPopulation[index][resource] = Math.min(
        minimumCostPerPopulation[index + 1][resource],
        (units[index].cost[resource] || 0) / units[index].population,
      );
    }
  }

  const canComplete = (nextIndex, remainingPopulation) => {
    if (remainingPopulation < -1e-8) return false;
    if (remainingPopulation <= 1e-8) return true;
    if (nextIndex >= units.length) return false;
    return resourceKeys.every((resource) => (
      resources[resource] + remainingPopulation * minimumCostPerPopulation[nextIndex][resource] <= budgets[resource] + 1e-8
    ));
  };

  const addComposition = () => {
    if (compositions.length >= MAX_COMPOSITIONS) {
      truncated = true;
      return;
    }
    const unitCount = totals.unitCount;
    compositions.push({
      counts: counts.slice(),
      resources: { ...resources },
      population: totals.population,
      unitCount,
      dps: totals.dps,
      health: totals.health,
      range: unitCount ? totals.range / unitCount : 0,
      speed: unitCount ? totals.speed / unitCount : 0,
      armor: unitCount ? totals.armor / unitCount : 0,
    });
  };

  const visit = (index, remainingPopulation) => {
    if (truncated) return;
    const unit = units[index];
    const isLast = index === units.length - 1;
    const maxCount = Math.floor((remainingPopulation + 1e-8) / unit.population);
    for (let count = 0; count <= maxCount; count += 1) {
      counts[index] = count;
      for (const resource of resourceKeys) resources[resource] += count * (unit.cost[resource] || 0);
      totals.population += count * unit.population;
      totals.unitCount += count;
      totals.dps += count * unit.attack_dps;
      totals.health += count * unit.health;
      totals.range += count * unit.attack_range;
      totals.speed += count * unit.speed;
      totals.armor += count * unit.armor;

      const remainingAfterChoice = remainingPopulation - count * unit.population;
      if (fitsResources(resources, budgets) && canComplete(index + 1, remainingAfterChoice)) {
        if (isLast) {
          if (Math.abs(remainingPopulation - count * unit.population) < 1e-8) addComposition();
        } else {
          visit(index + 1, remainingAfterChoice);
        }
      }

      for (const resource of resourceKeys) resources[resource] -= count * (unit.cost[resource] || 0);
      totals.population -= count * unit.population;
      totals.unitCount -= count;
      totals.dps -= count * unit.attack_dps;
      totals.health -= count * unit.health;
      totals.range -= count * unit.attack_range;
      totals.speed -= count * unit.speed;
      totals.armor -= count * unit.armor;
    }
    counts[index] = 0;
  };

  if (units.length && canComplete(0, targetPopulation)) visit(0, targetPopulation);
  return { compositions, truncated };
}

function paretoFront(compositions, xKey, yKey) {
  const sorted = [...compositions].sort((a, b) => b[xKey] - a[xKey] || b[yKey] - a[yKey]);
  const frontier = [];
  let bestY = -Infinity;
  for (const composition of sorted) {
    if (composition[yKey] > bestY + 1e-8) {
      frontier.push(composition);
      bestY = composition[yKey];
    }
  }
  return frontier;
}

function valueBounds(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function addScores(compositions, weights) {
  const keys = Object.keys(weights);
  const bounds = Object.fromEntries(keys.map((key) => {
    const values = compositions.map((composition) => composition[key]);
    return [key, valueBounds(values)];
  }));
  for (const composition of compositions) {
    let score = 0;
    let totalWeight = 0;
    for (const key of keys) {
      const weight = weights[key];
      const { min, max } = bounds[key];
      const normalized = max - min < 1e-8 ? 1 : (composition[key] - min) / (max - min);
      score += weight * normalized;
      totalWeight += weight;
    }
    composition.score = totalWeight ? score / totalWeight : 0;
  }
}

function recalculate() {
  updateWeightOutputs();
  const units = selectedUnits();
  const targetPopulation = Number($("#population").value);
  $("#population-output").value = targetPopulation;
  $("#population-output").textContent = targetPopulation;
  const budgets = readBudgets();
  const xKey = $("#x-axis").value;
  const yKey = $("#y-axis").value;
  const { compositions, truncated } = enumerateCompositions(units, targetPopulation, budgets);
  state.compositions = compositions;
  state.truncated = truncated;
  addScores(compositions, readWeights());
  state.frontier = paretoFront(compositions, xKey, yKey).sort((a, b) => b.score - a.score);
  state.selected = state.frontier[0] || null;
  renderResults(units, xKey, yKey);
}

function renderUnitRoster() {
  const selected = new Set(state.selectedIds);
  $("#unit-roster").innerHTML = state.units.map((unit) => {
    const checked = selected.has(unit.id);
    const stats = `${number(unit.attack_dps, 1)} DPS · ${number(unit.health, 0)} HP · ${number(unit.attack_range, 0)} range`;
    return `<label class="unit-card${checked ? " is-selected" : ""}">
      <input type="checkbox" data-unit-id="${escapeHtml(unit.id)}" ${checked ? "checked" : ""}>
      <span class="unit-glyph">${unitGlyph(unit)}</span>
      <span class="unit-card-main">
        <span class="unit-name">${escapeHtml(unit.name)}</span>
        <span class="unit-role">${escapeHtml(unit.role)} · ${unitFamily(unit)} · ${escapeHtml(unit.attack_type)}</span>
        <span class="unit-stats"><span>${stats}</span><span>${escapeHtml(costText(unit))}</span></span>
      </span>
    </label>`;
  }).join("");
  const count = state.selectedIds.length;
  $("#roster-hint").textContent = `${count} of ${state.units.length} unit types checked. The default pool selects a small set of contrasting roles so the first search stays readable.`;
  $("#roster-hint").classList.toggle("warning", count >= MAX_POOL_SIZE);
}

function metricMarkup(composition, key) {
  const axis = AXES[key];
  return `<div class="metric"><span class="metric-label">${axis.short}</span><span class="metric-value">${number(composition[key], axis.digits)}</span></div>`;
}

function renderBestFit(composition, units) {
  if (!composition) {
    $("#best-fit-title").textContent = "No legal composition";
    $("#best-fit-mix").textContent = "Increase a resource ceiling or check more unit types.";
    $("#best-fit-metrics").innerHTML = "";
    return;
  }
  $("#best-fit-title").textContent = `${number(composition.score * 100, 0)} / 100 fit`;
  $("#best-fit-mix").textContent = `${compositionLabel(composition, units)}. ${compositionCostText(composition)}.`;
  $("#best-fit-metrics").innerHTML = ["dps", "health", "range", "speed"].map((key) => metricMarkup(composition, key)).join("");
}

function renderRecommendations(units) {
  const list = $("#recommendation-list");
  if (!state.frontier.length) {
    list.innerHTML = `<div class="roster-hint">No legal composition satisfies the current constraints.</div>`;
    return;
  }
  list.innerHTML = state.frontier.slice(0, 8).map((composition, index) => {
    const isSelected = composition === state.selected;
    return `<button class="recommendation${isSelected ? " is-selected" : ""}" data-frontier-index="${index}">
      <span class="recommendation-rank">${String(index + 1).padStart(2, "0")}</span>
      <span><span class="recommendation-name">${escapeHtml(compositionMix(composition, units))}</span><span class="recommendation-detail">${number(composition.dps, 1)} DPS · ${number(composition.health, 0)} HP · ${compositionCostText(composition)}</span></span>
      <span class="recommendation-score">${number(composition.score * 100, 0)}</span>
    </button>`;
  }).join("");
  list.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected = state.frontier[Number(button.dataset.frontierIndex)];
      renderBestFit(state.selected, units);
      drawChart($("#x-axis").value, $("#y-axis").value);
      renderRecommendations(units);
    });
  });
}

function drawChart(xKey, yKey) {
  const canvas = $("#frontier-chart");
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(bounds.width));
  const height = Math.max(280, Math.floor(bounds.height));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const compositions = state.compositions;
  if (!compositions.length) {
    context.fillStyle = "#6d747c";
    context.font = "14px Avenir Next, sans-serif";
    context.fillText("No legal composition under these constraints.", 35, height / 2);
    state.chartPoints = [];
    return;
  }

  const margin = { left: 58, right: 22, top: 22, bottom: 30 };
  const valuesX = compositions.map((composition) => composition[xKey]);
  const valuesY = compositions.map((composition) => composition[yKey]);
  const { min: minX, max: maxX } = valueBounds(valuesX);
  const { min: minY, max: maxY } = valueBounds(valuesY);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const mapX = (value) => margin.left + ((value - minX) / spanX) * (width - margin.left - margin.right);
  const mapY = (value) => height - margin.bottom - ((value - minY) / spanY) * (height - margin.top - margin.bottom);
  const style = getComputedStyle(document.documentElement);

  context.strokeStyle = "#ded8cc";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(margin.left, margin.top);
  context.lineTo(margin.left, height - margin.bottom);
  context.lineTo(width - margin.right, height - margin.bottom);
  context.stroke();

  context.fillStyle = "rgba(46, 100, 128, 0.12)";
  const step = Math.max(1, Math.ceil(compositions.length / 12000));
  for (let index = 0; index < compositions.length; index += step) {
    const composition = compositions[index];
    context.beginPath();
    context.arc(mapX(composition[xKey]), mapY(composition[yKey]), 1.2, 0, Math.PI * 2);
    context.fill();
  }

  const frontierForLine = [...state.frontier].sort((a, b) => a[xKey] - b[xKey]);
  context.strokeStyle = style.getPropertyValue("--accent").trim() || "#ba4d2b";
  context.lineWidth = 2;
  context.beginPath();
  frontierForLine.forEach((composition, index) => {
    const x = mapX(composition[xKey]);
    const y = mapY(composition[yKey]);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();

  state.chartPoints = state.frontier.map((composition) => ({
    composition,
    x: mapX(composition[xKey]),
    y: mapY(composition[yKey]),
  }));
  for (const point of state.chartPoints) {
    context.fillStyle = point.composition === state.selected ? "#7a2f1d" : "#ba4d2b";
    context.beginPath();
    context.arc(point.x, point.y, point.composition === state.selected ? 5 : 3, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "#6d747c";
  context.font = "11px Avenir Next, sans-serif";
  context.fillText(number(minX, AXES[xKey].digits), margin.left, height - 10);
  context.textAlign = "right";
  context.fillText(number(maxX, AXES[xKey].digits), width - margin.right, height - 10);
  context.textAlign = "left";
  context.fillText(number(maxY, AXES[yKey].digits), 8, margin.top + 4);
  context.fillText(number(minY, AXES[yKey].digits), 8, height - margin.bottom);
  context.textAlign = "left";
}

function renderResults(units, xKey, yKey) {
  $("#result-title").textContent = `${CIVILISATION_NAMES[state.civ] || state.civ} under pressure`;
  $("#feasible-count").textContent = number(state.compositions.length, 0);
  $("#frontier-count").textContent = number(state.frontier.length, 0);
  $("#chart-x-label").textContent = AXES[xKey].label;
  $("#chart-y-label").textContent = AXES[yKey].label;
  $("#search-status").textContent = state.truncated ? `Search capped at ${number(MAX_COMPOSITIONS, 0)} candidates` : "Exhaustive over checked units";
  renderBestFit(state.selected, units);
  renderRecommendations(units);
  drawChart(xKey, yKey);
}

function handleUnitChange(event) {
  if (!event.target.matches("input[data-unit-id]")) return;
  const id = event.target.dataset.unitId;
  if (event.target.checked && !state.selectedIds.includes(id)) {
    if (state.selectedIds.length >= MAX_POOL_SIZE) {
      event.target.checked = false;
      $("#roster-hint").textContent = `The exhaustive search is limited to ${MAX_POOL_SIZE} checked unit types. Uncheck one before adding another.`;
      $("#roster-hint").classList.add("warning");
      return;
    }
    state.selectedIds.push(id);
  } else {
    state.selectedIds = state.selectedIds.filter((selectedId) => selectedId !== id);
  }
  renderUnitRoster();
  recalculate();
}

let recalculateTimer = null;

function scheduleRecalculate() {
  clearTimeout(recalculateTimer);
  recalculateTimer = setTimeout(() => {
    recalculateTimer = null;
    recalculate();
  }, 100);
}

function recalculateImmediately() {
  clearTimeout(recalculateTimer);
  recalculateTimer = null;
  recalculate();
}

function wireControls() {
  $("#civilisation").addEventListener("change", (event) => {
    state.civ = event.target.value;
    state.units = state.data.units.filter((unit) => unit.civ === state.civ);
    state.selectedIds = pickDefaultPool(state.units);
    renderUnitRoster();
    recalculate();
  });
  ["population", "food", "wood", "stone", "metal", "x-axis", "y-axis", "weight-dps", "weight-health", "weight-range", "weight-speed"].forEach((id) => {
    $("#" + id).addEventListener("input", scheduleRecalculate);
    $("#" + id).addEventListener("change", recalculateImmediately);
  });
  $("#unit-roster").addEventListener("change", handleUnitChange);
  $("#frontier-chart").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let closest = null;
    let distance = Infinity;
    for (const point of state.chartPoints) {
      const currentDistance = Math.hypot(point.x - x, point.y - y);
      if (currentDistance < distance) { closest = point; distance = currentDistance; }
    }
    if (closest && distance < 18) {
      state.selected = closest.composition;
      renderBestFit(state.selected, selectedUnits());
      renderRecommendations(selectedUnits());
      drawChart($("#x-axis").value, $("#y-axis").value);
    }
  });
  window.addEventListener("resize", () => drawChart($("#x-axis").value, $("#y-axis").value));
}

async function init() {
  try {
    state.data = await fetch("data/units.json").then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    const civSelect = $("#civilisation");
    civSelect.innerHTML = state.data.civilisations.map((civ) => `<option value="${escapeHtml(civ)}">${escapeHtml(CIVILISATION_NAMES[civ] || civ.toUpperCase())}</option>`).join("");
    civSelect.value = state.civ;
    state.units = state.data.units.filter((unit) => unit.civ === state.civ);
    state.selectedIds = pickDefaultPool(state.units);
    $("#source-summary").textContent = `0 A.D. source snapshot ${state.data.source.commit.slice(0, 12)} · ${state.data.units.length} baseline units`;
    wireControls();
    renderUnitRoster();
    recalculate();
  } catch (error) {
    $("#source-summary").textContent = `Could not load data: ${error.message}`;
    $("#search-status").textContent = "Data load failed";
  }
}

init();
