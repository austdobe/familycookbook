import { collectPlannedMealIngredients } from "./plannedMeals.js";

export function buildGrocerySectionsFromMenuRows(menuRows, archiveDocs, ingredientRowsForDoc) {
  const grouped = new Map();
  collectPlannedMealIngredients(menuRows, archiveDocs, ingredientRowsForDoc).forEach(({ doc, ingredient: ingredientRow }) => {
    const item = ingredientRow.Ingredient || ingredientRow.Item || "";
    if (!item) {
      return;
    }
    const sectionTitle = grocerySectionForItem(item);
    if (!grouped.has(sectionTitle)) {
      grouped.set(sectionTitle, { title: sectionTitle, items: [] });
    }
    grouped.get(sectionTitle).items.push({
      Quantity: ingredientRow.Quantity || "",
      Item: item,
      "Preferred version/type": ingredientRow["Preferred version/type"] || ingredientRow.Preferred || "",
      "Acceptable alternatives": ingredientRow["Acceptable alternatives"] || ingredientRow.Alternatives || "",
      Recipe: doc.title,
      _recipeRefs: [doc.path],
    });
  });

  return [...grouped.values()]
    .map((section) => ({ ...section, items: sortGroceryItems(mergeGroceryItems(section.items)) }))
    .sort((first, second) => grocerySectionSortIndex(first.title) - grocerySectionSortIndex(second.title));
}

export function mergeGroceryItems(items) {
  const merged = new Map();
  items.forEach((item) => {
    const key = canonicalGroceryItemKey(item.Item);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...item,
        Item: cleanGroceryItemDisplayName(item.Item),
        _recipeRefs: item._recipeRefs || [],
      });
      return;
    }

    existing.Item = chooseGroceryDisplayName(existing.Item, item.Item);
    existing.Quantity = mergeQuantities(existing.Quantity, item.Quantity);
    existing["Preferred version/type"] = mergeGroceryDetails(existing["Preferred version/type"], item["Preferred version/type"]);
    existing["Acceptable alternatives"] = mergeGroceryDetails(existing["Acceptable alternatives"], item["Acceptable alternatives"]);
    existing.Recipe = uniqueValues([...(existing.Recipe || "").split(/,\s*/), item.Recipe].filter(Boolean)).join(", ");
    existing._recipeRefs = uniqueValues([...(existing._recipeRefs || []), ...(item._recipeRefs || [])]);
  });
  return [...merged.values()].map(normalizeGroceryPurchaseQuantity);
}

function normalizeGroceryPurchaseQuantity(item) {
  const canonicalItem = canonicalGroceryItemKey(item.Item);
  const quantity = parseMergeableQuantity(item.Quantity);
  if (canonicalItem === "onion") {
    const onionCount = parseOnionShoppingQuantity(item.Quantity);
    if (Number.isFinite(onionCount) && onionCount > 0) {
      const roundedOnions = Math.max(1, Math.ceil(onionCount));
      const originalQuantity = String(item.Quantity || "").trim();
      return {
        ...item,
        Quantity: `${roundedOnions} ${displayQuantityUnit("onion", roundedOnions)}`,
        "Preferred version/type": mergeGroceryDetails(
          item["Preferred version/type"],
          originalQuantity ? `Recipe amounts total about ${formatQuantityAmount(onionCount)} onion${Math.abs(onionCount - 1) < 0.0001 ? "" : "s"} (${originalQuantity})` : ""
        ),
      };
    }
  }
  const canCount = parseCanShoppingQuantity(item);
  if (Number.isFinite(canCount) && canCount > 0) {
    const roundedCans = Math.max(1, Math.ceil(canCount));
    const originalQuantity = String(item.Quantity || "").trim();
    return {
      ...item,
      Quantity: `${roundedCans} ${displayQuantityUnit("can", roundedCans)}`,
      "Preferred version/type": mergeGroceryDetails(
        item["Preferred version/type"],
        originalQuantity ? `Recipe amounts total about ${formatQuantityAmount(canCount)} can${Math.abs(canCount - 1) < 0.0001 ? "" : "s"} (${originalQuantity})` : ""
      ),
    };
  }
  if (canonicalItem === "garlic" && quantity?.unitKey === "clove" && quantity.amount >= 10) {
    const bulbs = Math.ceil(quantity.amount / 12);
    return {
      ...item,
      Quantity: `${bulbs} ${displayQuantityUnit("bulb", bulbs)}`,
      "Preferred version/type": mergeGroceryDetails(item["Preferred version/type"], `${formatQuantityAmount(quantity.amount)} cloves total`),
    };
  }
  return item;
}

