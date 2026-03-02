# LiteClaw in Docker (this repo)

Your fork of OpenClaw, cloned here so you can edit on Linux and run from a container. Source: [1nsaint/liteclaw](https://github.com/1nsaint/liteclaw).

---

## Do we compile, or just pull an image?

**You build from source.** There is no pre-built “liteclaw” image on Docker Hub. The flow is:

1. **Edit** the code in `Containers/liteclaw/` (or pull changes from your fork).
2. **Build** the Docker image (this compiles the app inside the image):
   ```bash
   cd /home/insaint/Containers/liteclaw
   docker compose build
   ```
   The Dockerfile runs `pnpm install`, `pnpm build`, `pnpm ui:build` inside the container, so you don’t need Node/pnpm on the host.
3. **Run** the container:
   ```bash
   docker compose up -d
   ```
   Gateway listens on **port 18789**. Open the UI or pair the TUI to `http://<host>:18789`.

If you later **publish** an image (e.g. push to GitHub Container Registry or Docker Hub), then you could add a `docker-compose` that only does `image: ghcr.io/1nsaint/liteclaw:latest` and `pull_policy: always` — but until then, every test build is “build from source, then run.”

---

## Quick test (build + run)

```bash
cd /home/insaint/Containers/liteclaw
docker compose build
docker compose up -d
```

Then open `http://localhost:18789` (or your host IP). To point the gateway at Ollama on the host, configure the Ollama base URL as `http://host.docker.internal:11434` (or `http://host.docker.internal:11434/v1` if the UI expects an OpenAI-style path).

---

## Persistent config (survives rebuilds)

The compose file mounts a Docker volume at `/home/node/.openclaw`. Your **gateway token, device pairing, Ollama provider, and agent settings** are stored there, so you can rebuild the image and recreate the container without losing config.

- **First run** with the volume: the entrypoint copies the seed config (Ollama baseUrl, default model, timeout 120s, heartbeat off).
- **Existing volume**: the entrypoint merges in seed defaults (Ollama baseUrl, default model) so old installs get the fix without losing token/pairing.
- **Ollama URL**: `OPENCLAW_OLLAMA_BASE_URL=http://host.docker.internal:11434` in compose forces the gateway to use the host’s Ollama; it overrides config so chat always reaches Ollama.

If you had been running *without* the volume and want to keep your current config, back it up before recreating, then restore it into the new container:

```bash
docker cp liteclaw:/home/node/.openclaw/openclaw.json ./openclaw-backup.json
docker compose up -d --force-recreate
docker cp ./openclaw-backup.json liteclaw:/home/node/.openclaw/openclaw.json
docker restart liteclaw
```

---

## Gateway token (fix "unauthorized: gateway token mismatch")

The gateway generates a token and saves it in the container config. The Control UI needs that same token to connect.

1. **Get the token** from the running container. The CLI redacts it, so read the config file directly:
   ```bash
   docker exec liteclaw cat /home/node/.openclaw/openclaw.json | jq -r '.gateway.auth.token'
   ```
   If you don't have `jq`, run `docker exec liteclaw cat /home/node/.openclaw/openclaw.json` and copy the `gateway.auth.token` value from the JSON.

2. **Paste it in the dashboard**: open **Settings** (gear icon top-right or "Settings" in the left sidebar) → find **Gateway Token** (or "Control UI" / auth section) → paste the token → **Connect** (or Save and reload).

After that, "Disconnected from gateway" and "Health Offline" should clear.

**3. If you see "pairing required"** after connecting, the browser must be approved once. On the host:

```bash
docker exec liteclaw node openclaw.mjs devices list          # list pending requests, note the requestId
docker exec liteclaw node openclaw.mjs devices approve <requestId>   # approve it (or use --latest)
```

Then click **Connect** again in the dashboard; health should go online.

---

## Connecting Ollama (when Ollama runs on the host)

Ollama is on the host; the LiteClaw container must use `host.docker.internal` to reach it.

1. **Connect the gateway** (see "Gateway token" above) so the dashboard works.
2. **Add/configure the Ollama provider** in the gateway config. Either:
   - **From the dashboard**: **Settings → Config** (or **Control** → **Instances** / model config) and add or edit the Ollama provider with:
     - **Base URL**: `http://host.docker.internal:11434` (or `http://host.docker.internal:11434/v1` for OpenAI-style)
     - **API key**: any value, e.g. `ollama-local`
   - **From the host** (writes into the container's config):
     ```bash
     docker exec liteclaw node openclaw.mjs config set models.providers.ollama.apiKey "ollama-local"
     docker exec liteclaw node openclaw.mjs config set models.providers.ollama.baseUrl "http://host.docker.internal:11434"
     ```
     Then in the UI, pick an Ollama model (e.g. `ollama/llama3.3`) for the default agent or for a chat.
3. **Ensure Ollama is running** on the host (e.g. `ollama serve`) and pull a model: `ollama pull llama3.3`.

If you use **auto-discovery** (no explicit `models.providers.ollama`), the gateway looks at `http://127.0.0.1:11434` **inside the container**, which is not the host. So with Docker you need an explicit provider with `baseUrl: "http://host.docker.internal:11434"` (and optionally `apiKey: "ollama-local"`).

---

## Core files (lite)

The default workspace has no bootstrap files (to avoid ~11k tokens per prompt). Minimal “lite” versions are in `scripts/lite-core-files/` (~few hundred tokens total). Seed the running container once:

```bash
cd /home/insaint/Containers/liteclaw
for f in scripts/lite-core-files/*.md; do name=$(basename "$f"); docker exec liteclaw test -f "/home/node/.openclaw/workspace/$name" 2>/dev/null || docker cp "$f" liteclaw:/home/node/.openclaw/workspace/"$name"; done
```

Or run `./scripts/seed-lite-core-files.sh` (creates only missing files). Then in the dashboard open **Agents → main → Files** (or **Core Files**) and click **Refresh**; you can edit and save there. To change the templates, edit the `.md` files in `scripts/lite-core-files/` and re-run the seed (it skips existing files so it won’t overwrite your edits unless you delete them first).

If a file shows **empty in the content panel** but has a size in the list (e.g. SOUL.md "431 B"): click **Refresh**, then click the file again. If still empty, hard-refresh the page (Ctrl+Shift+R) and reopen the file.

---

## Heartbeat (stops the 30B loading on its own)

OpenClaw runs a **heartbeat** every 30 minutes: it sends a short prompt to the agent so it can read `HEARTBEAT.md` and reply `HEARTBEAT_OK`. That call **loads your default model** (e.g. the 30B). If you don't want the model to spin up without you chatting, disable the heartbeat:

```bash
docker exec liteclaw node -e "const fs=require('fs');const p='/home/node/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.agents=c.agents||{};c.agents.defaults=c.agents.defaults||{};c.agents.defaults.heartbeat={every:'0m'};fs.writeFileSync(p,JSON.stringify(c,null,2));"
```

Then restart the container (or wait for the next config reload). To turn heartbeats back on, set `every` to e.g. `"30m"` in **Config → Agents → defaults → heartbeat** in the UI, or edit the JSON and set `agents.defaults.heartbeat.every` to `"30m"`.

**Unload button does nothing / model stays loaded:** If LiteClaw (or another client) has a **stuck or long-running** chat/generate request to Ollama, the model stays in use until that request ends. The AI hub’s Unload sends `keep_alive: 0`, but Ollama won’t unload while another request is still active. Fix: **restart the LiteClaw container** (`docker restart liteclaw`) to cancel all in-flight runs, then use Unload on the AI hub or wait for the 10‑minute idle timer.

---

## Stuck runs, timeouts, and "fetch failed"

**What’s a run?** One **run** = one agent turn: you send a message, the gateway builds a prompt, calls Ollama (one HTTP request), and may do tool calls in a loop. **runId** is a unique ID for that turn. **sessionId** is the chat session. Logs like `embedded run timeout: runId=... sessionId=... timeoutMs=600000` mean that run was aborted after 10 minutes.

**Why did it timeout?** The gateway has a **per-run timeout** (default **10 minutes**, from `agents.defaults.timeoutSeconds` = 600). If Ollama doesn’t finish the response within that time, the gateway aborts the run → you see `embedded run timeout` and `This operation was aborted`. So: the run didn’t finish in time (e.g. 30B “thinking” too slow, or Ollama stuck), and the gateway killed it after 10 min.

**Why "fetch failed"?** The gateway talks to Ollama over HTTP. **"fetch failed"** means that HTTP request failed: connection dropped, Ollama closed it, network blip, or the request was aborted (e.g. by the 10‑minute timer). So you can see both "fetch failed" (when the run ends with that error) and "This operation was aborted" (when the timeout fires).

**Why does the same session keep getting new runs?** If a run fails or times out, the session can be left with an **orphaned user message** (no reply). The gateway then starts another run for that same message (or the UI retries). So you get multiple runIds for the same session, each timing out or failing → the model stays “in use” and Unload doesn’t help.

**How to fix it so it doesn’t keep happening:**

1. **Lower the run timeout** so stuck runs don’t hold for 10 minutes. Set `agents.defaults.timeoutSeconds` to **120** (2 min) or **180** (3 min). Then if Ollama is slow or stuck, the run aborts sooner and releases the model.
   ```bash
   docker exec liteclaw node -e "const fs=require('fs');const p='/home/node/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.agents=c.agents||{};c.agents.defaults=c.agents.defaults||{};c.agents.defaults.timeoutSeconds=120;c.meta=c.meta||{};c.meta.lastTouchedAt=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(c,null,2));"
   ```
   After that, reload config or restart the container. You can also set it in the UI: **Config → Agents → defaults → timeout (seconds)**.

2. **When a chat gets stuck**, use **New session** in the OpenClaw UI instead of sending another message in the same thread. That avoids orphaned messages and repeated runs on the same session.

3. **One-off cleanup:** `docker restart liteclaw` kills all in-flight runs so the model can unload (then use the AI hub Unload button or wait for the idle timer).

---

## Chat shows "HTTP 404: 404 page not found"

The gateway must call **Ollama on the host** at `http://host.docker.internal:11434`. If the UI shows 404 on send:

1. **Compose must set** `OPENCLAW_OLLAMA_BASE_URL=http://host.docker.internal:11434` (done in this repo’s `docker-compose.yml`). Recreate the container so the env is applied: `docker compose up -d --force-recreate`.
2. **Clear the session’s cached model** so the next run uses the configured default (Ollama) instead of an old Anthropic choice:
   ```bash
   docker exec liteclaw node -e "
   const fs=require('fs');const path=require('path');
   const stateDir=process.env.OPENCLAW_STATE_DIR||path.join(process.env.HOME||'/home/node','.openclaw');
   const storePath=path.join(stateDir,'agents','main','sessions','sessions.json');
   let store={}; try { store=JSON.parse(fs.readFileSync(storePath,'utf8')); } catch(e) { process.exit(0); }
   for(const k of Object.keys(store)) { const e=store[k]; if(e&&(e.model!==undefined||e.modelProvider!==undefined)) { delete e.model; delete e.modelProvider; } }
   fs.writeFileSync(storePath,JSON.stringify(store,null,2));
   console.log('Cleared session runtime model.');
   "
   ```
   Then open the dashboard, use **New session**, and send a message again.
3. **Check logs** for `Ollama stream: baseUrl=...` — it should show `http://host.docker.internal:11434`. If you still get 404, look for `Ollama API error: url=... status=404` to see which URL returned 404.

---

## Syncing with your Windows edits

If you edit on Windows and push to GitHub:

```bash
cd /home/insaint/Containers/liteclaw
git pull origin main
docker compose build
docker compose up -d
```

No sudo needed for build/run.
