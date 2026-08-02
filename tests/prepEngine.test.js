import assert from "node:assert/strict";
import test from "node:test";

import { createPrepEngine } from "../src/domain/prepEngine.js";

function createEngine(doc) {
  return createPrepEngine({
    fileNameFromPath: (path) => path.split("/").pop(),
    findRecipeDocForMenuRow: () => doc,
    hasMeal: () => true,
    instructionSectionsFromMarkdown: () => [],
    labeledBulletValues: () => ({}),
    recipeDocsForMenuRow: () => [doc],
    structuredIngredientsFromMarkdown: () => [],
  });
}

test("builds owned prep tasks from every recipe component", () => {
  const doc = {
    id: "lemon-chicken",
    path: "recipe-archive/chicken/lemon-chicken.md",
    title: "Lemon Chicken",
    recipe: {
      id: "lemon-chicken",
      ingredients: [
        { item: "chicken thighs", quantityText: "2 lb", groceryCategory: "Meat and Seafood" },
        { item: "olive oil", quantityText: "2 Tbsp", notes: "marinade" },
        { item: "lemon", quantityText: "1", notes: "marinade", groceryCategory: "Produce" },
        { item: "fresh parsley", quantityText: "1 bunch", groceryCategory: "Produce" },
      ],
      prepGuidance: { prepAheadIdeas: [] },
    },
  };
  const engine = createEngine(doc);
  const sections = engine.buildPrepSectionsFromMenuRows([
    { Day: "Monday, August 3", Meal: "Lemon Chicken", components: [{ recipeId: doc.id, role: "complete" }] },
  ], [doc]);
  const tasks = engine.flattenPrepSections(sections);

  assert.ok(tasks.some((task) => task.title.includes("Confirm protein")));
  assert.ok(tasks.some((task) => task.title.includes("Make marinade")));
  assert.ok(tasks.some((task) => task.section === "Do Not Prep Ahead"));
  assert.ok(tasks.every((task) => task.mealRefs.includes("Lemon Chicken")));
});

test("creates a safe review reminder when a meal has no parsed recipe", () => {
  const engine = createPrepEngine({
    fileNameFromPath: () => "",
    findRecipeDocForMenuRow: () => null,
    hasMeal: () => true,
    instructionSectionsFromMarkdown: () => [],
    labeledBulletValues: () => ({}),
    recipeDocsForMenuRow: () => [],
    structuredIngredientsFromMarkdown: () => [],
  });
  const sections = engine.buildPrepSectionsFromMenuRows([{ Day: "Friday", Meal: "Pizza Night" }], []);
  const tasks = engine.flattenPrepSections(sections);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].section, "Cook-Day Reminders");
  assert.match(tasks[0].title, /Review prep needs/);
});
