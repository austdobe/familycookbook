import test from "node:test";
import assert from "node:assert/strict";
import { cookingMealTitle } from "../src/domain/cookingTitle.js";
test("generated component labels collapse without guessing a meal name", () => {
  const components = ["Roast turkey", "Bacon collards", "Mashed potatoes", "Stuffing", "Gravy"].map(title => ({title}));
  const title = components.map(c => c.title).join(" + ");
  const result = cookingMealTitle(title, components);
  assert.equal(result.heading, "Tonight's meal");
  assert.equal(result.fullTitle, title);
  assert.equal(result.componentCount, 5);
  assert.equal(result.showDetails, true);
  assert.equal(cookingMealTitle("Thanksgiving dinner", components).heading, "Thanksgiving dinner");
});
test("single dishes and named meals retain their actual names including plus signs", () => {
  assert.equal(cookingMealTitle("Chicken + rice", [{title:"Chicken + rice"}]).heading, "Chicken + rice");
  assert.equal(cookingMealTitle("Sunday supper", [{title:"Chicken"},{title:"Rice"}]).heading, "Sunday supper");
  const long = "A very long but legitimate single recipe name ".repeat(4).trim();
  const result = cookingMealTitle(long, [{title:long}]);
  assert.equal(result.heading,long); assert.equal(result.fullTitle,long); assert.equal(result.showDetails,true);
});
test("oversized composed labels remain available in details when components are unresolved", () => {
  const title = "Thanksgiving feast with roast turkey and several sides ".repeat(4).trim();
  assert.equal(cookingMealTitle(title,[{title:"Missing main recipe"},{title:"Collards"}]).heading,"Tonight's meal");
  assert.equal(cookingMealTitle(title,[{title:"Missing main recipe"},{title:"Collards"}]).fullTitle,title);
});