function parseCanShoppingQuantity(item) {
  const originalQuantity = String(item?.Quantity || "").trim();
  if (!originalQuantity) {
    return null;
  }
  const parsedFragments = originalQuantity
    .split(/\s+\+\s+/)
    .map((fragment) => parseCanQuantityFragment(fragment))
    .filter(Boolean);
  if (!parsedFragments.length) {
    return null;
  }

  const hasCanQuantity = parsedFragments.some((fragment) => fragment.unitKey === "can");
  const canFriendlyItem = isCanFriendlyGroceryItem(item);
  if (!hasCanQuantity && !canFriendlyItem) {
    return null;
  }

  let totalCans = 0;
  for (const fragment of parsedFragments) {
    if (fragment.unitKey === "can") {
      totalCans += fragment.amount;
    } else if (fragment.unitKey === "cup" && (hasCanQuantity || canFriendlyItem)) {
      totalCans += fragment.amount / cupsPerCanForItem(item);
    } else {
      return null;
    }
  }
  return totalCans;
}

function parseCanQuantityFragment(value) {
  const quantity = parseMergeableQuantity(value);
  if (!quantity || !Number.isFinite(quantity.amount)) {
    return null;
  }
  return {
    amount: quantity.amount,
    unitKey: quantity.unitKey,
  };
}

function isCanFriendlyGroceryItem(item) {
  const words = new Set(groceryItemWords([
    item?.Item,
    item?.["Preferred version/type"],
    item?.["Acceptable alternatives"],
  ].filter(Boolean).join(" ")));
  if (words.has("coconut") && words.has("milk")) {
    return true;
  }
  if (words.has("bean") && !words.has("green")) {
    return true;
  }
  if (words.has("pumpkin")) {
    return true;
  }
  const hasCanCue = words.has("can") || words.has("canned");
  return hasCanCue && ["chile", "corn", "tomato"].some((word) => words.has(word));
}

function cupsPerCanForItem(item) {
  const words = new Set(groceryItemWords(item?.Item || ""));
  if (words.has("coconut") && words.has("milk")) {
    return 1.7;
  }
  return 1.75;
}

function parseOnionShoppingQuantity(value) {
  const fragments = String(value || "")
    .split(/\s+\+\s+/)
    .map((fragment) => parseOnionQuantityFragment(fragment))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  if (!fragments.length) {
    return null;
  }
  return fragments.reduce((sum, amount) => sum + amount, 0);
}

function parseOnionQuantityFragment(value) {
  const quantity = parseMergeableQuantity(value);
  if (!quantity) {
    return null;
  }
  const unitKey = quantity.unitKey;
  if (!unitKey || unitKey === "onion" || unitKey === "medium") {
    return quantity.amount;
  }
  if (unitKey === "small") {
    return quantity.amount * 0.75;
  }
  if (unitKey === "large") {
    return quantity.amount * 1.5;
  }
  if (unitKey === "cup") {
    return quantity.amount;
  }
  if (unitKey === "tbsp") {
    return quantity.amount / 16;
  }
  if (unitKey === "tsp") {
    return quantity.amount / 48;
  }
  if (unitKey === "oz") {
    return quantity.amount / 5;
  }
  if (unitKey === "lb") {
    return quantity.amount * 3;
  }
  return null;
}

function mergeGroceryDetails(first, second) {
  return uniqueValues([first, second].map((value) => String(value || "").trim()).filter(Boolean)).join("; ");
}

