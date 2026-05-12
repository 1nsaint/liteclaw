import type { AgentTool } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { buildToolSummaryMap } from "./tool-summaries.js";

function stubTool(overrides: Partial<AgentTool> & { name: string }): AgentTool {
  return {
    name: overrides.name,
    description: overrides.description ?? "",
    parameters: overrides.parameters,
    execute: overrides.execute ?? (async () => ({ content: [], details: {} })),
  } as AgentTool;
}

describe("buildToolSummaryMap", () => {
  it("returns empty map for empty tools", () => {
    expect(buildToolSummaryMap([])).toEqual({});
  });

  it("skips tools without description or label", () => {
    const tools = [
      stubTool({ name: "read", description: "" }),
      stubTool({ name: "write", label: "" }),
    ];
    expect(buildToolSummaryMap(tools)).toEqual({});
  });

  it("uses description and stores by lowercase name", () => {
    const tools = [stubTool({ name: "Read", description: "Read file contents." })];
    expect(buildToolSummaryMap(tools)).toEqual({
      read: "Read file contents.",
    });
  });

  it("appends parameter hint when tool has parameters schema", () => {
    const tools = [
      stubTool({
        name: "read",
        description: "Read file contents.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            encoding: { type: "string" },
          },
          required: ["path"],
        },
      }),
    ];
    expect(buildToolSummaryMap(tools)).toEqual({
      read: "Read file contents. Params: path (string), encoding (string, optional).",
    });
  });

  it("appends param hint with all required when no optional", () => {
    const tools = [
      stubTool({
        name: "run",
        description: "Run a command.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
      }),
    ];
    expect(buildToolSummaryMap(tools)).toEqual({
      run: "Run a command. Params: command (string).",
    });
  });

  it("ignores tools with empty or missing parameters", () => {
    const tools = [
      stubTool({
        name: "ping",
        description: "Ping.",
        parameters: {},
      }),
      stubTool({
        name: "pong",
        description: "Pong.",
        parameters: { type: "object", properties: {} },
      }),
    ];
    expect(buildToolSummaryMap(tools)).toEqual({
      ping: "Ping.",
      pong: "Pong.",
    });
  });
});
