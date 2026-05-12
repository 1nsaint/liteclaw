#!/bin/sh
# Ensure .openclaw exists and config has Docker/Ollama defaults.
# - If no config: copy seed (first run, new volume).
# - If config exists: merge in seed defaults for Ollama and agent model so old
#   volumes get Jetson Ollama URL and default model without losing token/pairing.
set -e
CONFIG="/home/node/.openclaw/openclaw.json"
SEED="/app/docker-openclaw.seed.json"
mkdir -p /home/node/.openclaw

if [ ! -f "$CONFIG" ]; then
  cp "$SEED" "$CONFIG"
else
  # Merge seed defaults into existing config so Ollama baseUrl and default model
  # are set even when volume was created from an older seed.
  # If existing config is invalid JSON, backup and use seed so container can start.
  node -e "
    const fs = require('fs');
    const configPath = process.argv[1];
    const seedPath = process.argv[2];
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      const backup = configPath + '.invalid.' + Date.now();
      fs.copyFileSync(configPath, backup);
      fs.writeFileSync(configPath, fs.readFileSync(seedPath, 'utf8'));
      console.error('openclaw.json was invalid JSON; backed up to ' + backup + ' and replaced with seed. Fix and restore if needed.');
      process.exit(0);
    }
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    let changed = false;
    if (seed.models?.providers?.ollama) {
      cfg.models = cfg.models || {};
      cfg.models.providers = cfg.models.providers || {};
      const seedOllama = seed.models.providers.ollama;
      cfg.models.providers.ollama = {
        ...(cfg.models.providers.ollama || {}),
        baseUrl: seedOllama.baseUrl || cfg.models.providers.ollama?.baseUrl,
        api: seedOllama.api || cfg.models.providers.ollama?.api || \"ollama\",
      };
      changed = true;
    }
    if (seed.agents?.defaults?.model?.primary) {
      cfg.agents = cfg.agents || {};
      cfg.agents.defaults = cfg.agents.defaults || {};
      cfg.agents.defaults.model = cfg.agents.defaults.model && typeof cfg.agents.defaults.model === 'object' && !Array.isArray(cfg.agents.defaults.model)
        ? { ...cfg.agents.defaults.model, primary: seed.agents.defaults.model.primary }
        : { primary: seed.agents.defaults.model.primary };
      changed = true;
    }
    if (seed.agents?.defaults?.models && typeof seed.agents.defaults.models === 'object') {
      cfg.agents = cfg.agents || {};
      cfg.agents.defaults = cfg.agents.defaults || {};
      cfg.agents.defaults.models = { ...(cfg.agents.defaults.models || {}), ...seed.agents.defaults.models };
      changed = true;
    }
    if (typeof seed.agents?.defaults?.timeoutSeconds === 'number') {
      cfg.agents = cfg.agents || {};
      cfg.agents.defaults = cfg.agents.defaults || {};
      cfg.agents.defaults.timeoutSeconds = seed.agents.defaults.timeoutSeconds;
      changed = true;
    }
    if (seed.agents?.defaults?.tools && typeof seed.agents.defaults.tools === 'object') {
      cfg.agents = cfg.agents || {};
      cfg.agents.defaults = cfg.agents.defaults || {};
      cfg.agents.defaults.tools = { ...(cfg.agents.defaults.tools || {}), ...seed.agents.defaults.tools };
      changed = true;
    }
    if (seed.tools?.web?.search && typeof seed.tools.web.search === 'object') {
      cfg.tools = cfg.tools || {};
      cfg.tools.web = cfg.tools.web || {};
      cfg.tools.web.search = { ...(cfg.tools.web.search || {}), ...seed.tools.web.search };
      changed = true;
    }
    if (changed) fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  " "$CONFIG" "$SEED"
fi
exec "$@"
