const metricUnits = new Set(["g", "gram", "grams", "kg", "kilogram", "kilograms", "ml", "milliliter", "milliliters", "l", "liter", "liters"]);
const usWeightUnits = new Set(["oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds"]);
const usVolumeUnits = new Set(["cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons"]);

export function formatQuantity(value, unitMode = "us") {
  const quantity = String(value || "").trim();
  if (!quantity) {
    return quantity;
  }

  const explicit = selectExplicitUnit(quantity, unitMode);
  if (explicit) {
    return explicit;
  }

  if (unitMode === "us") {
    return quantity;
  }

  return convertSimpleWeightToMetric(quantity) || convertSimpleVolumeToMetric(quantity) || quantity;
}

function selectExplicitUnit(value, unitMode) {
  if (!value.includes(" / ")) {
    return "";
  }

  const parts = value.split(" / ").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) {
    return "";
  }

  const preferred = parts.find((part) => hasUnitType(part, unitMode));
  return preferred || "";
}

function hasUnitType(value, unitMode) {
  const unit = value.toLowerCase().match(/\b([a-z]+)\b/g)?.at(-1) || "";
  if (unitMode === "metric") {
    return metricUnits.has(unit);
  }
  return usWeightUnits.has(unit) || usVolumeUnits.has(unit);
}

function convertSimpleWeightToMetric(value) {
  const match = value.match(/^(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)\s*(lb|lbs|pound|pounds|oz|ounce|ounces)\b(.*)$/i);
  if (!match) {
    return "";
  }

  const amount = parseNumber(match[1]);
  if (!amount) {
    return "";
  }

  const unit = match[2].toLowerCase();
  const suffix = match[3] || "";
  const grams = unit.startsWith("lb") || unit.startsWith("pound")
    ? amount * 453.59237
    : amount * 28.349523125;

  return `${formatGrams(grams)}${suffix}`;
}

function convertSimpleVolumeToMetric(value) {
  const match = value.match(/^(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)\s*(cups?|tbsp\.?|tablespoons?|tsp\.?|teaspoons?)\b(.*)$/i);
  if (!match) {
    return "";
  }

  const amount = parseNumber(match[1]);
  if (!amount) {
    return "";
  }

  const unit = match[2].toLowerCase().replace(".", "");
  const suffix = match[3] || "";
  const milliliters = amount * millilitersPerUnit(unit);

  return `${formatMilliliters(milliliters)}${suffix}`;
}

function millilitersPerUnit(unit) {
  if (unit.startsWith("cup")) {
    return 240;
  }
  if (unit.startsWith("tbsp") || unit.startsWith("tablespoon")) {
    return 15;
  }
  return 5;
}

function parseNumber(value) {
  const trimmed = value.trim();
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }

  const fraction = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    return Number(fraction[1]) / Number(fraction[2]);
  }

  return Number(trimmed);
}

function formatGrams(value) {
  if (value >= 1000) {
    return `${Math.round(value).toLocaleString()} g`;
  }
  if (value >= 100) {
    return `${Math.round(value / 5) * 5} g`;
  }
  return `${Math.round(value)} g`;
}

function formatMilliliters(value) {
  if (value >= 1000) {
    const liters = value / 1000;
    return `${Number(liters.toFixed(1)).toLocaleString()} L`;
  }
  if (value >= 100) {
    return `${Math.round(value / 5) * 5} ml`;
  }
  if (value % 1 !== 0) {
    return `${Number(value.toFixed(1))} ml`;
  }
  return `${Math.round(value)} ml`;
}
