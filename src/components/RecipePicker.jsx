import React, { useMemo, useState } from "react";
import { recipeMatchesQuery, recipeProtein, recipeStage } from "../domain/recipeDiscovery.js";

export function RecipePicker({ actionLabel, docs, dragType, getCategory, getMeta, isQuick, onChoose, onRecipeDragEnd, onRecipeDragStart }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [protein, setProtein] = useState("all");
  const [stage, setStage] = useState("all");
  const [quickOnly, setQuickOnly] = useState(false);
  const [draggingRecipeId, setDraggingRecipeId] = useState("");
  const [addedRecipeId, setAddedRecipeId] = useState("");
  const categories = useMemo(() => ["all", ...uniqueValues(docs.map(getCategory).filter(Boolean)).sort()], [docs, getCategory]);
  const proteins = useMemo(() => ["all", ...uniqueValues(docs.map(recipeProtein).filter(Boolean)).sort()], [docs]);
  const filteredDocs = useMemo(() => docs
    .filter((doc) => category === "all" || getCategory(doc) === category)
    .filter((doc) => protein === "all" || recipeProtein(doc).toLowerCase() === protein.toLowerCase())
    .filter((doc) => stage === "all" || recipeStage(doc) === stage)
    .filter((doc) => !quickOnly || isQuick(doc))
    .filter((doc) => recipeMatchesQuery(doc, query))
    .slice(0, 60), [category, docs, getCategory, isQuick, protein, query, quickOnly, stage]);
  const hasFilters = Boolean(query.trim() || category !== "all" || protein !== "all" || stage !== "all" || quickOnly);

  const chooseRecipe = async (doc) => {
    await onChoose(doc);
    setAddedRecipeId(doc.id);
  };

  return (
    <div className="recipe-picker">
      <label className="recipe-picker-search">Search recipes<input onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ingredient, protein, or flavor" type="search" value={query} /></label>
      <div className="recipe-picker-filters">
        <label>Protein<select onChange={(event) => setProtein(event.target.value)} value={protein}>{proteins.map((option) => <option key={option} value={option}>{option === "all" ? "All proteins" : option}</option>)}</select></label>
        <label>Recipe status<select onChange={(event) => setStage(event.target.value)} value={stage}><option value="all">All stages</option><option value="stage-2">Stage 2 - Promoted</option><option value="stage-1">Stage 1 - Draft</option></select></label>
      </div>
      <div className="recipe-picker-categories" aria-label="Recipe categories">
        <button aria-pressed={quickOnly} className={quickOnly ? "active" : ""} onClick={() => setQuickOnly((current) => !current)} type="button">Under 30 min</button>
        {categories.map((option) => <button aria-pressed={category === option} className={category === option ? "active" : ""} key={option} onClick={() => setCategory(option)} type="button">{option === "all" ? "All" : formatLabel(option)}</button>)}
      </div>
      <div className="recipe-picker-results">
        <span>{filteredDocs.length} of {docs.length} recipes</span>
        {hasFilters ? <button className="mini-button" onClick={() => { setQuery(""); setCategory("all"); setProtein("all"); setStage("all"); setQuickOnly(false); }} type="button">Clear filters</button> : null}
      </div>
      <div className="recipe-picker-list">
        {filteredDocs.length ? filteredDocs.map((doc) => (
          <button className={`recipe-picker-item ${draggingRecipeId === doc.id ? "dragging" : ""}`} draggable key={doc.id} onClick={() => chooseRecipe(doc)} onDragEnd={() => { setDraggingRecipeId(""); onRecipeDragEnd?.(); }} onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(dragType, doc.id);
            event.dataTransfer.setData("text/plain", doc.id);
            setDraggingRecipeId(doc.id);
            onRecipeDragStart?.(doc);
          }} title="Drag this recipe onto a week card, or click to set it on the selected card" type="button">
            <span className="recipe-picker-item-copy"><span className="recipe-picker-title">{doc.title}</span><span className="recipe-picker-meta">{getMeta(doc)}</span></span>
            <span className="recipe-picker-add-label">{addedRecipeId === doc.id ? "Added" : actionLabel || "Add"}</span>
          </button>
        )) : <div className="empty recipe-picker-empty">No recipes match that search.</div>}
      </div>
    </div>
  );
}

function uniqueValues(values) { return [...new Set(values)]; }
function formatLabel(value) { return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