function chooseGroceryDisplayName(first, second) {
  const firstClean = cleanGroceryItemDisplayName(first);
  const secondClean = cleanGroceryItemDisplayName(second);
  if (!firstClean) {
    return secondClean;
  }
  if (!secondClean || normalizeGroceryItemName(firstClean) === normalizeGroceryItemName(secondClean)) {
    return firstClean;
  }
  return secondClean.length < firstClean.length ? secondClean : firstClean;
}

function mergeQuantities(first, second) {
  if (!first) {
    return second || "";
  }
  if (!second) {
    return first;
  }

  const firstQuantity = parseMergeableQuantity(first);
  const secondQuantity = parseMergeableQuantity(second);
  if (firstQuantity && secondQuantity && firstQuantity.unitKey === secondQuantity.unitKey) {
    const total = firstQuantity.amount + secondQuantity.amount;
    const unit = displayQuantityUnit(firstQuantity.unit, total);
    return [formatQuantityAmount(total), unit].filter(Boolean).join(" ");
  }

  return uniqueValues([first, second]).join(" + ");
}

function parseMergeableQuantity(value) {
  const parts = parseQuantityParts(value);
  const amount = numericValue(parts.quantity);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unitKey = normalizeQuantityUnit(parts.unit);
  return {
    amount,
    unit: preferredQuantityUnit(parts.unit),
    unitKey,
  };
}

function normalizeQuantityUnit(value) {
  const unit = String(value || "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const aliases = {
    bag: "bag",
    bags: "bag",
    bulb: "bulb",
    bulbs: "bulb",
    bunch: "bunch",
    bunches: "bunch",
    can: "can",
    cans: "can",
    clove: "clove",
    cloves: "clove",
    cup: "cup",
    cups: "cup",
    head: "head",
    heads: "head",
    lb: "lb",
    lbs: "lb",
    large: "large",
    medium: "medium",
    onion: "onion",
    onions: "onion",
    ounce: "oz",
    ounces: "oz",
    oz: "oz",
    package: "package",
    packages: "package",
    packet: "packet",
    packets: "packet",
    pound: "lb",
    pounds: "lb",
    small: "small",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
  };
  const firstUnitWord = unit.split(" ")[0] || "";
  return aliases[unit] || aliases[firstUnitWord] || singularizeGroceryWord(unit);
}

function preferredQuantityUnit(value) {
  const unitKey = normalizeQuantityUnit(value);
  const preferred = {
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
  };
  return preferred[String(value || "").toLowerCase().replace(/\./g, "").trim()] || unitKey;
}

function displayQuantityUnit(unit, amount) {
  if (!unit) {
    return "";
  }
  const pluralUnits = new Set(["cup", "bag", "bulb", "bunch", "can", "clove", "head", "onion", "package", "packet"]);
  if (Math.abs(amount - 1) < 0.0001 || !pluralUnits.has(unit)) {
    return unit;
  }
  if (unit === "bunch") {
    return "bunches";
  }
  return `${unit}s`;
}

function formatQuantityAmount(value) {
  const rounded = Math.round(value * 16) / 16;
  const whole = Math.trunc(rounded);
  const fraction = rounded - whole;
  const fractions = [
    [0.0625, "1/16"],
    [0.125, "1/8"],
    [0.1875, "3/16"],
    [0.25, "1/4"],
    [0.3125, "5/16"],
    [0.375, "3/8"],
    [0.4375, "7/16"],
    [0.5, "1/2"],
    [0.5625, "9/16"],
    [0.625, "5/8"],
    [0.6875, "11/16"],
    [0.75, "3/4"],
    [0.8125, "13/16"],
    [0.875, "7/8"],
    [0.9375, "15/16"],
  ];
  const fractionText = fractions.find(([amount]) => Math.abs(fraction - amount) < 0.0001)?.[1] || "";
  if (!fractionText) {
    return String(Number(rounded.toFixed(4)));
  }
  return whole ? `${whole} ${fractionText}` : fractionText;
}

