/**
 * Single "invoke_tool" wrapper so the model sees one tool schema instead of N.
 * Saves ~15k–25k tokens when many tools are enabled (e.g. 32k context).
 */
import type { AnyAgentTool } from "../pi-tools.types.js";
import { jsonResult } from "../tools/common.js";

const INVOKE_TOOL_NAME = "invoke_tool";

function buildInvokeToolSchema(realTools: AnyAgentTool[]): Record<string, unknown> {
  const names = realTools
    .map((t) => (typeof t.name === "string" ? t.name.trim() : ""))
    .filter(Boolean);
  return {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description: "Name of the tool to call",
        enum: names.length > 0 ? names : ["message"],
      },
      arguments: {
        type: "object",
        description: "Arguments for the tool (keys depend on the tool)",
      },
    },
    required: ["tool_name", "arguments"],
  };
}

/** Minimal validation: required params present and not undefined. Returns clear error for model to self-correct. */
function validateInvokeArgs(
  args: Record<string, unknown>,
  tool: AnyAgentTool,
): { valid: true } | { valid: false; error: string } {
  const params = tool.parameters;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { valid: true };
  }
  const schema = params as { properties?: Record<string, unknown>; required?: string[] };
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.length === 0) {
    return { valid: true };
  }
  const missing: string[] = [];
  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      missing.push(key);
    }
  }
  if (missing.length === 0) {
    return { valid: true };
  }
  const properties =
    schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const expected = required.map((k) => {
    const prop = properties[k] as { type?: string } | undefined;
    const type =
      prop && typeof prop === "object" && typeof prop.type === "string" ? prop.type : "any";
    return `${k} (${type})`;
  });
  return {
    valid: false,
    error: `Missing required: ${missing.join(", ")}. Expected: ${expected.join(", ")}.`,
  };
}

export function createInvokeToolWrapper(realTools: AnyAgentTool[]): AnyAgentTool {
  const names = realTools
    .map((t) => (typeof t.name === "string" ? t.name.trim() : ""))
    .filter(Boolean);
  const byName = new Map<string, AnyAgentTool>();
  for (const t of realTools) {
    const n = typeof t.name === "string" ? t.name.trim() : "";
    if (n && !byName.has(n)) {
      byName.set(n, t);
    }
  }
  const description =
    names.length > 0
      ? `Invoke one of: ${names.join(", ")}. Pass tool_name and arguments.`
      : "Invoke a tool by name with arguments.";

  return {
    name: INVOKE_TOOL_NAME,
    description,
    parameters: buildInvokeToolSchema(realTools),
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: (update: unknown) => void,
    ): Promise<unknown> => {
      const raw = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
      const toolName = typeof raw.tool_name === "string" ? raw.tool_name.trim() : "";
      const args =
        raw.arguments && typeof raw.arguments === "object"
          ? (raw.arguments as Record<string, unknown>)
          : {};
      const tool = toolName ? byName.get(toolName) : undefined;
      if (!tool) {
        return jsonResult({
          status: "error",
          tool: INVOKE_TOOL_NAME,
          error: toolName
            ? `Unknown tool: ${toolName}. Available: ${[...byName.keys()].join(", ")}`
            : "tool_name is required",
        });
      }
      const validation = validateInvokeArgs(args, tool);
      if (!validation.valid) {
        return jsonResult({
          status: "error",
          tool: toolName,
          error: validation.error,
        });
      }
      return tool.execute(toolCallId, args, signal, onUpdate);
    },
  } as AnyAgentTool;
}
