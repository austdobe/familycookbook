import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { buildListDraftPreview } from "../src/domain/listDraftPreview.js";

test("real draft preview renders explicit before/after, no-write promise, cancel, apply and busy/error state", async () => {
 const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:"custom"});
 try {
  const {ListDraftPreview}=await server.ssrLoadModule("/src/components/ListDraftPreview.jsx");
  const preview=buildListDraftPreview({weekId:"w",previousGrocerySections:[{title:"Produce",items:[{Item:"Onion",Quantity:"1"}]}],grocerySnapshot:{sections:[{title:"Produce",items:[{Item:"Onion",Quantity:"2"}]}]}});
  let actions=0;
  const html=renderToStaticMarkup(React.createElement(ListDraftPreview,{preview,busy:true,error:"Plan changed. Generate another draft.",onApply(){actions++},onCancel(){actions++},weekTitle:"Test week"}));
  assert.match(html,/Nothing has been applied/); assert.match(html,/Before/); assert.match(html,/Quantity: 1/); assert.match(html,/After/); assert.match(html,/Quantity: 2/);
  assert.match(html,/Cancel draft/); assert.match(html,/Applying\.\.\./); assert.match(html,/disabled/); assert.match(html,/role="alert"/); assert.equal(actions,0);
  const empty=renderToStaticMarkup(React.createElement(ListDraftPreview,{preview:buildListDraftPreview({weekId:"w"})}));
  assert.match(empty,/No item or task changes/); assert.match(empty,/Apply draft lists/);
 } finally {await server.close();}
});
