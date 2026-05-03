export type RewriteTarget = "$N" | "?";

export interface RewriteResult {
  sql: string;
  values: unknown[];
}

/**
 * Rewrite :name placeholders to positional ($1/$2… or ?) form.
 * Respects single-quoted string literals, double-quoted identifiers,
 * line comments (--), and block comments (/* …*\/).
 * For $N mode, repeated uses of the same name reuse the same index.
 */
export function rewriteToPositional(
  sql: string,
  params: Record<string, unknown>,
  target: RewriteTarget,
): RewriteResult {
  const values: unknown[] = [];
  const nameToIndex = new Map<string, number>(); // for $N dedup
  let result = "";
  let i = 0;

  while (i < sql.length) {
    // Single-quoted string literal
    if (sql[i] === "'") {
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; }
        else if (sql[i] === "'") { i++; break; }
        else { i++; }
      }
      result += sql.slice(start, i);
      continue;
    }

    // Double-quoted identifier
    if (sql[i] === '"') {
      const start = i++;
      while (i < sql.length && sql[i] !== '"') i++;
      if (i < sql.length) i++;
      result += sql.slice(start, i);
      continue;
    }

    // Line comment
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const start = i;
      while (i < sql.length && sql[i] !== "\n") i++;
      result += sql.slice(start, i);
      continue;
    }

    // Block comment
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      result += sql.slice(start, i);
      continue;
    }

    // Named placeholder :name
    if (sql[i] === ":" && i + 1 < sql.length && /[a-zA-Z_]/.test(sql[i + 1])) {
      i++;
      const nameStart = i;
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) i++;
      const name = sql.slice(nameStart, i);

      if (target === "$N") {
        if (!nameToIndex.has(name)) {
          values.push(params[name]);
          nameToIndex.set(name, values.length);
        }
        result += `$${nameToIndex.get(name)}`;
      } else {
        values.push(params[name]);
        result += "?";
      }
      continue;
    }

    result += sql[i++];
  }

  return { sql: result, values };
}

/**
 * Extract all :name placeholder names from a SQL string (same tokenizer,
 * so behaviour is consistent with rewriteToPositional). Used by the loader
 * to cross-check declared params.
 */
export function extractPlaceholderNames(sql: string): string[] {
  const names: string[] = [];
  let i = 0;

  while (i < sql.length) {
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; }
        else if (sql[i] === "'") { i++; break; }
        else { i++; }
      }
      continue;
    }
    if (sql[i] === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      if (i < sql.length) i++;
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (sql[i] === ":" && i + 1 < sql.length && /[a-zA-Z_]/.test(sql[i + 1])) {
      i++;
      const nameStart = i;
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) i++;
      names.push(sql.slice(nameStart, i));
      continue;
    }
    i++;
  }

  return names;
}
