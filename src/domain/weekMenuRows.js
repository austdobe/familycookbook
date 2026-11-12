export function clearMenuRowForDay(rows, day) {
  return rows.map((row) => {
    if (row.Day !== day) {
      return row;
    }
    return {
      ...row,
      Meal: "",
      planKind: "",
      batchId: "",
      leftoverOfBatchId: "",
      batchServings: null,
      dinnerServings: null,
      leftoverStorage: "",
      components: [],
      mealType: "",
      Notes: "",
      "Cuisine/flavor": "",
      "Perishability reason": "",
      "Plan source": "",
      Protein: "",
      "Recipe id": "",
      recipeId: "",
      "Recipe file": "",
      "Recipe path": "",
      Stage: "",
    };
  });
}

// Free-text flexibility is not a new cooking commitment. Attached recipes and
// explicit cooking plans take precedence over a title containing "leftovers".
export function mealPlanCounts(rows = []) {
  return rows.reduce((counts, row) => {
    const title = String(row.Meal || "").trim();
    const recipe = row.components?.some((component) => component.recipeId) || row["Recipe id"] || row.recipeId || row["Recipe path"] || row["Recipe file"];
    if (row.planKind === "leftover") counts.leftovers++;
    else if (row.planKind === "flexible" || (!recipe && row.planKind !== "cook" && /^(flex(?:ible)?(?:\s+night)?|leftovers?(?:\s*[/&+]|$)|take[ -]?out|eat(?:ing)? out|dine out|free night|off night)/i.test(title))) counts.flexible++;
    else if (recipe || title || row.Protein || row["Cuisine/flavor"]) counts.cooks++;
    return counts;
  }, { cooks: 0, leftovers: 0, flexible: 0 });
}
