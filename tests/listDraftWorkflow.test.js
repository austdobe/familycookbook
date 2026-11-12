import test from "node:test";
import assert from "node:assert/strict";
import {savePlanningMenu,applyReviewedLists,draftFingerprint} from "../src/domain/listDraftWorkflow.js";

test("meal edits save only plan and preserve existing list fields byte for byte", async () => {
 const week={id:"w",grocerySections:[{items:[{Item:"custom"}]}],prepSections:[{markdown:"custom prep"}]};
 const calls=[]; const next=await savePlanningMenu({week,menuRows:[{Meal:"new"}],recipePaths:[],onSaveWorkingWeek:async w=>calls.push(w),saveWeekPlanState:async (...args)=>calls.push(args)});
 assert.equal(calls.length,2);assert.deepEqual(next.grocerySections,week.grocerySections);assert.deepEqual(next.prepSections,week.prepSections);assert.equal(week.menuRows,undefined);
});
const draft={context:"same",original:{grocery:{sections:[]},prep:{sections:[]}},grocery:{sections:["new groceries"]},prep:{sections:["new prep"]}};
test("review apply writes exactly the reviewed snapshots, only after checking both current lists", async()=>{
 const calls=[];await applyReviewedLists({draft,getContext:()=>"same",readLists:async()=>{calls.push("read");return draft.original},saveGrocery:async s=>calls.push(s),savePrep:async s=>calls.push(s)});
 assert.deepEqual(calls,["read",draft.grocery,draft.prep]);
});
test("stale plans, direct list edits and checks block all draft writes",async()=>{
 for(const current of [{context:"changed",lists:draft.original},{context:"same",lists:{...draft.original,grocery:{checkedKeys:["checked"]}}}]){
 let writes=0;await assert.rejects(applyReviewedLists({draft,getContext:()=>current.context,readLists:async()=>current.lists,saveGrocery:()=>writes++,savePrep:()=>writes++}),/fresh draft/);assert.equal(writes,0);
 }
});
test("plan change during recheck blocks draft writes",async()=>{
 let context="same",writes=0;await assert.rejects(applyReviewedLists({draft,getContext:()=>context,readLists:async()=>{context="changed";return draft.original},saveGrocery:()=>writes++,savePrep:()=>writes++}),/fresh draft/);assert.equal(writes,0);
});
test("partial save reports what took effect and waits for both results",async()=>{
 let grocerySaved=false;await assert.rejects(applyReviewedLists({draft,getContext:()=>"same",readLists:async()=>draft.original,saveGrocery:async()=>{grocerySaved=true},savePrep:async()=>{throw Error("disk full")}}),/Grocery list applied/);assert.equal(grocerySaved,true);
});
test("fingerprints ignore object property ordering but retain array order",()=>{
 assert.equal(draftFingerprint({a:1,b:2}),draftFingerprint({b:2,a:1}));assert.notEqual(draftFingerprint([1,2]),draftFingerprint([2,1]));
});


test("app wiring never generates fallback working-week lists or writes lists on meal saves", async () => {
 const {readFile}=await import("node:fs/promises");const source=await readFile(new URL("../src/main.jsx",import.meta.url),"utf8");
 const save=source.split("async function saveWeekMenuRows")[1].split("function activeMenuRowsForWeek")[0];
 assert.doesNotMatch(save,/saveGroceryState|savePrepState|buildGrocerySections|buildPrepSections/);
 const working=source.split("function workingWeekToAppWeek")[1].split("function compareWeeks")[0];
 assert.doesNotMatch(working,/buildGrocerySections|buildPrepSections/);
 assert.match(working,/grocerySections: week.grocerySections \|\| \[\]/);
 const create=source.split("async function saveNewPlanningWeek")[1].split("async function saveWeekMenuRows")[0];
 assert.match(create,/grocerySnapshotVersion: 1/);assert.match(create,/snapshotVersion: 1/);
});
test("draft reads use server-only access and block pending local writes",async()=>{
 const {readFile}=await import("node:fs/promises");
 for(const kind of ["grocery","prep"]){const source=await readFile(new URL(`../src/services/${kind}Store.js`,import.meta.url),"utf8");const fresh=source.split("export async function getFresh")[1];assert.match(fresh,/getDocFromServer/);assert.equal((fresh.match(/assertNoPending/g)||[]).length,2);}
});
