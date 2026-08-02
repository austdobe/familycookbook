import React, { useEffect, useId, useMemo, useState } from "react";
import {
  analyzeRecipeImport,
  analyzeRecipeReadiness,
  emptyBuilderIngredient,
  emptyRecipeBuilderDraft,
  recipeBuilderDraftFromText,
  recipeBuilderDraftToMarkdown,
} from "../domain/recipeImport.js";
import { cleanRecipeOcrText } from "../domain/recipeOcr.js";

const baseUrl = import.meta.env.BASE_URL;

export function RecipeImportDialog({
  archiveDocs,
  dialogMode,
  onClose,
  onSaveRecipe,
  onSaved,
  selectedRecipe,
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("chicken");
  const [status, setStatus] = useState("stage-1");
  const [recipeText, setRecipeText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [ocrStatus, setOcrStatus] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [editorTab, setEditorTab] = useState("import");
  const [importAnalysis, setImportAnalysis] = useState(null);
  const [builderDraft, setBuilderDraft] = useState(() => emptyRecipeBuilderDraft());
  const categoryOptions = useMemo(() => recipeCategoryOptions(archiveDocs), [archiveDocs]);
  const dialogOpen = Boolean(dialogMode);
  const imageInputId = useId();
  const readiness = useMemo(() => {
    if (!dialogOpen || (!title.trim() && !recipeText.trim() && editorTab !== "builder")) {
      return null;
    }
    if (editorTab === "builder") {
      return analyzeRecipeReadiness({ draft: builderDraft, title });
    }
    const analysis = analyzeRecipeImport(recipeText);
    return analyzeRecipeReadiness({ draft: analysis.draft, title: title.trim() || analysis.title });
  }, [builderDraft, dialogOpen, editorTab, recipeText, title]);

  const resetForm = () => {
    setTitle("");
    setRecipeText("");
    setStatus("stage-1");
    setCategory(categoryOptions[0] || "chicken");
    setEditingRecipe(null);
    setOcrStatus("");
    setSaveStatus("");
    setEditorTab("import");
    setImportAnalysis(null);
    setBuilderDraft(emptyRecipeBuilderDraft());
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImagePreviewUrl("");
  };

  useEffect(() => {
    if (!dialogMode) {
      return;
    }

    if (dialogMode === "edit" && selectedRecipe) {
      const recipeStatus = selectedRecipe.recipe?.status || (stageForRecipeDoc(selectedRecipe) === "Stage 2" ? "stage-2" : "stage-1");
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      setEditingRecipe(selectedRecipe);
      setSaveStatus("");
      setTitle(selectedRecipe.title || "");
      setCategory(normalizeRecipeCategory(selectedRecipe.recipe?.category || pathCategory(selectedRecipe.path) || "uncategorized"));
      setStatus(recipeStatus);
      setRecipeText(selectedRecipe.markdown || "");
      setEditorTab("builder");
      setImportAnalysis(null);
      setBuilderDraft(recipeBuilderDraftFromDoc(selectedRecipe));
      setOcrStatus("");
      setImagePreviewUrl("");
      return;
    }

    resetForm();
  }, [dialogMode, selectedRecipe?.id]);

  useEffect(() => {
    if (!dialogOpen) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dialogOpen, onClose]);

  const closeDialog = () => {
    resetForm();
    onClose?.();
  };

  const updateRecipeText = (value) => {
    setRecipeText(value);
    if (!title.trim()) {
      const inferredTitle = titleFromRecipeText(value);
      if (inferredTitle) {
        setTitle(inferredTitle);
      }
    }
  };

  const importRecipeImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImagePreviewUrl(URL.createObjectURL(file));
    setOcrStatus("Reading recipe image...");
    try {
      const extractedText = await readTextFromRecipeImage(file, setOcrStatus);
      if (!extractedText.trim()) {
        setOcrStatus("No text was detected. Paste or type the recipe below.");
        return;
      }
      const cleanedText = cleanRecipeOcrText(extractedText);
      updateRecipeText([recipeText, cleanedText].filter((part) => part.trim()).join("\n\n"));
      setEditorTab("import");
      setOcrStatus("Image text cleaned and added. Review what was recognized next.");
    } catch (error) {
      setOcrStatus(error.message);
    }
  };

  const cleanCurrentRecipeText = () => {
    const cleanedText = cleanRecipeOcrText(recipeText, title);
    updateRecipeText(cleanedText);
    setOcrStatus("Recipe text cleaned. Review before saving.");
  };

  const openBuilderTab = () => {
    if (recipeText.trim()) {
      const analysis = analyzeRecipeImport(recipeText);
      setBuilderDraft(analysis.draft);
      setImportAnalysis(analysis);
    }
    setEditorTab("builder");
  };

  const reviewImportedRecipe = () => {
    if (!recipeText.trim()) {
      setSaveStatus("Paste a recipe or choose a photo first.");
      return;
    }
    const analysis = analyzeRecipeImport(recipeText);
    setBuilderDraft(analysis.draft);
    setImportAnalysis(analysis);
    if (!title.trim() && analysis.title) setTitle(analysis.title);
    setSaveStatus(analysis.ready ? "Recipe recognized. Review the fields before saving." : analysis.warnings[0]);
    setEditorTab("builder");
  };

  const openMarkdownTab = () => {
    if (editorTab === "builder") {
      setRecipeText(recipeBuilderDraftToMarkdown({ builderDraft, category, status, title }));
    }
    setEditorTab("markdown");
  };


  const saveImportedRecipe = async (event) => {
    event.preventDefault();
    if (editorTab === "import") {
      reviewImportedRecipe();
      return;
    }
    const markdownToSave = editorTab === "builder"
      ? recipeBuilderDraftToMarkdown({ builderDraft, category, status, title })
      : recipeText;
    const finalTitle = title.trim() || titleFromRecipeText(markdownToSave);
    if (!finalTitle || !markdownToSave.trim()) {
      setSaveStatus("Add a title and recipe text before saving.");
      return;
    }

    const saveAnalysis = analyzeRecipeImport(markdownToSave);
    const saveReadiness = analyzeRecipeReadiness({ draft: saveAnalysis.draft, title: finalTitle });
    if (saveReadiness.status === "invalid") {
      setSaveStatus(saveReadiness.blockers[0]);
      return;
    }
    if (status === "stage-2" && saveReadiness.status !== "ready") {
      setSaveStatus(`Stage 2 requires a ready recipe. ${saveReadiness.warnings[0]}`);
      return;
    }

    setSaveStatus(editingRecipe ? "Saving recipe edits..." : "Saving recipe...");
    try {
      const savedRecipe = await onSaveRecipe({
        category,
        existingDoc: editingRecipe,
        markdown: markdownToSave,
        status,
        title: finalTitle,
      });
      resetForm();
      setSaveStatus(`Saved ${savedRecipe.title}.`);
      onClose?.();
      onSaved?.({ id: savedRecipe.id });
    } catch (error) {
      setSaveStatus(`Recipe save failed: ${error.message}`);
    }
  };

  if (!dialogOpen) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
      <form
        aria-label={editingRecipe ? "Edit recipe" : "Add recipe"}
        className="card grocery-dialog recipe-intake-dialog recipe-intake-form"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={saveImportedRecipe}
      >
        <div className="dialog-header">
          <div>
            <h3>{editingRecipe ? "Edit Recipe" : "Add Recipe"}</h3>
            <p className="dialog-help">Paste a recipe or choose a photo, review what was recognized, then save.</p>
          </div>
          <button
            aria-label="Close dialog"
            className="icon-button"
            onClick={closeDialog}
            type="button"
          >
            x
          </button>
        </div>
        <div className="recipe-intake-body">
          <div className="recipe-intake-details">
            <label className="recipe-title-field">
              Title
              <input
                autoFocus={Boolean(editingRecipe)}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Jamaican Jerk Chicken"
                value={title}
              />
            </label>
            <label>
              Category
              <input
                list="recipe-category-options"
                onChange={(event) => setCategory(event.target.value)}
                placeholder="chicken"
                value={category}
              />
              <datalist id="recipe-category-options">
                {categoryOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </label>
            <label>
              Status
              <select onChange={(event) => setStatus(event.target.value)} value={status}>
                <option value="stage-1">Stage 1 - Draft / testing</option>
                <option value="stage-2">Stage 2 - Promoted family recipe</option>
              </select>
            </label>
          </div>

          <div className="recipe-editor-tabs" role="tablist" aria-label="Recipe editor mode">
            <button
              aria-selected={editorTab === "import"}
              className={editorTab === "import" ? "active" : ""}
              onClick={() => setEditorTab("import")}
              role="tab"
              type="button"
            >
              Paste / Import
            </button>
            <button
              aria-selected={editorTab === "builder"}
              className={editorTab === "builder" ? "active" : ""}
              onClick={openBuilderTab}
              role="tab"
              type="button"
            >
              Review Recipe
            </button>
            <button
              aria-selected={editorTab === "markdown"}
              className={editorTab === "markdown" ? "active" : ""}
              onClick={openMarkdownTab}
              role="tab"
              type="button"
            >
              Markdown
            </button>
          </div>

          {editorTab === "import" ? (
            <div className="recipe-markdown-editor" role="tabpanel">
              <div className="recipe-source-panel">
                <div>
                  <h4>Paste or photograph a recipe</h4>
                  <p>Markdown works best, but ordinary Ingredients and Directions sections are recognized too.</p>
                </div>
                <div className="recipe-source-actions">
                  <label className="quiet-button recipe-file-button" htmlFor={imageInputId}>Choose Photo</label>
                  <input accept="image/*" capture="environment" className="recipe-file-input" id={imageInputId} onChange={importRecipeImage} type="file" />
                  <button className="quiet-button" disabled={!recipeText.trim()} onClick={cleanCurrentRecipeText} type="button">Clean Text</button>
                </div>
                {(imagePreviewUrl || ocrStatus) ? (
                  <div className="recipe-source-feedback">
                    {imagePreviewUrl ? <img className="recipe-image-preview" src={imagePreviewUrl} alt="Imported recipe" /> : null}
                    {ocrStatus ? <span className="pill">{ocrStatus}</span> : null}
                  </div>
                ) : null}
              </div>
              <label className="recipe-text-field">
                Recipe text
                <textarea autoFocus={!editingRecipe} onChange={(event) => updateRecipeText(event.target.value)} placeholder={"# Recipe name\n\nIngredients\n- 1 lb chicken\n\nDirections\n1. Heat the oven..."} rows="18" value={recipeText} />
              </label>
            </div>
          ) : editorTab === "builder" ? (
            <div className="recipe-builder" role="tabpanel">
              {importAnalysis ? (
                <div className={`recipe-import-summary ${importAnalysis.ready ? "ready" : "needs-review"}`}>
                  <strong>Recognized {importAnalysis.ingredientCount} ingredients and {importAnalysis.directionCount} directions.</strong>
                  {importAnalysis.blockers.length || importAnalysis.warnings.length ? <ul>{[...importAnalysis.blockers, ...importAnalysis.warnings].map((warning) => <li key={warning}>{warning}</li>)}</ul> : <span>Everything needed for grocery and cooking guidance was found.</span>}
                </div>
              ) : null}
              <section className="recipe-builder-section">
                <h4>Planning Details</h4>
                <div className="recipe-builder-planning-grid">
                  {[
                    ["servings", "Servings", "4-6"],
                    ["prepTime", "Prep time", "20 minutes"],
                    ["cookTime", "Cook time", "40 minutes"],
                    ["protein", "Protein", "Chicken thighs"],
                    ["cuisine", "Cuisine / flavor", "Summer BBQ"],
                  ].map(([field, label, placeholder]) => (
                    <label key={field}>
                      {label}
                      <input
                        onChange={(event) => setBuilderDraft((current) => ({ ...current, [field]: event.target.value }))}
                        placeholder={placeholder}
                        value={builderDraft[field]}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="recipe-builder-section">
                <h4>Equipment</h4>
                <label>
                  One item per line
                  <textarea
                    className="recipe-builder-compact-textarea"
                    onChange={(event) => setBuilderDraft((current) => ({ ...current, equipment: event.target.value }))}
                    placeholder={"Grill\nSmall saucepan\nInstant-read thermometer"}
                    rows="4"
                    value={builderDraft.equipment}
                  />
                </label>
              </section>

              <section className="recipe-builder-section">
                <div className="recipe-builder-section-heading">
                  <h4>Ingredients</h4>
                  <button
                    className="quiet-button"
                    onClick={() => setBuilderDraft((current) => ({ ...current, ingredients: [...current.ingredients, emptyBuilderIngredient()] }))}
                    type="button"
                  >
                    Add Ingredient
                  </button>
                </div>
                <div className="recipe-builder-rows">
                  {builderDraft.ingredients.map((ingredient, index) => (
                    <div className="recipe-builder-ingredient-row" key={`ingredient-${index}`}>
                      {[
                        ["quantity", "Quantity", "2 lb"],
                        ["item", "Ingredient", "Chicken thighs"],
                        ["preferred", "Preferred type", "Bone-in, skin-on"],
                        ["alternatives", "Alternatives", "Boneless thighs"],
                        ["notes", "Notes", "Main protein"],
                      ].map(([field, label, placeholder]) => (
                        <label key={field}>
                          {label}
                          <input
                            onChange={(event) => setBuilderDraft((current) => ({
                              ...current,
                              ingredients: current.ingredients.map((row, rowIndex) => (
                                rowIndex === index ? { ...row, [field]: event.target.value } : row
                              )),
                            }))}
                            placeholder={placeholder}
                            value={ingredient[field]}
                          />
                        </label>
                      ))}
                      <button
                        className="mini-button"
                        disabled={builderDraft.ingredients.length === 1}
                        onClick={() => setBuilderDraft((current) => ({
                          ...current,
                          ingredients: current.ingredients.filter((_, rowIndex) => rowIndex !== index),
                        }))}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="recipe-builder-section">
                <div className="recipe-builder-section-heading">
                  <h4>Directions</h4>
                  <button
                    className="quiet-button"
                    onClick={() => setBuilderDraft((current) => ({ ...current, directions: [...current.directions, ""] }))}
                    type="button"
                  >
                    Add Step
                  </button>
                </div>
                <div className="recipe-builder-rows">
                  {builderDraft.directions.map((step, index) => (
                    <div className="recipe-builder-direction-row" key={`direction-${index}`}>
                      <span>{index + 1}</span>
                      <textarea
                        className="recipe-builder-step-textarea"
                        onChange={(event) => setBuilderDraft((current) => ({
                          ...current,
                          directions: current.directions.map((value, rowIndex) => rowIndex === index ? event.target.value : value),
                        }))}
                        placeholder="Name the exact ingredient amounts and include visual doneness cues."
                        rows="3"
                        value={step}
                      />
                      <button
                        className="mini-button"
                        disabled={builderDraft.directions.length === 1}
                        onClick={() => setBuilderDraft((current) => ({
                          ...current,
                          directions: current.directions.filter((_, rowIndex) => rowIndex !== index),
                        }))}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="recipe-builder-section">
                <h4>Notes</h4>
                <textarea
                  className="recipe-builder-compact-textarea"
                  onChange={(event) => setBuilderDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="One note per line"
                  rows="4"
                  value={builderDraft.notes}
                />
              </section>
            </div>
          ) : (
            <div className="recipe-markdown-editor" role="tabpanel">
              <label className="recipe-text-field">
                Full Markdown
                <textarea onChange={(event) => updateRecipeText(event.target.value)} placeholder="# Jamaican Jerk Chicken..." rows="18" value={recipeText} />
              </label>
            </div>
          )}
        </div>
        {readiness ? (
          <section className={`recipe-readiness recipe-import-summary ${readiness.status}`} aria-live="polite">
            <div className="recipe-readiness-heading">
              <strong>{readiness.status === "ready" ? "Ready to Plan" : readiness.status === "needs-review" ? "Needs Review" : "Invalid Recipe"}</strong>
              <span>
                {readiness.ingredientCount} ingredient{readiness.ingredientCount === 1 ? "" : "s"} · {readiness.directionCount} direction{readiness.directionCount === 1 ? "" : "s"}
              </span>
            </div>
            {readiness.blockers.length || readiness.warnings.length ? (
              <ul>{[...readiness.blockers, ...readiness.warnings].map((issue) => <li key={issue}>{issue}</li>)}</ul>
            ) : <p>This recipe can create grocery and cooking guidance.</p>}
            {readiness.status === "needs-review" && status === "stage-1" ? <p>You can save this as a Stage 1 draft and finish it later.</p> : null}
          </section>
        ) : null}
        <div className="dialog-actions recipe-intake-actions">
          {saveStatus ? <span className="pill">{saveStatus}</span> : null}
          <button className="quiet-button" onClick={closeDialog} type="button">Cancel</button>
          <button className="primary-button" type="submit">{editorTab === "import" ? "Review Parsed Recipe" : editingRecipe ? "Save Recipe Edits" : "Save Recipe"}</button>
        </div>
      </form>
    </div>
  );
}

function recipeBuilderDraftFromDoc(doc) {
  const recipe = doc?.recipe || {};
  const fromText = recipeBuilderDraftFromText(doc?.markdown || "", emptyRecipeBuilderDraft());
  const ingredients = (recipe.ingredients || []).map((ingredient) => ({
    quantity: ingredient.quantityText || ingredient.Quantity || "",
    item: ingredient.item || ingredient.Ingredient || ingredient.Item || "",
    preferred: ingredient.preferredType || ingredient["Preferred version/type"] || "",
    alternatives: ingredient.acceptableAlternatives || ingredient["Acceptable alternatives"] || "",
    notes: ingredient.notes || ingredient.usedIn || ingredient.Notes || "",
  })).filter((ingredient) => ingredient.item);
  const directions = (recipe.instructionSections || [])
    .flatMap((section) => section.steps || [])
    .map((step) => step.text || String(step || ""))
    .filter(Boolean);
  return {
    ...fromText,
    servings: recipe.servings || fromText.servings,
    prepTime: recipe.estimatedPrepMinutes ? `${recipe.estimatedPrepMinutes} minutes` : fromText.prepTime,
    cookTime: recipe.estimatedCookMinutes ? `${recipe.estimatedCookMinutes} minutes` : fromText.cookTime,
    protein: recipe.protein || fromText.protein,
    cuisine: recipe.cuisine || fromText.cuisine,
    equipment: recipe.equipment?.length ? recipe.equipment.join("\n") : fromText.equipment,
    ingredients: ingredients.length ? ingredients : fromText.ingredients,
    directions: directions.length ? directions : fromText.directions,
  };
}

async function readTextFromRecipeImage(file, onProgress = () => {}) {
  onProgress("Loading OCR engine...");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    corePath: `${baseUrl}vendor/tesseract/core`,
    langPath: `${baseUrl}vendor/tesseract/lang`,
    logger: (message) => {
      if (message.status === "loading tesseract core") {
        onProgress("Loading OCR engine...");
      }
      if (message.status === "loading language traineddata") {
        onProgress("Loading OCR language data...");
      }
      if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
        onProgress(`Reading recipe image... ${Math.round(message.progress * 100)}%`);
      }
    },
    workerPath: `${baseUrl}vendor/tesseract/worker.min.js`,
  });

  try {
    const result = await worker.recognize(file);
    return result.data.text || "";
  } finally {
    await worker.terminate();
  }
}

function titleFromRecipeText(value) {
  return String(value || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function recipeCategoryOptions(archiveDocs) {
  const defaults = ["chicken", "beef", "pork", "turkey", "seafood", "pasta", "lunches", "breakfast", "sides", "sauces", "desserts"];
  const categories = (archiveDocs || [])
    .map((doc) => doc.recipe?.category || pathCategory(doc.path))
    .filter(Boolean)
    .map(normalizeRecipeCategory);
  return [...new Set([...categories, ...defaults])].sort();
}

function normalizeRecipeCategory(value) {
  return String(value || "uncategorized")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "uncategorized";
}

function pathCategory(path) {
  const parts = String(path || "").split("/");
  const archiveIndex = parts.indexOf("recipe-archive");
  return archiveIndex === -1 ? "" : parts[archiveIndex + 1] || "";
}

function stageForRecipeDoc(doc) {
  const markdownStage = String(doc?.markdown || "").match(/^Status:\s*(.+)$/im)?.[1] || "";
  const stage = markdownStage.match(/Stage\s+\d+/i);
  return stage ? stage[0].replace(/\bstage\b/i, "Stage") : "";
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();
}