export function flattenGrocerySections(sections) {
  return sections.flatMap((section) => section.items.map((item, index) => {
    const parsedQuantity = parseQuantityParts(item.Quantity);
    return {
      alternatives: item["Acceptable alternatives"] || "",
      category: section.title,
      checked: false,
      id: `${normalizeSectionName(section.title)}-${normalizeGroceryItemName(item.Item).replace(/\s+/g, "-")}-${index}`,
      name: item.Item || "",
      preferredType: item["Preferred version/type"] || "",
      quantity: parsedQuantity.quantity,
      quantityText: item.Quantity || "",
      recipeRefs: item._recipeRefs || [],
      unit: parsedQuantity.unit,
    };
  }));
}


export function parseQuantityParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?)(?:\s+(.+))?$/);
  if (!match) {
    return { quantity: text, unit: "" };
  }
  return { quantity: match[1], unit: match[2] || "" };
}


export function grocerySectionForItem(item) {
  const words = new Set(groceryItemWords(item));
  const hasAny = (values) => values.some((value) => words.has(value));

  if (hasAny(["chicken", "beef", "steak", "pork", "salmon", "turkey", "ham", "shrimp", "fish"])) {
    return "Meat and Seafood";
  }
  if (hasAny(["milk", "cream", "cheese", "yogurt", "egg", "butter", "feta", "mozzarella", "cheddar", "swiss"])) {
    return "Dairy and Eggs";
  }
  if (hasAny(["flatbread", "naan", "bread", "tortilla", "wrap", "bun", "roll", "pita"])) {
    return "Bakery";
  }
  if (hasAny(["salt", "pepper", "cumin", "paprika", "oregano", "coriander", "turmeric", "powder", "seasoning", "spice", "flake"])) {
    return "Sauces, Condiments, and Spices";
  }
  if (hasAny(["rice", "breadcrumb", "panko", "arrowroot", "flour", "sugar", "honey", "oil", "vinegar", "sauce", "mustard", "mayonnaise", "broth", "stock", "peanut", "soy"])) {
    return "Pantry and Dry Goods";
  }
  if (hasAny(["apple", "avocado", "basil", "broccoli", "cabbage", "carrot", "cilantro", "cucumber", "dill", "garlic", "ginger", "herb", "jalapeno", "lemon", "lettuce", "lime", "mint", "mushroom", "onion", "parsley", "pepper", "potato", "radish", "tomato", "zucchini"])) {
    return "Produce";
  }
  return "Other";
}


export function isLikelyPerishableItem(item) {
  const words = new Set(groceryItemWords(item));
  return [
    "apple", "avocado", "basil", "beef", "broccoli", "carrot", "cheese", "chicken", "cilantro", "cream",
    "cucumber", "dill", "egg", "fish", "ginger", "ham", "lettuce", "lime", "meat", "milk", "mushroom",
    "onion", "parsley", "pepper", "pork", "potato", "salmon", "shrimp", "steak", "tomato", "turkey",
    "yogurt", "zucchini",
  ].some((word) => words.has(word));
}


const GROCERY_CATEGORY_OPTIONS = [
  "Produce",
  "Meat and Seafood",
  "Dairy and Eggs",
  "Bakery",
  "Pantry and Dry Goods",
  "Sauces, Condiments, and Spices",
  "Frozen",
  "Costco",
  "Other",
];

function grocerySectionSortIndex(title) {
  const normalizedTitle = normalizeSectionName(title);
  const index = GROCERY_CATEGORY_OPTIONS.findIndex(
    (option) => normalizeSectionName(option) === normalizedTitle,
  );
  return index === -1 ? GROCERY_CATEGORY_OPTIONS.length : index;
}

export function sortGroceryItems(items) {
  return [...items].sort((first, second) => {
    const firstFamily = groceryItemFamilyKey(first);
    const secondFamily = groceryItemFamilyKey(second);
    if (firstFamily !== secondFamily) {
      return firstFamily.localeCompare(secondFamily);
    }

    const firstName = canonicalGroceryItemKey(first.Item);
    const secondName = canonicalGroceryItemKey(second.Item);
    if (firstName !== secondName) {
      return firstName.localeCompare(secondName);
    }

    return String(first.Recipe || "").localeCompare(String(second.Recipe || ""));
  });
}

