/**
 * When the user saves a new primary model in Agents Overview, the config is updated
 * but existing sessions still have entry.model / entry.modelProvider (and optionally
 * modelOverride) from the previous run. resolveSessionModelRef prefers those over
 * the config default, so chat keeps using the old model until we clear them.
 *
 * This module clears those fields from the default agent's session store whenever
 * agents.defaults.model is written via config.set / config.apply / config.patch,
 * so the next run uses the new config default.
 */

import { isDeepStrictEqual } from "node:util";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { resolveDefaultSessionStorePath, updateSessionStore } from "../config/sessions.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";

/** True if agents.defaults.model differs between prev and next config. */
export function agentsDefaultsModelChanged(prev: unknown, next: unknown): boolean {
  const prevModel = (prev as OpenClawConfig)?.agents?.defaults?.model;
  const nextModel = (next as OpenClawConfig)?.agents?.defaults?.model;
  return !isDeepStrictEqual(prevModel, nextModel);
}

/**
 * Clear model/modelProvider/modelOverride/providerOverride from every entry in
 * the given session store so the next run uses config default (resolveSessionModelRef).
 */
export async function clearSessionModelOverridesInStore(
  storePath: string,
): Promise<{ cleared: number }> {
  const result = await updateSessionStore(storePath, (store) => {
    const now = Date.now();
    let cleared = 0;
    for (const [key, entry] of Object.entries(store)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const hasModel =
        entry.model !== undefined ||
        entry.modelProvider !== undefined ||
        entry.modelOverride !== undefined ||
        entry.providerOverride !== undefined;
      if (!hasModel) {
        continue;
      }
      const next: SessionEntry = { ...entry, updatedAt: Math.max(entry.updatedAt ?? 0, now) };
      delete next.model;
      delete next.modelProvider;
      delete next.modelOverride;
      delete next.providerOverride;
      store[key] = next;
      cleared++;
    }
    return { cleared };
  });
  return result;
}

/**
 * Clear session model overrides for the default agent's store so the next chat
 * run uses agents.defaults.model. Call after writing config when
 * agents.defaults.model changed.
 */
export async function clearSessionModelOverridesForDefaultAgent(
  cfg: OpenClawConfig,
): Promise<{ cleared: number }> {
  const agentId = resolveDefaultAgentId(cfg);
  const storePath = resolveDefaultSessionStorePath(agentId);
  try {
    return await clearSessionModelOverridesInStore(storePath);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { cleared: 0 };
    }
    throw err;
  }
}
