import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../pi-tools.types.js";
import { createInvokeToolWrapper } from "./invoke-tool-wrapper.js";

function stubTool(overrides: Partial<AnyAgentTool> & { name: string }): AnyAgentTool {
  return {
    name: overrides.name,
    description: overrides.description ?? "",
    parameters: overrides.parameters ?? { type: "object", properties: {} },
    execute: overrides.execute ?? vi.fn(async () => ({ content: [], details: { ok: true } })),
  } as AnyAgentTool;
}

describe("createInvokeToolWrapper", () => {
  it("returns a tool named invoke_tool with enum of real tool names", () => {
    const real = [stubTool({ name: "read" }), stubTool({ name: "write" })];
    const wrapper = createInvokeToolWrapper(real);
    expect(wrapper.name).toBe("invoke_tool");
    const params = wrapper.parameters as { properties?: { tool_name?: { enum?: string[] } } };
    expect(params?.properties?.tool_name?.enum).toEqual(["read", "write"]);
  });

  it("unknown tool_name returns error with available list", async () => {
    const real = [stubTool({ name: "read" })];
    const wrapper = createInvokeToolWrapper(real);
    const result = await wrapper.execute("call-1", {
      tool_name: "nope",
      arguments: {},
    });
    expect(result).toBeDefined();
    const content = (result as { content?: { type: string; text?: string }[] })?.content;
    const text = content?.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain("Unknown tool");
    expect(text).toContain("nope");
    expect(text).toContain("read");
  });

  it("missing tool_name returns error", async () => {
    const real = [stubTool({ name: "read" })];
    const wrapper = createInvokeToolWrapper(real);
    const result = await wrapper.execute("call-1", { arguments: {} });
    const content = (result as { content?: { type: string; text?: string }[] })?.content;
    const text = content?.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain("tool_name is required");
  });

  it("missing required args returns validation error", async () => {
    const execute = vi.fn(async () => ({ content: [], details: {} }));
    const real = [
      stubTool({
        name: "read",
        execute,
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }),
    ];
    const wrapper = createInvokeToolWrapper(real);
    const result = await wrapper.execute("call-1", {
      tool_name: "read",
      arguments: {},
    });
    const content = (result as { content?: { type: string; text?: string }[] })?.content;
    const text = content?.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain("Missing required");
    expect(text).toContain("path");
    expect(text).toContain("Expected");
    expect(execute).not.toHaveBeenCalled();
  });

  it("valid tool_name and required args calls real tool", async () => {
    const execute = vi.fn(async (_id: string, args: unknown) => ({
      content: [{ type: "text" as const, text: String((args as { path?: string }).path) }],
      details: {},
    }));
    const real = [
      stubTool({
        name: "read",
        execute,
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }),
    ];
    const wrapper = createInvokeToolWrapper(real);
    const result = await wrapper.execute("call-1", {
      tool_name: "read",
      arguments: { path: "/tmp/foo" },
    });
    expect(execute).toHaveBeenCalledWith("call-1", { path: "/tmp/foo" }, undefined, undefined);
    const content = (result as { content?: { type: string; text: string }[] })?.content;
    expect(content?.find((c) => c.type === "text")?.text).toBe("/tmp/foo");
  });

  it("tool with no required passes through without validation error", async () => {
    const execute = vi.fn(async () => ({ content: [], details: { done: true } }));
    const real = [
      stubTool({
        name: "ping",
        execute,
        parameters: { type: "object", properties: {} },
      }),
    ];
    const wrapper = createInvokeToolWrapper(real);
    await wrapper.execute("call-1", {
      tool_name: "ping",
      arguments: {},
    });
    expect(execute).toHaveBeenCalledWith("call-1", {}, undefined, undefined);
  });
});
