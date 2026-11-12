import test from "node:test";
import assert from "node:assert/strict";
import { buildListDraftPreview } from "../src/domain/listDraftPreview.js";
import { serializePrepTasks } from "../src/domain/prepTasks.js";

const sections = (items) => [{title:"Produce",items}];
test("preview describes additions removals and exact quantity/spec changes without modifying inputs", () => {
 const previous = sections([{Item:"Onion",Quantity:"1", "Preferred version/type":"red"},{Item:"Garlic",Quantity:"1 bulb"}]);
 const next = sections([{Item:"Onion",Quantity:"2", "Preferred version/type":"red"},{Item:"Carrot",Quantity:"3"}]);
 const original = JSON.stringify([previous,next]);
 const result = buildListDraftPreview({weekId:"w",previousGrocerySections:previous,grocerySnapshot:{sections:next}});
 assert.deepEqual([result.grocery.added,result.grocery.removed,result.grocery.modified],[1,1,1]);
 const change = result.grocery.changes.find((change)=>change.kind==="modified");
 assert.match(change.before,/Quantity: 1/); assert.match(change.after,/Quantity: 2/);
 assert.match(change.after,/Preferred version\/type: red/);
 assert.equal(JSON.stringify([previous,next]),original);
});
test("stable grocery and prep identities show rename/move as change, not delete/add", () => {
 const key="w|grocery|produce|onion";
 const before=[{title:"Produce",items:[{Item:"Onion",_grocerySourceKey:key}]}];
 const after=[{title:"Other",items:[{Item:"Red onion",_grocerySourceKey:key}]}];
 const prep=(title,task)=>[{title,markdown:serializePrepTasks([{key:"w|prep|task",title:task,details:"- Amount: 2"}])}];
 const result=buildListDraftPreview({weekId:"w",previousGrocerySections:before,grocerySnapshot:{sections:after},previousPrepSections:prep("Sunday","Chop"),prepSnapshot:{sections:prep("Monday","Slice")}});
 assert.equal(result.grocery.modified,1); assert.equal(result.prep.modified,1);
 assert.equal(result.prep.added,0); assert.match(result.prep.changes[0].after,/Monday\nSlice/);
 assert.doesNotMatch(result.prep.changes[0].after,/prep-key/);
});
test("preview retains notes-only changes and duplicated legacy items", () => {
 const result=buildListDraftPreview({weekId:"w",previousGrocerySections:sections([{Item:"Onion"},{Item:"Onion",Quantity:"2"}]),grocerySnapshot:{sections:sections([{Item:"Onion"}])},previousPrepSections:[{title:"Notes",markdown:"Old note"}],prepSnapshot:{sections:[{title:"Notes",markdown:"New note"}]}});
 assert.equal(result.grocery.removed,1); assert.match(result.grocery.changes[0].before,/Quantity: 2/); assert.equal(result.prep.modified,1);
});
test("empty and unchanged drafts have no changes", () => {
 assert.equal(buildListDraftPreview({weekId:"w"}).hasChanges,false);
 const s=sections([{Item:"Onion",Quantity:"2"}]);
 assert.equal(buildListDraftPreview({weekId:"w",previousGrocerySections:s,grocerySnapshot:{sections:s}}).hasChanges,false);
});
