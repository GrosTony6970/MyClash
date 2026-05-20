type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursive merge of `patch` onto `base` for JSON-shaped data.
 *
 * Rules:
 *   • Plain objects merge key-by-key (recursive).
 *   • Arrays replace atomically (callers who want concat must do it manually).
 *   • `null` in patch wipes the key in base (lets callers explicitly clear fields).
 *   • If base is null/undefined, returns patch unchanged.
 *   • If patch is null/undefined, returns base unchanged.
 */
export function deepMergeJson(base: unknown, patch: unknown): unknown {
  if (patch === undefined || patch === null) return base;
  if (base === undefined || base === null) return patch;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;

  const result: JsonObject = { ...base };
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    if (patchValue === null) {
      result[key] = null;
    } else {
      result[key] = deepMergeJson(base[key], patchValue);
    }
  }
  return result;
}
