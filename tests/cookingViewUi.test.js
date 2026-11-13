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
  assert.match(html,/All steps &amp; progress/); assert.match(html,/Start step/); assert.match(html,/Already done/); assert.match(html,/Skip/);
  assert.match(html,/Loading saved prep/); assert.match(html,/Target serving time/);
  assert.match(html,/Saved on this device/); assert.match(html,/no alarms/); assert.match(html,/thermometer/);
  assert.doesNotMatch(html,/undefined|NaN/);
  assert.ok(html.indexOf('What to do now') < html.indexOf('Prep &amp; timing'), "next action precedes reference panels");
  assert.doesNotMatch(html, /<details[^>]* open=""/, "reference panels start collapsed");
  assert.match(html, /More options/);
  assert.match(html, /Work on/);
  const uncertain = renderToStaticMarkup(React.createElement(CookingViewDialog,{components:[{id:"collards",role:"side",title:"Collards",steps:[{text:"Cook bacon."},{text:"Simmer 60–90 minutes."}]},{id:"turkey",role:"main",title:"Turkey",steps:[{text:"Check the turkey is thawed."},{text:"Roast until thermometer confirms doneness."}]}],title:"Dinner",onClose(){}}));
  assert.ok(uncertain.indexOf("Check the turkey is thawed.") < uncertain.indexOf("Cook bacon."));
  assert.match(uncertain, /Timing incomplete/);
  const composedTitle = components.map(component => component.title).join(" + ");
  const compact = renderToStaticMarkup(React.createElement(CookingViewDialog,{components,title:composedTitle,onClose(){}}));
  assert.match(compact, /Tonight&#x27;s meal/);
  assert.match(compact, /Meal details/);
  assert.doesNotMatch(compact, /<h2[^>]*>Rice \+ Turkey<\/h2>/);

  assert.match(uncertain, /Unknown cook times are not treated as zero/);
  const legacy=renderToStaticMarkup(React.createElement(CookingViewDialog,{recipeId:"old",ingredients:[],steps:[{text:"Stir until smooth."}],title:"Sauce",onClose(){}}));
  assert.match(legacy,/Stir until smooth/); assert.match(legacy,/No reliable total time/);
  const empty=renderToStaticMarkup(React.createElement(CookingViewDialog,{components:[{id:"x",title:"Missing",steps:[]}],title:"Incomplete",onClose(){}}));
  assert.match(empty,/no usable directions/); assert.doesNotMatch(empty,/Checklist finished/);
 } finally {await server.close();}
});
