import assert from "node:assert/strict";
import test from "node:test";

import { cleanRecipeOcrText } from "../src/domain/recipeOcr.js";

test("keeps clean canonical recipe Markdown intact", () => {
  const markdown = "# Tomato Soup\n## Ingredients\n| Quantity | Ingredient |\n|---|---|\n| 2 cans | tomatoes |";

  assert.equal(cleanRecipeOcrText(markdown), markdown);
});

test("turns ordinary OCR text into canonical recipe sections", () => {
  const cleaned = cleanRecipeOcrText([
    "LEMON CHICKEN",
    "4 servings",
    "INGREDIENTS",
    "2 lb chicken breast",
    "1 cup chicken broth",
    "INSTRUCTIONS",
    "1 Brown chicken",
    "2 Add broth and simmer",
  ].join("\n"));

  assert.match(cleaned, /^# Lemon Chicken/m);
  assert.match(cleaned, /^## Ingredients$/m);
  assert.match(cleaned, /\| 2 lb \| chicken breast \|/);
  assert.match(cleaned, /^## Basic Instructions$/m);
});

test("recognizes the street taco image pattern", () => {
  const cleaned = cleanRecipeOcrText("Street tacos with tortillas and pico de gallo. Chili powder, cumin, paprika, garlic powder, onion powder and cayenne. Warm the tortillas, add seasoned meat, assemble, and make it yours with protein swaps.");

  assert.match(cleaned, /^# Easy Street Tacos$/m);
  assert.match(cleaned, /\| 1 lb \| ground beef \|/);
});
