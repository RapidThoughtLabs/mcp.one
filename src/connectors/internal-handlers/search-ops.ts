import type { ConnectorResult } from "../base.js";
import type { InternalContext } from "../internal.js";

interface SearchResult {
  qualified_name: string;
  config_id: string;
  tool: unknown;
  note?: string;
}

function score(toolName: string, description: string, query: string): number {
  const q = query.toLowerCase().replace(/\s+/g, "_");
  const name = toolName.toLowerCase();
  const desc = description.toLowerCase();

  if (name === q) return 100;
  if (name.includes(q) || name.includes(query.toLowerCase())) return 70;

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.every((w) => desc.includes(w))) return 50;
  if (words.some((w) => name.includes(w) || desc.includes(w))) return 20;

  return 0;
}

function makeNote(description: string): string {
  return description.length > 80 ? description.slice(0, 77) + "..." : description;
}

export async function handleSearch(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const query = (args.query as string | undefined)?.trim() ?? "";
  const configFilter = args.config as string | undefined;

  if (!query && !configFilter) {
    return { success: false, data: { error: "Provide a query, a config filter, or both." } };
  }

  const all = ctx.registry.list();
  let candidates: typeof all;
  if (!configFilter) {
    candidates = all;
  } else {
    const exact = all.filter((rt) => rt.configId === configFilter);
    candidates = exact.length > 0 ? exact : all.filter((rt) => rt.configId.includes(configFilter));
  }

  // Query-less with a config filter: list every tool in that config.
  if (!query) {
    return {
      success: true,
      data: {
        exact:       [],
        partial:     [],
        description: [],
        related:     candidates.map((rt) => ({
          qualified_name: `${rt.configId}.${rt.tool.name}`,
          config_id: rt.configId,
          tool: rt.tool,
          note: makeNote(rt.tool.description ?? rt.tool.name),
        })),
      },
    };
  }

  const buckets: Record<number, SearchResult[]> = { 100: [], 70: [], 50: [], 20: [] };

  for (const rt of candidates) {
    let s = score(rt.tool.name, rt.tool.description ?? "", query);
    // With an active config filter the candidates are already scoped — surface
    // every tool at minimum "related" so none silently vanish due to a loose query.
    if (s === 0 && configFilter) s = 20;
    if (s === 0) continue;

    const result: SearchResult = {
      qualified_name: `${rt.configId}.${rt.tool.name}`,
      config_id: rt.configId,
      tool: rt.tool,
    };

    if (s < 100) {
      result.note = makeNote(rt.tool.description ?? rt.tool.name);
    }

    buckets[s]!.push(result);
  }

  return {
    success: true,
    data: {
      exact:       buckets[100],
      partial:     buckets[70],
      description: buckets[50],
      related:     buckets[20],
    },
  };
}
