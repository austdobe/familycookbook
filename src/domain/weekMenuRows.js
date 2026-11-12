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
