import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("guided cooking renders whole meal next action and preserves source ingredient ownership", async () => {
 const server = await createServer({configFile:false, server:{middlewareMode:true,hmr:false},appType:"custom",define:{"import.meta.env.VITE_FIREBASE_API_KEY":JSON.stringify("")}});
 try {
  const {CookingViewDialog}=await server.ssrLoadModule("/src/components/CookingViewDialog.jsx");
  const components=[{id:"rice",title:"Rice",ingredients:[{quantityText:"1 cup",item:"rice"}],steps:[{text:"Cook for 20 minutes."}]},{id:"turkey",title:"Turkey",ingredients:[{quantityText:"18 lb",item:"turkey"}],steps:[{text:"Roast for 4 hours. Check the temperature."}]}];
  const html=renderToStaticMarkup(React.createElement(CookingViewDialog,{components,title:"Thanksgiving",weekId:"test",sessionId:"test",onClose(){}}));
  assert.match(html,/What to do now/); assert.match(html,/Roast for 4 hours/); assert.match(html,/18 lb/); assert.match(html,/1 cup/);
  assert.match(html,/View full timeline/); assert.match(html,/Start \/ already started/); assert.match(html,/Done \/ already done/); assert.match(html,/Skip/);
  assert.match(html,/Loading saved prep/); assert.match(html,/Target serving time/);
  assert.match(html,/Progress stays on this device/); assert.match(html,/No alarms/); assert.match(html,/thermometer/);
  assert.doesNotMatch(html,/undefined|NaN/);
  const legacy=renderToStaticMarkup(React.createElement(CookingViewDialog,{recipeId:"old",ingredients:[],steps:[{text:"Stir until smooth."}],title:"Sauce",onClose(){}}));
  assert.match(legacy,/Stir until smooth/); assert.match(legacy,/No reliable duration/);
  const empty=renderToStaticMarkup(React.createElement(CookingViewDialog,{components:[{id:"x",title:"Missing",steps:[]}],title:"Incomplete",onClose(){}}));
  assert.match(empty,/no usable directions/); assert.doesNotMatch(empty,/Checklist finished/);
 } finally {await server.close();}
});
