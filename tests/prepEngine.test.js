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


test("batch prep scales ingredients once and emits storage/reheat reminders for linked leftovers", () => {
  const doc = { id: "chicken", path: "chicken.md", title: "Chicken", recipe: { id: "chicken", servings: 4, ingredients: [{ item: "chicken thighs", quantityText: "2 lb" }] } };
  const engine = createEngine(doc);
  const rows = [
    { Day: "Sunday, November 15", Meal: "Chicken", planKind: "cook", batchId: "one", batchServings: 6, dinnerServings: 2, components: [{ recipeId: "chicken", role: "complete" }] },
    { Day: "Tuesday, November 17", planKind: "leftover", leftoverOfBatchId: "one", dinnerServings: 2, leftoverStorage: "fridge", components: [{ recipeId: "chicken" }] },
  ];
  const tasks = engine.flattenPrepSections(engine.buildPrepSectionsFromMenuRows(rows, [doc]));
  const proteins = tasks.filter((task) => task.title.startsWith("Confirm protein"));
  assert.equal(proteins.length, 1);
  assert.match(proteins[0].ingredients, /3 lb/);
  assert.ok(tasks.some((task) => task.title.startsWith("Store leftover portions") && task.instructions.includes("within 2 hours")));
  assert.ok(tasks.some((task) => task.title.startsWith("Reheat leftovers") && task.instructions.includes("165 F")));
  assert.ok(tasks.some((task) => task.title.startsWith("Check batch quantities")));
});

test("orphaned or late leftovers generate review warnings rather than new cooking tasks", () => {
  const doc = { id: "chicken", path: "chicken.md", title: "Chicken", recipe: { servings: 4, ingredients: [{ item: "chicken", quantityText: "2 lb" }] } };
  const engine = createEngine(doc);
  const tasks = engine.flattenPrepSections(engine.buildPrepSectionsFromMenuRows([{ Day: "Friday", planKind: "leftover", leftoverOfBatchId: "missing" }], [doc]));
  assert.equal(tasks.length, 1);
  assert.match(tasks[0].title, /Review timing/);
  assert.match(tasks[0].instructions, /missing source/);
});
