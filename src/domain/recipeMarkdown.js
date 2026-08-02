export function createRecipeMarkdownTools({
  cleanRecipeOcrText,
  extractIngredientTableRows,
  extractIngredientSourceRows,
  extractPlainTextIngredientRows,
  grocerySectionForItem,
  ingredientTableLines,
  isLikelyPerishableItem,
  parseQuantityParts,
}) {
  function recipeFromMarkdownForSave({ archiveDocs, category, existingDoc = null, markdown, status, title }) {
    const now = new Date().toISOString();
    const normalizedCategory = normalizeRecipeCategory(category || "uncategorized");
    const existingRecipe = existingDoc?.recipe || {};
    const recipeId = existingRecipe.id || existingDoc?.id || uniqueRecipeId(slugFromTitle(title), archiveDocs);
    const canonicalMarkdown = canonicalRecipeMarkdownForSave(markdown, title, status, normalizedCategory);
    const ingredients = structuredIngredientsFromMarkdown(canonicalMarkdown);
    const planningSummary = labeledBulletValues(canonicalMarkdown, "Planning Summary");
    const notes = labeledBulletValues(canonicalMarkdown, "Notes");
    return {
      ...existingRecipe,
      id: recipeId,
      title,
      status,
      statusLabel: status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing",
      category: normalizedCategory,
      source: topMetadataValue(markdown, "Source or inspiration"),
      dateAdded: existingRecipe.dateAdded || topMetadataValue(markdown, "Date added") || now.slice(0, 10),
      lastUpdated: now.slice(0, 10),
      version: existingRecipe.version || "1.0",
      servings: numericValue(planningSummary.Servings),
      estimatedPrepMinutes: minutesValue(planningSummary["Estimated prep time"]),
      estimatedCookMinutes: minutesValue(planningSummary["Estimated cook time"]),
      protein: planningSummary.Protein || "",
      cuisine: planningSummary["Cuisine or flavor direction"] || "",
      bestDayToCook: planningSummary["Best day to cook"] || "",
      perishabilityNotes: planningSummary["Perishability notes"] || "",
      difficulty: planningSummary.Difficulty || "",
      equipment: bulletItems(canonicalMarkdown, "Equipment"),
      ingredients,
      instructionSections: instructionSectionsFromMarkdown(canonicalMarkdown),
      notes: {
        testing: notes["What might need testing"] || "",
        substitutions: notes["Possible substitutions"] || "",
        prepAhead: notes["Prep-ahead ideas"] || "",
        familyPreferenceConcerns: notes["Family preference concerns"] || "",
        raw: notes,
      },
      prepGuidance: {
        prepAheadIdeas: notes["Prep-ahead ideas"] ? [notes["Prep-ahead ideas"]] : [],
        doNotPrepAhead: [],
        perishabilityNotes: planningSummary["Perishability notes"] || "",
        bestDayToCook: planningSummary["Best day to cook"] || "",
      },
      archivedMarkdownPath: existingRecipe.archivedMarkdownPath || existingDoc?.path || `recipe-archive/${normalizedCategory}/${recipeId}.md`,
      sourceMarkdown: canonicalMarkdown,
      createdAt: existingRecipe.createdAt || now,
      updatedAt: now,
    };
  }
  
  function uniqueRecipeId(baseId, archiveDocs) {
    const usedIds = new Set(archiveDocs.map((doc) => doc.id));
    const usedPaths = new Set(archiveDocs.map((doc) => doc.path));
    const hasUsedPath = (id) => [...usedPaths].some((usedPath) => usedPath.endsWith(`/${id}.md`));
    if (!usedIds.has(baseId) && !hasUsedPath(baseId)) {
      return baseId;
    }
    let index = 2;
    while (usedIds.has(`${baseId}-${index}`) || hasUsedPath(`${baseId}-${index}`)) {
      index += 1;
    }
    return `${baseId}-${index}`;
  }
  
  function normalizeMarkdownForRecipe(markdown, title, status, category) {
    const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
    const withTitle = /^#\s+.+$/m.test(text) ? text : `# ${title}\n\n${text}`;
    const lines = withTitle.split("\n");
    const firstHeadingIndex = lines.findIndex((line) => /^#\s+/.test(line));
    const insertIndex = firstHeadingIndex === -1 ? 0 : firstHeadingIndex + 1;
    const statusLine = `Status: ${status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing"}`;
    const categoryLine = `Category: ${formatCategoryLabel(category)}`;
    let hasStatus = false;
    let hasCategory = false;
    const normalizedLines = lines.map((line) => {
      if (/^Status:\s*/i.test(line)) {
        hasStatus = true;
        return statusLine;
      }
      if (/^Category:\s*/i.test(line)) {
        hasCategory = true;
        return categoryLine;
      }
      return line;
    });
    const inserts = [
      hasStatus ? "" : statusLine,
      hasCategory ? "" : categoryLine,
    ].filter(Boolean);
    if (!inserts.length) {
      return normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n");
    }
    return [
      ...normalizedLines.slice(0, insertIndex),
      ...inserts,
      ...normalizedLines.slice(insertIndex),
    ].join("\n").replace(/\n{3,}/g, "\n\n");
  }
  
  function canonicalRecipeMarkdownForSave(markdown, title, status, category) {
    const metadataNormalized = normalizeMarkdownForRecipe(markdown, title, status, category);
    if (extractIngredientTableRows(metadataNormalized).length) {
      return metadataNormalized;
    }
  
    const plainIngredientRows = extractPlainTextIngredientRows(metadataNormalized);
    const cleaned = plainIngredientRows.length
      ? buildCanonicalMarkdownFromPlainRecipe(metadataNormalized, title, status, category, plainIngredientRows)
      : cleanRecipeOcrText(metadataNormalized, title);
    const canonicalMarkdown = normalizeMarkdownForRecipe(cleaned, title, status, category);
    if (!extractIngredientTableRows(canonicalMarkdown).length) {
      throw new Error("No ingredients could be recognized. Add an Ingredients section with one ingredient per line, or use the ingredient table format.");
    }
    return canonicalMarkdown;
  }
  
  function buildCanonicalMarkdownFromPlainRecipe(markdown, title, status, category, ingredientRows) {
    const equipment = plainTextSectionLines(markdown, "equipment", "ingredients");
    const instructionSteps = plainTextInstructionSteps(markdown);
    const source = topMetadataValue(markdown, "Source or inspiration");
    const dateAdded = topMetadataValue(markdown, "Date added");
    const planningRows = [
      labeledBullet("Servings", plainRecipeMetadataValue(markdown, "Servings")),
      labeledBullet("Estimated prep time", plainRecipeMetadataValue(markdown, "Prep Time")),
      labeledBullet("Estimated cook time", plainRecipeMetadataValue(markdown, "Cook Time")),
      labeledBullet("Total time", plainRecipeMetadataValue(markdown, "Total Time")),
    ].filter(Boolean);
    const tableRows = ingredientRows.map((row) => ({
      quantityText: row.Quantity || "",
      item: row.Ingredient || row.Item || "",
      preferredType: row["Preferred version/type"] || "",
      acceptableAlternatives: row["Acceptable alternatives"] || "",
      notes: row.Notes || "",
    }));
  
    return [
      `# ${title}`,
      "",
      `Status: ${status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing"}`,
      `Category: ${formatCategoryLabel(category)}`,
      source ? `Source or inspiration: ${source}` : "",
      dateAdded ? `Date added: ${dateAdded}` : "",
      "",
      "## Planning Summary",
      "",
      ...(planningRows.length ? planningRows : ["- Servings: Review and add"]),
      "",
      "## Equipment",
      "",
      ...(equipment.length ? equipment.map((item) => `- ${item}`) : ["- Review and add equipment"]),
      "",
      "## Ingredients",
      "",
      ...ingredientTableLines(tableRows),
      "",
      "## Basic Instructions",
      "",
      ...(instructionSteps.length
        ? instructionSteps.map((step, index) => `${index + 1}. ${step}`)
        : ["1. Review the source recipe and add instructions."]),
      "",
      "## Notes",
      "",
      "- Converted automatically from pasted recipe text. Review formatting before promoting.",
    ].filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  
  function plainRecipeMetadataValue(markdown, label) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return String(markdown || "").match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
  }
  
  function plainTextSectionLines(markdown, startHeading, endHeading) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const startPattern = new RegExp(`^#{0,6}\\s*${startHeading}\\s*:?\\s*$`, "i");
    const endPattern = new RegExp(`^#{0,6}\\s*${endHeading}\\s*:?\\s*$`, "i");
    const start = lines.findIndex((line) => startPattern.test(line.trim()));
    if (start === -1) {
      return [];
    }
    const result = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index].replace(/^\s*[-*+]\s+/, "").trim();
      if (endPattern.test(line)) {
        break;
      }
      if (line) {
        result.push(line);
      }
    }
    return result;
  }
  
  function plainTextInstructionSteps(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const start = lines.findIndex((line) => /^(?:#{0,6}\s*)?(?:directions?|instructions?|method|preparation|steps)\s*:?\s*$/i.test(line.trim()));
    if (start === -1) {
      return [];
    }
    const steps = [];
    let current = null;
    lines.slice(start + 1).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      const match = line.match(/^\d+\.\s+(.+)$/);
      if (match) {
        current = [match[1]];
        steps.push(current);
      } else if (current) {
        current.push(line);
      }
    });
    return steps.map((parts) => parts.join(": "));
  }
  
  function structuredIngredientsFromMarkdown(markdown) {
    return extractIngredientSourceRows(markdown).map((row, index) => {
      const quantityText = row.Quantity || "";
      const parsedQuantity = parseQuantityParts(quantityText);
      const item = row.Ingredient || row.Item || "";
      return {
        id: `ingredient-${index + 1}`,
        quantityText,
        quantityValue: numericValue(parsedQuantity.quantity),
        unit: parsedQuantity.unit,
        item,
        preferredType: row["Preferred version/type"] || row.Preferred || "",
        acceptableAlternatives: row["Acceptable alternatives"] || row.Alternatives || "",
        notes: row.Notes || row["Used in"] || "",
        groceryCategory: grocerySectionForItem(item),
        usedIn: row["Used in"] || row.Notes || "",
        optional: Object.values(row).some((value) => /\boptional\b/i.test(String(value || ""))),
        perishable: isLikelyPerishableItem(item),
        sourceRow: row,
      };
    });
  }
  
  function instructionSectionsFromMarkdown(markdown) {
    const knownSections = ["Basic Instructions", "Detailed Instructions"].flatMap((heading) => {
      const body = sectionMarkdown(markdown, heading);
      const steps = instructionStepsFromText(body);
      return steps.length ? [{ title: heading, steps }] : [];
    });
    if (knownSections.length) {
      return knownSections;
    }

    const fallback = looseInstructionSection(markdown);
    return fallback.steps.length ? [fallback] : [];
  }

  function looseInstructionSection(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const headingPattern = /^(?:#{0,6}\s*)?(directions?|instructions?|method|preparation|steps)\s*:?\s*$/i;
    const start = lines.findIndex((line) => headingPattern.test(line.trim()));
    if (start === -1) {
      return { title: "Directions", steps: [] };
    }
    const title = lines[start].replace(/^#{0,6}\s*/, "").replace(/:\s*$/, "").trim() || "Directions";
    const body = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (/^##\s+/.test(line) || /^(?:notes?|serving|storage|nutrition)\s*:?$/i.test(line)) {
        break;
      }
      body.push(lines[index]);
    }
    return { title, steps: instructionStepsFromText(body.join("\n")) };
  }

  function instructionStepsFromText(value) {
    const steps = [];
    let current = null;
    String(value || "").split("\n").forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        return;
      }
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      if (numbered) {
        current = { order: steps.length + 1, text: stripInlineMarkdown(numbered[1]) };
        steps.push(current);
        return;
      }
      const bullet = line.match(/^[-*+]\s+(.+)$/);
      if (bullet) {
        current = { order: steps.length + 1, text: stripInlineMarkdown(bullet[1]) };
        steps.push(current);
        return;
      }
      const text = stripInlineMarkdown(line);
      if (!text) {
        return;
      }
      if (current) {
        current.text = `${current.text} ${text}`.trim();
      } else {
        current = { order: steps.length + 1, text };
        steps.push(current);
      }
    });
    return steps;
  }
  
  function titleFromMarkdown(markdown) {
    return String(markdown || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  }
  
  function topMetadataValue(markdown, label) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return String(markdown || "").match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
  }
  
  function labeledBulletValues(markdown, heading) {
    const values = {};
    bulletItems(markdown, heading).forEach((item) => {
      const separatorIndex = item.indexOf(":");
      if (separatorIndex === -1) {
        return;
      }
      values[item.slice(0, separatorIndex).trim()] = item.slice(separatorIndex + 1).trim();
    });
    return values;
  }
  
  function bulletItems(markdown, heading) {
    return sectionMarkdown(markdown, heading)
      .split("\n")
      .map((line) => line.match(/^\s*[-*+]\s+(.+)$/))
      .filter(Boolean)
      .map((match) => stripInlineMarkdown(match[1].trim()))
      .filter(Boolean);
  }
  
  function numberedItems(markdown, heading) {
    return sectionMarkdown(markdown, heading)
      .split("\n")
      .map((line) => line.match(/^\s*(\d+)\.\s+(.+)$/))
      .filter(Boolean)
      .map((match) => ({
        order: Number(match[1]),
        text: stripInlineMarkdown(match[2].trim()),
      }));
  }
  
  function sectionMarkdown(markdown, heading) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    const start = lines.findIndex((line) => pattern.test(line.trim()));
    if (start === -1) {
      return "";
    }
    const collected = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) {
        break;
      }
      collected.push(lines[index]);
    }
    return collected.join("\n").trim();
  }
  
  function stripInlineMarkdown(value) {
    return String(value || "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .trim();
  }
  
  function pathCategory(path) {
    const parts = String(path || "").split("/");
    const archiveIndex = parts.indexOf("recipe-archive");
    return archiveIndex === -1 ? "" : parts[archiveIndex + 1] || "";
  }
  
  function normalizeRecipeCategory(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  
  function formatCategoryLabel(value) {
    return normalizeRecipeCategory(value)
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  
  function slugFromTitle(value) {
    return normalizeRecipeCategory(value) || `recipe-${Date.now()}`;
  }
  
  function minutesValue(value) {
    const text = String(value || "").toLowerCase();
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)/);
    const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minute|min)/);
    const hours = hourMatch ? Number(hourMatch[1]) * 60 : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    const total = hours + minutes;
    if (total > 0) {
      return total;
    }
    return numericValue(text);
  }
  
  function numericValue(value) {
    const text = String(value || "").trim();
    const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) {
      return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    }
    const fraction = text.match(/^(\d+)\/(\d+)$/);
    if (fraction) {
      return Number(fraction[1]) / Number(fraction[2]);
    }
    const number = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(number) ? number : null;
  }
  

  return {
    canonicalRecipeMarkdownForSave,
    formatCategoryLabel,
    instructionSectionsFromMarkdown,
    labeledBulletValues,
    minutesValue,
    normalizeRecipeCategory,
    numericValue,
    pathCategory,
    recipeFromMarkdownForSave,
    structuredIngredientsFromMarkdown,
  };
}
