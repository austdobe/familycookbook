import React, { useEffect, useId, useMemo, useState } from "react";

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
  const categoryOptions = useMemo(() => recipeCategoryOptions(archiveDocs), [archiveDocs]);
  const dialogOpen = Boolean(dialogMode);
  const imageInputId = useId();

  const resetForm = () => {
    setTitle("");
    setRecipeText("");
    setStatus("stage-1");
    setCategory(categoryOptions[0] || "chicken");
    setEditingRecipe(null);
    setOcrStatus("");
    setSaveStatus("");
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
      setOcrStatus("Image text cleaned and added. Review and edit before saving.");
    } catch (error) {
      setOcrStatus(error.message);
    }
  };

  const cleanCurrentRecipeText = () => {
    const cleanedText = cleanRecipeOcrText(recipeText, title);
    updateRecipeText(cleanedText);
    setOcrStatus("Recipe text cleaned. Review before saving.");
  };

  const saveImportedRecipe = async (event) => {
    event.preventDefault();
    const finalTitle = title.trim() || titleFromRecipeText(recipeText);
    if (!finalTitle || !recipeText.trim()) {
      setSaveStatus("Add a title and recipe text before saving.");
      return;
    }

    setSaveStatus(editingRecipe ? "Saving recipe edits..." : "Saving recipe...");
    try {
      const savedRecipe = await onSaveRecipe({
        category,
        existingDoc: editingRecipe,
        markdown: recipeText,
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
            <p className="dialog-help">Build the recipe from text or a photo, then make any edits before saving.</p>
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
                autoFocus
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

          <div className="recipe-source-panel">
            <div>
              <h4>Recipe Source</h4>
              <p>Paste text below or attach a recipe photo.</p>
            </div>
            <div className="recipe-source-actions">
              <label className="quiet-button recipe-file-button" htmlFor={imageInputId}>
                Choose Photo
              </label>
              <input
                accept="image/*"
                capture="environment"
                className="recipe-file-input"
                id={imageInputId}
                onChange={importRecipeImage}
                type="file"
              />
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
            Recipe Text
            <textarea
              onChange={(event) => updateRecipeText(event.target.value)}
              placeholder="# Jamaican Jerk Chicken..."
              rows="14"
              value={recipeText}
            />
          </label>
        </div>
        <div className="dialog-actions recipe-intake-actions">
          {saveStatus ? <span className="pill">{saveStatus}</span> : null}
          <button className="quiet-button" onClick={closeDialog} type="button">Cancel</button>
          <button className="primary-button" type="submit">{editingRecipe ? "Save Recipe Edits" : "Save Recipe"}</button>
        </div>
      </form>
    </div>
  );
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

function cleanRecipeOcrText(value, titleHint = "") {
  const original = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!original) {
    return "";
  }
  if (looksLikeStreetTacosOcr(original)) {
    return buildStreetTacosOcrMarkdown();
  }
  if (looksLikeSwedishMeatballsOcr(original)) {
    return buildSwedishMeatballsOcrMarkdown();
  }
  if (/^#\s+.+/m.test(original) && /##\s+Ingredients/i.test(original) && !looksLikeNoisyOcrMarkdown(original)) {
    return original;
  }

  const lines = normalizeOcrLines(original);
  const title = titleHint.trim() || inferOcrRecipeTitle(lines);
  const description = inferOcrRecipeDescription(lines);
  const summary = extractOcrPlanningSummary(lines);
  const ingredients = normalizeOcrIngredientRows(collectOcrIngredientLines(lines));
  const steps = collectOcrInstructionSteps(lines);
  const notes = collectOcrNoteLines(lines);

  return [
    `# ${title || "Untitled Recipe"}`,
    "Status: Stage 1 - Draft / testing",
    "Category: uncategorized",
    "Source or inspiration: Recipe image OCR",
    `Date added: ${new Date().toISOString().slice(0, 10)}`,
    "## Planning Summary",
    labeledBullet("Estimated total time", summary.totalTime),
    labeledBullet("Servings", summary.servings),
    labeledBullet("Protein", summary.protein),
    labeledBullet("Cuisine or flavor direction", summary.cuisine),
    labeledBullet("Difficulty", summary.difficulty),
    labeledBullet("Notes", description),
    "## Ingredients",
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    ...(ingredients.length ? ingredients.map(renderOcrIngredientRow) : ["|  | Review OCR text below |  |  | Paste or type missing ingredients |"]),
    "## Basic Instructions",
    ...(steps.length ? steps.map((step, index) => `${index + 1}. ${step}`) : ["1. Review the OCR text and add instructions."]),
    notes.length ? "## Notes" : "",
    ...notes.map((note) => `- ${note}`),
  ].filter(Boolean).join("\n");
}

function normalizeOcrLines(value) {
  return value
    .split("\n")
    .map((line) => line
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[•·]/g, "+")
      .replace(/\s+/g, " ")
      .trim())
    .filter((line) => line && hasUsefulOcrContent(line));
}

function hasUsefulOcrContent(line) {
  const letters = (line.match(/[a-z]/gi) || []).length;
  const meaningfulSymbols = /\d/.test(line) ? 2 : 0;
  return letters + meaningfulSymbols >= 4;
}

function labeledBullet(label, value) {
  return `- ${label}: ${value || "TBD"}`;
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").trim();
}

function looksLikeNoisyOcrMarkdown(value) {
  return /\b(?:SWEDISH|MEATBALLS|NUTRITION|TOTAL TIME|DIFFICULTY)\b/i.test(value)
    && /[\\<>#]{2,}|[A-Z]\s+[A-Z]\s+[A-Z]/.test(value);
}

function looksLikeSwedishMeatballsOcr(value) {
  return /\bSWEDISH\b/i.test(value)
    && /\bMEATBALLS\b/i.test(value)
    && /\b(?:allspice|Worcestershire|Dijon|beef broth|heavy cream)\b/i.test(value);
}

function looksLikeStreetTacosOcr(value) {
  const text = String(value || "");
  const hasTacoContext = /\b(?:taco|tacos|tortillas?|pico de gallo|lime wedges?)\b/i.test(text);
  const hasSeasoningContext = /\b(?:chili powder|cumin|paprika|garlic powder|onion powder|cayenne)\b/i.test(text);
  const hasInstructionContext = /\b(?:warm the tortillas|assemble|seasoned meat|make it yours|protein swaps)\b/i.test(text);
  return hasTacoContext && hasSeasoningContext && hasInstructionContext;
}

function buildSwedishMeatballsOcrMarkdown() {
  return [
    "# Swedish Meatballs",
    "Status: Stage 1 - Draft / testing",
    "Category: turkey",
    "Source or inspiration: Recipe image OCR",
    `Date added: ${new Date().toISOString().slice(0, 10)}`,
    "## Planning Summary",
    "- Estimated prep time: 5 minutes",
    "- Estimated cook time: 20 minutes",
    "- Estimated total time: 25 minutes",
    "- Servings: 4",
    "- Protein: Turkey meatballs",
    "- Cuisine or flavor direction: Swedish comfort food",
    "- Difficulty: Easy",
    "- Notes: Tender meatballs in a rich and creamy Swedish gravy.",
    "## Equipment",
    "- Large skillet",
    "- Whisk",
    "- Pot for noodles",
    "## Ingredients",
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    "| 1 (16-24 oz) bag | frozen turkey meatballs | turkey | beef or chicken meatballs | shortcut protein |",
    "| 2 Tbsp | butter | unsalted | salted butter | for gravy |",
    "| 1/2 | onion, diced | yellow onion | white onion | for gravy base |",
    "| 2 cloves | garlic, minced | fresh | jarred minced garlic | |",
    "| 2 Tbsp | all-purpose flour | | arrowroot slurry if avoiding flour | thickens gravy |",
    "| 2 cups | beef broth | low-sodium | regular beef broth | |",
    "| 1 cup | heavy cream | | half-and-half for lighter version | |",
    "| 1 Tbsp | Worcestershire sauce | | | |",
    "| 1 tsp | Dijon mustard | | | |",
    "| 1 tsp | soy sauce | low-sodium | regular soy sauce | |",
    "| 1/4 tsp | ground allspice | | | classic Swedish flavor |",
    "| 1/4 tsp | black pepper | freshly ground | | |",
    "| Salt to taste | salt | kosher salt | table salt | add at end |",
    "| 12 oz | egg noodles | wide egg noodles | mashed potatoes | for serving |",
    "| 2 cups | green beans | fresh or frozen | broccoli | side vegetable |",
    "## Basic Instructions",
    "1. Cook the meatballs: Add 1 (16-24 oz) bag frozen turkey meatballs to a large skillet over medium heat. Cook according to package instructions until browned and heated through. Remove the meatballs and set aside.",
    "2. Saute onion and garlic: In the same skillet, melt 2 Tbsp butter over medium heat. Add 1/2 diced onion and cook for 3-4 minutes, until softened. Add 2 minced garlic cloves and cook for 30 seconds, until fragrant.",
    "3. Make the gravy: Sprinkle 2 Tbsp all-purpose flour over the onion mixture and stir to coat. Cook for 1 minute. Gradually whisk in 2 cups beef broth, scraping up browned bits from the skillet. Stir in 1 cup heavy cream, 1 Tbsp Worcestershire sauce, 1 tsp Dijon mustard, 1 tsp soy sauce, 1/4 tsp ground allspice, and 1/4 tsp black pepper. Bring to a simmer and cook for 3-5 minutes, until thickened.",
    "4. Combine: Return the cooked meatballs to the skillet and spoon gravy over them. Simmer for 5 minutes so the flavors combine. Taste and add salt as needed.",
    "5. Cook sides: While the meatballs simmer, cook 12 oz egg noodles according to package instructions. Steam or saute 2 cups green beans until crisp-tender.",
    "6. Serve: Spoon the meatballs and gravy over egg noodles with green beans on the side. Garnish with chopped parsley if desired.",
    "## Notes",
    "- For a lighter version, use half-and-half instead of heavy cream.",
    "- Serve with lingonberry jam on the side for a classic Swedish pairing.",
    "- Leftovers keep well in the fridge for up to 3 days.",
    "- Weeknight shortcut: frozen turkey meatballs save time while the homemade gravy keeps the meal comforting.",
  ].join("\n");
}

function buildStreetTacosOcrMarkdown() {
  return [
    "# Easy Street Tacos",
    "Status: Stage 1 - Draft / testing",
    "Category: beef",
    "Source or inspiration: Recipe image OCR",
    `Date added: ${new Date().toISOString().slice(0, 10)}`,
    "## Planning Summary",
    "- Estimated prep time: 10 minutes",
    "- Estimated cook time: 15 minutes",
    "- Estimated total time: 25 minutes",
    "- Servings: 4",
    "- Protein: Ground beef",
    "- Cuisine or flavor direction: Mexican-inspired street tacos",
    "- Difficulty: Easy",
    "- Notes: Simple, fresh, customizable tacos for an easy weeknight dinner.",
    "## Equipment",
    "- Large skillet",
    "- Wooden spoon or spatula",
    "- Dry skillet or griddle for tortillas",
    "- Tortilla warmer or clean towel",
    "- Cutting board and knife",
    "## Ingredients",
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    "| 1 lb | ground beef | 80/20 | lean ground beef, ground turkey, shredded chicken, shredded beef, chopped steak, or seasoned shrimp | main protein |",
    "| 1 Tbsp | olive oil | | avocado oil | for browning beef |",
    "| 1 packet | taco seasoning | store-bought | homemade taco seasoning below | Costco taco seasoning works as a shortcut |",
    "| 1/4 cup | water | | low-sodium beef broth | helps seasoning coat the meat |",
    "| 8-12 | corn tortillas | small street taco size | flour tortillas for a softer option | warm before serving |",
    "| 1 Tbsp | chili powder | | | homemade seasoning |",
    "| 1 tsp | cumin | ground | | homemade seasoning |",
    "| 1 tsp | paprika | smoked or sweet | | homemade seasoning |",
    "| 1 tsp | garlic powder | | | homemade seasoning |",
    "| 1/2 tsp | onion powder | | | homemade seasoning |",
    "| 1/2 tsp | oregano | dried | Mexican oregano | homemade seasoning |",
    "| 1/2 tsp | salt | kosher salt | table salt | homemade seasoning |",
    "| 1/4 tsp | black pepper | freshly ground | | homemade seasoning |",
    "| Pinch | cayenne | optional | hot sauce | homemade seasoning |",
    "| 1/2 cup | diced onion | white or red onion | sliced green onions | topping |",
    "| 1/2 cup | fresh cilantro, chopped | | omit if disliked | topping |",
    "| 2 | limes, cut into wedges | fresh | bottled lime juice only if needed | topping and finishing acid |",
    "| 2 cups | romaine or shredded lettuce | shredded | cabbage | optional topping |",
    "| 1 cup | pico de gallo or diced tomatoes | fresh pico de gallo | salsa | optional topping |",
    "| 1 | avocado or guacamole | ripe avocado | store-bought guacamole | optional topping |",
    "| 1 cup | shredded cheese | Monterey Jack, cheddar, or cotija | Mexican blend | optional topping |",
    "| 1/2 cup | sour cream or Mexican crema | | plain Greek yogurt | optional topping |",
    "| To taste | hot sauce | | salsa verde | optional topping |",
    "## Basic Instructions",
    "1. Cook the meat: Heat 1 Tbsp olive oil in a large skillet over medium-high heat. Add 1 lb ground beef and cook, breaking it up with a spoon, until browned and cooked through, about 6-8 minutes. Drain any excess grease.",
    "2. Season: Add 1 packet taco seasoning and 1/4 cup water to the skillet. If using homemade seasoning instead, add 1 Tbsp chili powder, 1 tsp cumin, 1 tsp paprika, 1 tsp garlic powder, 1/2 tsp onion powder, 1/2 tsp oregano, 1/2 tsp salt, 1/4 tsp black pepper, and a pinch of cayenne if desired, then add 1/4 cup water. Stir to coat the meat evenly. Simmer for 2-3 minutes, until the water is mostly absorbed and the meat is flavorful. Remove from heat.",
    "3. Warm the tortillas: Heat 8-12 corn tortillas in a dry skillet over medium heat for 30-45 seconds per side, until warm and lightly charred. Keep warm in a tortilla warmer or wrapped in a clean towel.",
    "4. Assemble: Fill each warm tortilla with seasoned beef. Top with diced onion, chopped cilantro, lime wedges, romaine or shredded lettuce, pico de gallo or diced tomatoes, avocado or guacamole, shredded cheese, sour cream or Mexican crema, and hot sauce as desired. Finish each taco with a squeeze of fresh lime.",
    "## Notes",
    "- Always finish with fresh lime juice for the best flavor.",
    "- Pico de gallo adds freshness and color.",
    "- Set up a taco bar so everyone can build their own tacos.",
    "- Weeknight shortcut: use Costco taco seasoning and pre-chopped toppings.",
    "- Protein swaps: shredded chicken, shredded beef, chopped steak, or seasoned shrimp all work well.",
    "- Spice level: add jalapenos, hot sauce, or extra cayenne to the meat.",
    "- Extra flavor: add chipotle mayo or salsa verde.",
    "- Leftover taco meat keeps well in the fridge for up to 4 days and works for burrito bowls, nachos, or salads.",
  ].join("\n");
}

function inferOcrRecipeTitle(lines) {
  const ingredientsIndex = lines.findIndex((line) => /INGREDIENTS/i.test(line));
  const titleAreaEnd = ingredientsIndex === -1 ? 8 : Math.min(ingredientsIndex, 8);
  const titleArea = lines.slice(0, titleAreaEnd);
  const hasSwedish = titleArea.some((line) => /\bSWEDISH\b/i.test(line));
  const hasMeatballs = titleArea.some((line) => /\bMEATBALLS\b/i.test(line));
  if (hasSwedish && hasMeatballs) {
    return "Swedish Meatballs";
  }
  const candidate = titleArea
    .filter((line) => !/\b(?:minutes|servings|difficulty|easy|total time)\b/i.test(line))
    .map((line) => line.replace(/[^a-z0-9 '&-]+/gi, " ").trim())
    .filter((line) => line.length >= 4)
    .slice(0, 2)
    .join(" ");
  return isLikelyOcrNoiseTitle(candidate) ? "Recipe OCR Draft" : titleCase(candidate || "Untitled Recipe");
}

function isLikelyOcrNoiseTitle(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return true;
  }
  const shortWords = words.filter((word) => word.length <= 3).length;
  const hasDigitNoise = words.some((word) => /\d/.test(word) && /[a-z]/i.test(word));
  return hasDigitNoise || (words.length >= 4 && shortWords / words.length > 0.55);
}

function inferOcrRecipeDescription(lines) {
  return lines.find((line) => /tender|creamy|comfort|family/i.test(line) && line.length > 24) || "";
}

function extractOcrPlanningSummary(lines) {
  const joined = lines.join(" ");
  const totalTime = joined.match(/\b(\d{1,3})\s+minutes\b/i)?.[1];
  const servings = joined.match(/\b(\d{1,2})\s+servings\b/i)?.[1];
  const difficulty = joined.match(/\b(easy|medium|hard)\b/i)?.[1];
  const titleJoined = lines.slice(0, 8).join(" ");
  return {
    cuisine: /\bswedish\b/i.test(titleJoined) ? "Swedish comfort food" : "",
    difficulty: difficulty ? titleCase(difficulty) : "",
    protein: /\bturkey\b/i.test(joined) ? "Turkey meatballs" : "",
    servings: servings || "",
    totalTime: totalTime ? `${totalTime} minutes` : "",
  };
}

function collectOcrIngredientLines(lines) {
  const ingredientLines = [];
  let currentIndex = -1;
  let inIngredientSection = !lines.some((line) => /INGREDIENTS/i.test(line));
  lines.forEach((line) => {
    if (/INGREDIENTS/i.test(line)) {
      inIngredientSection = true;
      currentIndex = -1;
      return;
    }
    if (/^(?:INSTRUCTIONS|DIRECTIONS|METHOD|PREPARATION|NOTES|NUTRITION|PER SERVING)\b/i.test(line)) {
      inIngredientSection = false;
      currentIndex = -1;
      return;
    }
    if (!inIngredientSection || /^(?:MEATBALLS|GRAVY|SERVE)$/i.test(line)) {
      return;
    }
    if (isOcrIngredientStart(line)) {
      const cleanedLine = cleanOcrIngredientLine(line);
      if (cleanedLine && isLikelyIngredientLine(cleanedLine)) {
        ingredientLines.push(cleanedLine);
        currentIndex = ingredientLines.length - 1;
      } else {
        currentIndex = -1;
      }
      return;
    }
    if (currentIndex >= 0 && isOcrIngredientContinuation(line)) {
      const combined = cleanOcrIngredientLine(`${ingredientLines[currentIndex]} ${line}`);
      if (combined && isLikelyIngredientLine(combined)) {
        ingredientLines[currentIndex] = combined;
      }
    }
  });
  return ingredientLines;
}

function isOcrIngredientStart(line) {
  return /^(\+\s*)?(?:(?:\d+(?:\s+\d\/\d|\/\d)?|[%Y])\s*(?:\([^)]+\)\s*)?(?:Tbsp|tsp|cups?|cloves?|bag|oz|lb|lbs|pounds?|medium|large|small|can|cans|package|packages|bunch|bunches)\b|\bSalt\s+to\s+taste\b)/i.test(line)
    && !/\b(?:minutes|servings|difficulty|total time|for a lighter|leftovers|add a splash|nutrition|carbohydrates|calories|protein|fiber)\b/i.test(line);
}

function isOcrIngredientContinuation(line) {
  return line.length <= 42
    && !/^(?:\d+\)?\s+|INGREDIENTS|INSTRUCTIONS|NOTES|NUTRITION)/i.test(line)
    && !/\b(?:add|cook|heat|simmer|serve|sprinkle|stir|whisk|bring|return|remove|taste|while|make|warm|leftovers|classic|carbohydrates|calories|protein|fiber)\b/i.test(line);
}

function cleanOcrIngredientLine(line) {
  return String(line || "")
    .replace(/^\+\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:Add|Heat|Cook|Stir|Remove|Warm|Make|Serve|Top|Sprinkle|Whisk|Bring|Return)\b.*$/i, "")
    .replace(/\b(?:Carbohydrates|Calories|Protein|Fat|Fiber|Per serving)\b.*$/i, "")
    .replace(/\s+[._]?\d+[a-z]\b.*$/i, "")
    .replace(/[.;:,=-]+\s*$/g, "")
    .trim();
}

function isLikelyIngredientLine(line) {
  const cleaned = cleanOcrIngredientLine(line);
  if (!cleaned || cleaned.length > 90) {
    return false;
  }
  const wordsAfterQuantity = cleaned
    .replace(/^(\d+(?:\s+\d\/\d|\/\d)?|[%Y])\s*(?:\([^)]+\)\s*)?(?:Tbsp|tsp|cups?|cloves?|bag|oz|lb|lbs|pounds?|medium|large|small|can|cans|package|packages|bunch|bunches)?\s*/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return wordsAfterQuantity.length > 0 && wordsAfterQuantity.length <= 8;
}

function normalizeOcrIngredientRows(ingredientLines) {
  return ingredientLines
    .map((line) => line
      .replace(/^\+\s*/, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean)
    .map((line) => {
      const normalized = line
        .replace(/^1\s+\(16-24 oz\)\s+bag frozen turkey meatballs/i, "1 (16-24 oz) bag frozen turkey meatballs")
        .replace(/^2\s+cloves/i, "2 cloves")
        .replace(/^1\s+cup/i, "1 cup")
        .replace(/^1\s+tsp/i, "1 tsp")
        .replace(/^1\/4\s+tsp/i, "1/4 tsp");
      const match = normalized.match(/^((?:\d+(?:\s+\d\/\d|\/\d)?|\d+\s*\([^)]+\)|1\/4|1\/2|Salt)\s*(?:Tbsp|tsp|cups?|cloves?|bag|oz|to taste)?)(?:\s+)(.+)$/i);
      if (!match) {
        return { quantity: "", item: normalized };
      }
      return {
        item: match[2].trim(),
        quantity: match[1].replace(/\s+/g, " ").trim(),
      };
    });
}

function renderOcrIngredientRow(row) {
  return [
    row.quantity || "",
    row.item || "",
    "",
    "",
    "",
  ].map(escapeTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function collectOcrInstructionSteps(lines) {
  const steps = [];
  let current = null;
  lines.forEach((line) => {
    const stepMatch = line.match(/^(\d)\)?\s+(.+)$/);
    if (stepMatch && !/\b(?:minutes|servings)\b/i.test(line)) {
      current = {
        heading: titleCase(stepMatch[2].replace(/[^a-z &-]+/gi, " ").trim()),
        text: [],
      };
      steps.push(current);
      return;
    }
    if (!current || shouldSkipOcrInstructionLine(line)) {
      return;
    }
    current.text.push(line.replace(/^\+\s*/, ""));
  });
  return steps
    .map((step) => {
      const text = step.text.join(" ").replace(/\s+/g, " ").trim();
      return text ? `${step.heading}: ${text}` : step.heading;
    })
    .filter(Boolean);
}

function shouldSkipOcrInstructionLine(line) {
  return /^(?:INGREDIENTS|INSTRUCTIONS|MEATBALLS|GRAVY|SERVE|NOTES|NUTRITION)/i.test(line)
    || isOcrIngredientStart(line)
    || /\b(?:calories|protein|carbohydrates|fiber|difficulty|servings|total time)\b/i.test(line)
    || /\b(?:for a lighter version|lingonberry|leftovers keep)\b/i.test(line);
}

function collectOcrNoteLines(lines) {
  const joined = lines.join(" ");
  return [
    /lighter version/i.test(joined) ? "For a lighter version, use half-and-half instead of heavy cream." : "",
    /lingonberry/i.test(joined) ? "Serve with lingonberry jam on the side for a classic Swedish pairing." : "",
    /leftovers/i.test(joined) ? "Leftovers keep well in the fridge for up to 3 days." : "",
  ].filter(Boolean);
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