function groceryItemFamilyKey(item) {
  const words = groceryItemWords(item.Item);
  const families = [
    "apple",
    "bean",
    "beef",
    "berry",
    "bread",
    "broccoli",
    "cabbage",
    "carrot",
    "cheese",
    "chicken",
    "cream",
    "cucumber",
    "egg",
    "garlic",
    "ginger",
    "ham",
    "lettuce",
    "lemon",
    "lime",
    "milk",
    "mushroom",
    "oil",
    "onion",
    "pepper",
    "pork",
    "potato",
    "rice",
    "salmon",
    "sauce",
    "steak",
    "tomato",
    "tortilla",
    "turkey",
    "yogurt",
    "zucchini",
  ];
  const family = families.find((candidate) => words.includes(candidate));
  if (family) {
    return family;
  }

  const descriptors = new Set([
    "baby",
    "bell",
    "canned",
    "cherry",
    "dried",
    "fresh",
    "gold",
    "green",
    "greek",
    "large",
    "mini",
    "plain",
    "red",
    "roma",
    "russet",
    "small",
    "sweet",
    "white",
    "yellow",
    "yukon",
  ]);
  const meaningfulWords = words.filter((word) => !descriptors.has(word));
  return meaningfulWords.at(-1) || words.at(-1) || "";
}

export function groceryItemWords(value) {
  return normalizeGroceryItemName(value)
    .split(" ")
    .map(singularizeGroceryWord)
    .filter(Boolean);
}

function canonicalGroceryItemKey(value) {
  const options = groceryItemOptions(value)
    .map(canonicalGroceryOptionWords)
    .filter((words) => words.length);
  if (!options.length) {
    return normalizeGroceryItemName(value);
  }
  return options
    .sort((first, second) => second.length - first.length)[0]
    .sort()
    .join(" ");
}

function cleanGroceryItemDisplayName(value) {
  const words = canonicalGroceryOptionWords(groceryItemOptions(value)[0] || value);
  return words.join(" ");
}

function groceryItemOptions(value) {
  const normalized = normalizeGroceryItemName(value);
  return normalized
    .split(/\b(?:or|and or)\b|\/|;/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function canonicalGroceryOptionWords(value) {
  let words = normalizeGroceryItemName(value)
    .split(" ")
    .map(singularizeGroceryWord)
    .filter(Boolean);

  const wordSet = new Set(words);
  if (wordSet.has("scallion")) {
    return ["green", "onion"];
  }
  if (wordSet.has("romaine") && !wordSet.has("lettuce")) {
    words.push("lettuce");
  }
  if (wordSet.has("cilantro") && wordSet.has("fresh")) {
    words = words.filter((word) => word !== "fresh");
  }
  if (wordSet.has("onion") && wordSet.has("green")) {
    return ["green", "onion"];
  }
  if (wordSet.has("onion")) {
    return ["onion"];
  }
  if (wordSet.has("bean") && wordSet.has("green")) {
    return ["green", "bean"];
  }
  if (wordSet.has("pepper") && ["bell", "red", "yellow", "orange"].some((word) => wordSet.has(word))) {
    return ["bell", "pepper"];
  }

  const wordsWithoutPrep = words.filter((word) => !GROCERY_PREP_WORDS.has(word));
  return uniqueValues(wordsWithoutPrep.length ? wordsWithoutPrep : words);
}

function normalizeGroceryItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GROCERY_PREP_WORDS = new Set([
  "chopped",
  "canned",
  "chunk",
  "crushed",
  "cube",
  "cubed",
  "dice",
  "diced",
  "drained",
  "fresh",
  "frozen",
  "grate",
  "grated",
  "julienned",
  "large",
  "mince",
  "minced",
  "optional",
  "peeled",
  "rinsed",
  "shred",
  "shredded",
  "slice",
  "sliced",
  "small",
  "thin",
  "thinly",
  "trimmed",
  "wedged",
  "wedge",
  "wedges",
]);

function singularizeGroceryWord(word) {
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith("oes") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("ses") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

export function normalizeSectionName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function uniqueValues(values) {
  return [...new Set(values)];
}

function numericValue(value) {
  const text = String(value || "").trim();
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : null;
}
