import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { withMealName, mealDisplayName } from "../src/domain/mealNames.js";
test("composed name editor and cooking header share persisted and cleared names", async () => {
 const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:"custom",define:{"import.meta.env.VITE_FIREBASE_API_KEY":JSON.stringify("")}});
 try {
  const {WeekMealAssignmentPanel}=await server.ssrLoadModule("/src/components/WeekEditors.jsx");
  const {CookingViewDialog}=await server.ssrLoadModule("/src/components/CookingViewDialog.jsx");
  const original={Day:"Thursday",Meal:"Turkey + Collards",mealType:"composed",components:[{recipeId:"turkey",role:"main"},{recipeId:"collards",role:"side"}]};
  const saved=JSON.parse(JSON.stringify(withMealName(original,"Thanksgiving dinner")));
  const editor=renderToStaticMarkup(React.createElement(WeekMealAssignmentPanel,{selectedRow:saved,archiveDocs:[],components:saved.components,initialMealStyle:"composed",onSaveMealName(){},pickerProps:{}}));
  assert.match(editor,/Meal name \(optional\)/);assert.match(editor,/value="Thanksgiving dinner"/);assert.match(editor,/Save meal name/);
  const components=[{id:"turkey",title:"Turkey",steps:[{text:"Prepare turkey."}]},{id:"collards",title:"Collards",steps:[{text:"Prepare greens."}]}];
  const cooking=renderToStaticMarkup(React.createElement(CookingViewDialog,{components,title:mealDisplayName(saved),onClose(){}}));
  assert.match(cooking,/>Thanksgiving dinner<\/h2>/);
  const cleared=withMealName(saved,"");
  assert.equal(mealDisplayName(cleared),"Thursday's meal");
  assert.deepEqual(cleared.components,original.components);
  const single=renderToStaticMarkup(React.createElement(WeekMealAssignmentPanel,{selectedRow:{Day:"Monday",Meal:"Soup",mealType:"complete_recipe",components:[{recipeId:"soup",role:"complete"}]},archiveDocs:[],components:[],initialMealStyle:"complete",onSaveMealName(){},pickerProps:{}}));
  assert.doesNotMatch(single,/Meal name \(optional\)/);
 }finally{await server.close();}
});
