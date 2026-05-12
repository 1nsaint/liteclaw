import type { AgentTool } from "@mariozechner/pi-agent-core";

/** Build a one-line param hint from JSON Schema (e.g. "Params: path (string), content (optional).") for compact tool mode. */
function getParameterHint(tool: AgentTool): string {
  const params = tool.parameters;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return "";
  }
  const schema = params as { properties?: Record<string, { type?: string }>; required?: string[] };
  const properties = schema.properties;
  const required = Array.isArray(schema.required) ? new Set(schema.required) : new Set<string>();
  if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) {
    return "";
  }
  const parts: string[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== "object") {
      continue;
    }
    const type =
      typeof (prop as { type?: string }).type === "string"
        ? (prop as { type: string }).type
        : "any";
    const opt = required.has(key) ? "" : ", optional";
    parts.push(`${key} (${type}${opt})`);
  }
  if (parts.length === 0) {
    return "";
  }
  return `Params: ${parts.join(", ")}.`;
}

export function buildToolSummaryMap(tools: AgentTool[]): Record<string, string> {
  const summaries: Record<string, string> = {};
  for (const tool of tools) {
    const summary = tool.description?.trim() || tool.label?.trim();
    if (!summary) {
      continue;
    }
    const hint = getParameterHint(tool);
    summaries[tool.name.toLowerCase()] = hint ? `${summary} ${hint}` : summary;
  }
  return summaries;
}
