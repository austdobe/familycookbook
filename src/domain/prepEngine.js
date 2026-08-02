import { groceryItemWords, grocerySectionForItem } from "./groceryEngine.js";
import { parsePrepTasks, prepDetailValue } from "./prepTasks.js";

export function createPrepEngine({
  fileNameFromPath,
  findRecipeDocForMenuRow,
  hasMeal,
  instructionSectionsFromMarkdown,
  labeledBulletValues,
  recipeDocsForMenuRow,
  structuredIngredientsFromMarkdown,
}) {
  function flattenPrepSections(sections) {
    return sections.flatMap((section) => parsePrepTasks(section.markdown).map((task) => ({
      checked: false,
      ingredients: prepDetailValue(task.details, "Ingredients"),
      instructions: prepDetailValue(task.details, "Instructions"),
      mealRefs: [prepDetailValue(task.details, "Meal ownership")].filter(Boolean),
      section: section.title,
      storageMethod: prepDetailValue(task.details, "Storage method"),
      title: task.title,
      useByDate: prepDetailValue(task.details, "Use-by date"),
    })));
  }
  
  function buildPrepSectionsFromMenuRows(menuRows, archiveDocs = []) {
    const rows = menuRows.filter(hasMeal);
    if (!rows.length) {
      return [];
    }
  
    const tasks = rows.flatMap((row) => {
      const componentDocs = recipeDocsForMenuRow(row, archiveDocs);
      if (!componentDocs.length) return prepTasksForMenuRow(row, archiveDocs);
      return componentDocs.flatMap((doc) => prepTasksForMenuRow({
        ...row,
        Meal: doc.title,
        components: [],
        "Recipe id": doc.recipe?.id || doc.id,
        "Recipe file": fileNameFromPath(doc.path),
        "Recipe path": doc.path,
      }, [doc]));
    });
    const sections = [
      "Sunday Prep",
      "Midweek Refresh",
      "Cook-Day Reminders",
      "Do Not Prep Ahead",
    ].map((title) => ({
      title,
      tasks: tasks.filter((task) => task.section === title),
    })).filter((section) => section.tasks.length);
  
    return sections.map((section) => ({
      title: section.title,
      markdown: section.tasks.map(renderPrepTaskMarkdown).join("\n"),
    }));
  }
  
  function prepTasksForMenuRow(row, archiveDocs) {
    const doc = findRecipeDocForMenuRow(row, archiveDocs);
    const recipe = recipeForPrep(doc);
    const meal = row.Meal || doc?.title || "Planned meal";
    const useByDate = row.Day || recipe?.bestDayToCook || "Planned cook day";
    const dayIndex = weekdayIndex(useByDate);
    const tasks = [];
  
    if (!recipe) {
      return [prepTask({
        ingredients: "Recipe ingredients",
        instructions: "Review the recipe and prep only items that hold safely before cooking.",
        meal,
        section: "Cook-Day Reminders",
        storageMethod: "Keep refrigerated items cold and shelf-stable items grouped together.",
        title: `Review prep needs for ${meal}`,
        useByDate,
      })];
    }
  
    const proteinIngredients = ingredientsByKind(recipe, "protein");
    const sturdyProduce = ingredientsByKind(recipe, "sturdy-produce");
    const delicateItems = ingredientsByKind(recipe, "delicate");
    const prepAheadIdeas = recipe.prepGuidance?.prepAheadIdeas?.length
      ? recipe.prepGuidance.prepAheadIdeas
      : [recipe.notes?.prepAhead].filter(Boolean);
    const earlySection = dayIndex <= 2 ? "Sunday Prep" : "Midweek Refresh";
    const prepSection = dayIndex <= 3 ? "Sunday Prep" : "Midweek Refresh";
    const componentGroups = prepComponentGroups(recipe);
  
    if (proteinIngredients.length) {
      tasks.push(prepTask({
        ingredients: ingredientAmounts(proteinIngredients),
        instructions: dayIndex <= 2
          ? "Confirm protein is purchased, portioned, and ready for the planned cook day. If frozen, thaw in the refrigerator."
          : "Move frozen protein to the refrigerator early enough to thaw safely before cooking.",
        meal,
        section: earlySection,
        storageMethod: "Covered container or original sealed package in refrigerator below ready-to-eat foods.",
        title: `Confirm protein for ${meal}`,
        useByDate,
      }));
    }
  
    componentGroups.forEach((group) => {
      tasks.push(prepTask({
        ingredients: ingredientAmounts(group.ingredients),
        instructions: group.instructions,
        meal,
        section: group.section || prepSection,
        storageMethod: group.storageMethod,
        title: `${group.title} for ${meal}`,
        useByDate,
      }));
    });
  
    prepAheadIdeas.forEach((idea) => {
      tasks.push(prepTask({
        ingredients: relevantIngredientList(recipe, idea),
        instructions: idea,
        meal,
        section: prepSection,
        storageMethod: "Covered container in refrigerator unless the recipe says otherwise.",
        title: `Prep ahead for ${meal}`,
        useByDate,
      }));
    });
  
    if (sturdyProduce.length) {
      tasks.push(prepTask({
        ingredients: ingredientAmounts(sturdyProduce),
        instructions: "Wash, trim, chop, or portion sturdy vegetables that hold well after cutting.",
        meal,
        section: prepSection,
        storageMethod: "Covered container with a dry paper towel if moisture could soften vegetables.",
        title: `Prep sturdy produce for ${meal}`,
        useByDate,
      }));
    }
  
    if (delicateItems.length || recipe.perishabilityNotes) {
      tasks.push(prepTask({
        ingredients: ingredientAmounts(delicateItems) || "Delicate or texture-sensitive ingredients",
        instructions: recipe.perishabilityNotes || "Do not cut, salt, or mix delicate fresh components too early; prep close to serving for best texture.",
        meal,
        section: "Do Not Prep Ahead",
        storageMethod: "Keep whole and refrigerated until cook day.",
        title: `Hold delicate prep for ${meal}`,
        useByDate,
      }));
    }
  
    return tasks;
  }
  
  function prepTask({ ingredients, instructions, meal, section, storageMethod, title, useByDate }) {
    return { ingredients, instructions, meal, section, storageMethod, title, useByDate };
  }
  
  function recipeForPrep(doc) {
    if (!doc) {
      return null;
    }
    if (doc.recipe) {
      return doc.recipe;
    }
  
    const markdown = doc.markdown || "";
    const planningSummary = labeledBulletValues(markdown, "Planning Summary");
    const notes = labeledBulletValues(markdown, "Notes");
    const ingredients = structuredIngredientsFromMarkdown(markdown);
    if (!ingredients.length) {
      return null;
    }
  
    return {
      bestDayToCook: planningSummary["Best day to cook"] || "",
      cuisine: planningSummary["Cuisine or flavor direction"] || "",
      ingredients,
      instructionSections: instructionSectionsFromMarkdown(markdown),
      notes: {
        prepAhead: notes["Prep-ahead ideas"] || "",
        testing: notes["What might need testing"] || "",
        familyPreferenceConcerns: notes["Family preference concerns"] || "",
      },
      perishabilityNotes: planningSummary["Perishability notes"] || "",
      prepGuidance: {
        prepAheadIdeas: notes["Prep-ahead ideas"] ? [notes["Prep-ahead ideas"]] : [],
      },
      protein: planningSummary.Protein || "",
    };
  }
  
  function renderPrepTaskMarkdown(task) {
    return [
      `- [ ] ${task.title}`,
      `  - Ingredients: ${task.ingredients || "Recipe ingredients"}`,
      `  - Instructions: ${task.instructions || "Read the recipe and prep only what holds well."}`,
      `  - Storage method: ${task.storageMethod || "Covered container in refrigerator unless the recipe says otherwise."}`,
      `  - Use-by date: ${task.useByDate || "Planned cook day"}`,
      `  - Meal ownership: ${task.meal || "Planned meal"}`,
    ].join("\n");
  }
  
  function ingredientsByKind(recipe, kind) {
    return (recipe.ingredients || []).filter((ingredient) => {
      const item = ingredient.item || "";
      const words = new Set(groceryItemWords(item));
      if (kind === "protein") {
        return ["chicken", "beef", "steak", "pork", "salmon", "turkey", "ham", "shrimp", "fish", "sausage"].some((word) => words.has(word));
      }
      if (kind === "delicate") {
        return ["avocado", "basil", "cilantro", "cucumber", "lettuce", "lime", "mango", "parsley", "pineapple", "romaine", "tomato", "yogurt"].some((word) => words.has(word));
      }
      if (kind === "sturdy-produce") {
        return (ingredient.groceryCategory === "Produce" || grocerySectionForItem(item) === "Produce")
          && !ingredientsByKind({ ingredients: [ingredient] }, "delicate").length;
      }
      if (kind === "pantry") {
        return ["Pantry and Dry Goods", "Sauces, Condiments, and Spices", "Bakery"].includes(ingredient.groceryCategory || grocerySectionForItem(item));
      }
      return false;
    });
  }
  
  function prepComponentGroups(recipe) {
    const groups = [
      {
        key: "marinade",
        patterns: ["marinade", "rub"],
        title: "Make marinade",
        instructions: "Mix these marinade ingredients in a labeled container. Add the protein only if the recipe says it can marinate ahead; otherwise keep the marinade separate until cook day.",
        storageMethod: "Covered labeled container in the refrigerator.",
      },
      {
        key: "sauce",
        patterns: ["sauce", "gravy", "dressing", "tzatziki", "yogurt", "glaze"],
        title: "Mix sauce or dressing",
        instructions: "Mix these sauce or dressing ingredients together, label the container, and keep it cold until the meal.",
        storageMethod: "Covered labeled container in the refrigerator unless all ingredients are shelf-stable.",
      },
      {
        key: "salsa",
        patterns: ["salsa", "slaw", "pickle", "pickled", "topping"],
        title: "Prep fresh topping",
        instructions: "Chop and combine only the sturdy topping ingredients. Hold salt, citrus, herbs, and juicy produce until closer to serving if texture could suffer.",
        storageMethod: "Covered container in the refrigerator; keep wet/salty finishing ingredients separate if needed.",
      },
      {
        key: "starch",
        patterns: ["rice", "grain", "pasta", "potato", "potatoes", "bread"],
        title: "Measure starch or bread components",
        instructions: "Measure or group these starch/bread ingredients so the cook-day step is ready. Do not cook ahead unless the recipe specifically says reheating works well.",
        storageMethod: "Shelf-stable items in a labeled bin; refrigerated items kept cold.",
        section: "Cook-Day Reminders",
      },
    ];
  
    return groups
      .map((group) => ({
        ...group,
        ingredients: ingredientsByUse(recipe, group.patterns),
      }))
      .filter((group) => group.ingredients.length);
  }
  
  function ingredientsByUse(recipe, patterns) {
    return (recipe.ingredients || []).filter((ingredient) => {
      const useText = `${ingredient.notes || ""} ${ingredient.usedIn || ""} ${ingredient.sourceRow?.Notes || ""}`.toLowerCase();
      return patterns.some((pattern) => useText.includes(pattern));
    });
  }
  
  function relevantIngredientList(recipe, text) {
    const words = new Set(groceryItemWords(text));
    const matches = (recipe.ingredients || [])
      .filter((ingredient) => groceryItemWords(ingredient.item).some((word) => words.has(word)))
      .filter(Boolean);
    const noteMatches = prepComponentGroups(recipe)
      .filter((group) => groceryItemWords(`${group.key} ${group.title}`).some((word) => words.has(word)))
      .flatMap((group) => group.ingredients);
    const combined = uniqueIngredients([...matches, ...noteMatches]);
    return combined.length ? ingredientAmounts(combined) : ingredientAmounts((recipe.ingredients || []).slice(0, 8));
  }
  
  function ingredientNames(ingredients) {
    return ingredients.map((ingredient) => ingredient.item || ingredient.Ingredient || ingredient.Item || "").filter(Boolean).join(", ");
  }
  
  function ingredientAmounts(ingredients) {
    return ingredients
      .map((ingredient) => {
        const quantity = ingredient.quantityText || ingredient.Quantity || "";
        const item = ingredient.item || ingredient.Ingredient || ingredient.Item || "";
        return [quantity, item].filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join(", ");
  }
  
  function uniqueIngredients(ingredients) {
    const seen = new Set();
    return ingredients.filter((ingredient) => {
      const key = `${ingredient.quantityText || ingredient.Quantity || ""}|${ingredient.item || ingredient.Ingredient || ingredient.Item || ""}`.toLowerCase();
      if (!key.trim() || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  function weekdayIndex(value) {
    const text = String(value || "").toLowerCase();
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const index = days.findIndex((day) => text.includes(day));
    return index === -1 ? 3 : index;
  }

  return {
    buildPrepSectionsFromMenuRows,
    flattenPrepSections,
  };
}
