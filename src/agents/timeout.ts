import type { OpenClawConfig } from "../config/config.js";

/** 0 = no timeout (run until done). Use for low-end hardware or long tool runs. */
const DEFAULT_AGENT_TIMEOUT_SECONDS = 0;
const MAX_SAFE_TIMEOUT_MS = 2_147_000_000;

const normalizeNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;

export function resolveAgentTimeoutSeconds(cfg?: OpenClawConfig): number {
  const raw = normalizeNumber(cfg?.agents?.defaults?.timeoutSeconds);
  const seconds = raw ?? DEFAULT_AGENT_TIMEOUT_SECONDS;
  return seconds === 0 ? 0 : Math.max(seconds, 1);
}

export function resolveAgentTimeoutMs(opts: {
  cfg?: OpenClawConfig;
  overrideMs?: number | null;
  overrideSeconds?: number | null;
  minMs?: number;
}): number {
  const minMs = Math.max(normalizeNumber(opts.minMs) ?? 1, 1);
  const clampTimeoutMs = (valueMs: number) =>
    Math.min(Math.max(valueMs, minMs), MAX_SAFE_TIMEOUT_MS);
  const NO_TIMEOUT_MS = MAX_SAFE_TIMEOUT_MS;
  const seconds = resolveAgentTimeoutSeconds(opts.cfg);
  const defaultMs = seconds === 0 ? NO_TIMEOUT_MS : clampTimeoutMs(seconds * 1000);
  const overrideMs = normalizeNumber(opts.overrideMs);
  if (overrideMs !== undefined) {
    if (overrideMs === 0) {
      return NO_TIMEOUT_MS;
    }
    if (overrideMs < 0) {
      return defaultMs;
    }
    return clampTimeoutMs(overrideMs);
  }
  const overrideSeconds = normalizeNumber(opts.overrideSeconds);
  if (overrideSeconds !== undefined) {
    if (overrideSeconds === 0) {
      return NO_TIMEOUT_MS;
    }
    if (overrideSeconds < 0) {
      return defaultMs;
    }
    return clampTimeoutMs(overrideSeconds * 1000);
  }
  return defaultMs;
}
