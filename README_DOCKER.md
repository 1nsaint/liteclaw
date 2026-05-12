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

Then open `http://localhost:18789` (or your host IP). To point the gateway at Ollama on the LAN (Jetson), configure the Ollama base URL as `http://192.168.0.146:11434` (or `http://192.168.0.146:11434/v1` if the UI expects an OpenAI-style path).

---

## Persistent config (survives rebuilds)

The compose file mounts a Docker volume at `/home/node/.openclaw`. Your **gateway token, device pairing, Ollama provider, and agent settings** are stored there, so you can rebuild the image and recreate the container without losing config.

- **First run** with the volume: the entrypoint copies the seed config (Ollama baseUrl, default model, no run timeout, tools on by default, heartbeat off).
- **Existing volume**: the entrypoint merges in seed defaults (Ollama baseUrl, default model) so old installs get the fix without losing token/pairing.
- **Ollama URL**: `OPENCLAW_OLLAMA_BASE_URL=http://192.168.0.146:11434` in compose forces the gateway to use that Ollama instance; it overrides config so chat always reaches Ollama.

If you had been running _without_ the volume and want to keep your current config, back it up before recreating, then restore it into the new container:

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

Ollama runs on another machine on the LAN (e.g. Jetson at `192.168.0.146`); the container reaches it at `http://192.168.0.146:11434`.

1. **Connect the gateway** (see "Gateway token" above) so the dashboard works.
2. **Add/configure the Ollama provider** in the gateway config. Either:
   - **From the dashboard**: **Settings → Config** (or **Control** → **Instances** / model config) and add or edit the Ollama provider with:
     - **Base URL**: `http://192.168.0.146:11434` (or `http://192.168.0.146:11434/v1` for OpenAI-style)
     - **API key**: any value, e.g. `ollama-local`
   - **From the host** (writes into the container's config):
     ```bash
     docker exec liteclaw node openclaw.mjs config set models.providers.ollama.apiKey "ollama-local"
     docker exec liteclaw node openclaw.mjs config set models.providers.ollama.baseUrl "http://192.168.0.146:11434"
     ```
     Then in the UI, pick an Ollama model (e.g. `ollama/gemma4:26b`) for the default agent or for a chat.
3. **Ensure Ollama is running** on the Jetson and models are pulled there (e.g. `ollama pull gemma4:26b`).

If you use **auto-discovery** (no explicit `models.providers.ollama`), the gateway looks at `http://127.0.0.1:11434` **inside the container**, which is not the host. So with Docker you need an explicit provider with `baseUrl: "http://192.168.0.146:11434"` (and optionally `apiKey: "ollama-local"`).

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

## Prompt size and timeouts (Ollama / local)

**Why is the first request slow or timing out?** Each run sends a single HTTP request to Ollama. The request body includes:

- **System prompt** — built from workspace core files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md). With full files this is ~14 KB; with lite core files it’s much smaller.
- **Tool definitions** — 21 coding tools with names, descriptions, and JSON schemas (~30 KB). So **with tools enabled** the total can be ~43 KB before your message; Ollama has to read all of that before replying, which can cause slow first token and timeouts.

**What we changed:**

1. **Ollama fetch timeout** — Increased from 120s to **300s** in the gateway so heavy prompts (e.g. Qwen3 VL) don’t hit the old limit.
2. **Tools on by default** — Seed does not set `disableTools`, so runs include tools. To reduce prompt size, use the dashboard **Agents → main → Tools**: turn off tools you don’t need (e.g. TTS) and **Save**; only enabled tools are sent. You can also set `agents.defaults.disableTools: true` for no tools, or `agents.defaults.tools.allow: ["read", "run_terminal_cmd", ...]` to send only those.
3. **Smaller system prompt** — Use the **lite core files** (see “Core files (lite)” above). They’re manually trimmed (redundancy and filler removed), so you get the full instructions without truncation. Avoid relying on `bootstrapMaxChars` to cut content mid-file—that can confuse the model.

**Other sources of size:** Memory search context and long conversation history also add to the payload; compaction helps. Keep bootstrap files short by editing the lite templates, not by slashing character limits.

---

## Streaming and thinking (Ollama)

By default LiteClaw **streams** the assistant reply (and, for reasoning models, **thinking** in a separate block) so you see tokens as they arrive instead of waiting for the full message.

- **Thinking** comes from Ollama’s `message.thinking` / `message.reasoning` and is shown in a separate, collapsible “Thinking” section (grey styling). The **reply** is only the final text, not the reasoning.
- If you previously saw **one big message with thinking pasted in** and **no streaming** (only three dots then the whole reply), that was **upstream-style mode** (buffer full response, single block). It’s no longer enabled in this repo’s `docker-compose.yml`; after a rebuild/restart you get streaming and separate thinking again.

To force the old “buffer then one block” behaviour (e.g. for debugging), set in your compose or env: `OPENCLAW_OLLAMA_UPSTREAM_STYLE=1`. See `docs/OLLAMA_UPSTREAM_VS_LITECLAW.md` for details.

---

## Web search (weather, search, etc.)

The agent can use **web search** (e.g. “check the weather in Apeldoorn”) if the **web_search** tool is available and has an API key.

1. **Enable web search** — The Docker seed sets `tools.web.search.enabled: true`. If you use an existing config, ensure **Config → Tools → Web search** (or `tools.web.search.enabled`) is on.
2. **Provide an API key** — By default the tool uses **Brave Search**. Set `BRAVE_API_KEY` in the container environment, or in config set `tools.web.search.apiKey` (or a provider-specific key). Example in `docker-compose.yml`:
   ```yaml
   environment:
     - BRAVE_API_KEY=your-brave-api-key
   ```
   Get a key at [Brave Search API](https://brave.com/search/api/). Other providers (Perplexity, Grok, Gemini, Kimi) need their own keys; see OpenClaw docs for `tools.web.search`.
3. **Restart** after changing env or config so the gateway picks it up.

If the agent says it “can’t use tools” or “doesn’t have web search”, check (a) web search is enabled and (b) an API key is set. Without a key, the tool is still listed but calls will fail at runtime.

---

## Stuck runs, timeouts, and "fetch failed"

**What’s a run?** One **run** = one agent turn: you send a message, the gateway builds a prompt, calls Ollama (one HTTP request), and may do tool calls in a loop. **runId** is a unique ID for that turn. **sessionId** is the chat session. Logs like `embedded run timeout: runId=... sessionId=... timeoutMs=600000` mean that run was aborted after 10 minutes (if you set a timeout).

**Why did it timeout?** If you set **`agents.defaults.timeoutSeconds`** to a positive value (e.g. 600 = 10 min), the gateway aborts the run when that time is exceeded → you see `embedded run timeout` and `This operation was aborted`. By default LiteClaw uses **no timeout** (`timeoutSeconds: 0`), so runs are not aborted by time; if you see a timeout, you (or the seed) have enabled one.

**Why "fetch failed"?** The gateway talks to Ollama over HTTP. **"fetch failed"** means that HTTP request failed: connection dropped, Ollama closed it, network blip, or the request was aborted (e.g. by a run timeout if you set one). So you can see both "fetch failed" (when the run ends with that error) and "This operation was aborted" (when a timeout fires).

**Why does the same session keep getting new runs?** If a run fails or times out, the session can be left with an **orphaned user message** (no reply). The gateway then starts another run for that same message (or the UI retries). So you get multiple runIds for the same session, each timing out or failing → the model stays “in use” and Unload doesn’t help.

**How to fix it so it doesn’t keep happening:**

1. **Set a run timeout** if you want to cap how long a run can take. Set `agents.defaults.timeoutSeconds` to e.g. **600** (10 min) or **300** (5 min). With the default **0** (no timeout), runs are not aborted by time. If you prefer to cut off stuck runs after a few minutes, set a positive value (e.g. **120** or **180**).

   ```bash
   docker exec liteclaw node -e "const fs=require('fs');const p='/home/node/.openclaw/openclaw.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.agents=c.agents||{};c.agents.defaults=c.agents.defaults||{};c.agents.defaults.timeoutSeconds=120;c.meta=c.meta||{};c.meta.lastTouchedAt=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(c,null,2));"
   ```

   After that, reload config or restart the container. You can also set it in the UI: **Config → Agents → defaults → timeout (seconds)**.

2. **When a chat gets stuck**, use **New session** in the OpenClaw UI instead of sending another message in the same thread. That avoids orphaned messages and repeated runs on the same session.

3. **One-off cleanup:** `docker restart liteclaw` kills all in-flight runs so the model can unload (then use the AI hub Unload button or wait for the idle timer).

---

## Chat shows "HTTP 404: 404 page not found"

The gateway must call **Ollama on the LAN** at `http://192.168.0.146:11434`. If the UI shows 404 on send:

1. **Compose must set** `OPENCLAW_OLLAMA_BASE_URL=http://192.168.0.146:11434` (done in this repo’s `docker-compose.yml`). Recreate the container so the env is applied: `docker compose up -d --force-recreate`.
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
3. **Check logs** for `Ollama stream: baseUrl=...` — it should show `http://192.168.0.146:11434`. If you still get 404, look for `Ollama API error: url=... status=404` to see which URL returned 404.

---

## Viewing logs when chat looks stuck

When a run seems stuck, you can see what the gateway is doing in two ways.

### 1. Control UI → Logs tab (easiest)

1. Open the dashboard (e.g. `http://localhost:18789`) and **connect** to the gateway (Settings → Gateway token).
2. In the sidebar, open **Logs**.
3. Click **Refresh** to load the latest gateway log lines. Keep refreshing to see new entries while a run is in progress.

You’ll see lines such as:

- `Ollama stream: baseUrl=...` — gateway started a request to Ollama
- `Ollama response: status=... model=...` — Ollama responded
- `Ollama first chunk: model=... preview=...` — first token arrived (streaming started)
- `Ollama request failed: ...` — request failed or timed out

So you can tell whether the gateway is waiting on Ollama, streaming, or hitting an error.

### 2. More detail (debug level)

To get more lines (e.g. per-chunk or internal steps), run the container with debug logging:

- **Env override** (compose): add `environment: OPENCLAW_LOG_LEVEL: debug` for the `liteclaw` service, then `docker compose up -d --force-recreate`.
- **Config**: set `logging.level` to `"debug"` in the gateway config (e.g. via Config tab or `docker exec liteclaw node openclaw.mjs config set logging.level debug`), then `docker restart liteclaw`.

After that, the same Logs tab (Refresh) will show more verbose entries.

### 3. Tail logs from the host (optional)

To follow the log file inside the container from your terminal:

```bash
# Today’s log file (name uses gateway’s date)
docker exec liteclaw tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
```

If that path is missing, the gateway may be using a different log path from config; the Logs tab in the UI shows the actual file path it’s tailing.

---

## Reducing prompt size (why "hi" sends ~36k tokens)

When you send a single "hi", the gateway still sends a **large prompt** to Ollama because every request includes:

1. **System prompt** – Identity, workspace rules, tool list text, skills blurb, runtime info, memory/recall instructions, etc. LiteClaw defaults to **`promptMode: "lite"`** so this is shorter than "full".
2. **Tool definitions** – **All enabled tools** with full JSON schemas (name, description, parameters). With 21 tools that can be 15k–25k tokens. Ollama receives the full list so the model can call any of them.
3. **Transcript** – For "hi" this is usually tiny (one user message); it only grows with history.

**Why this hurts on a 32k context:** If the prompt is ~26k tokens, the model has only ~6k left for its reply. So it can’t “process 26k and then answer freely” — the reply is squeezed. Reducing prompt size (lite mode + fewer tools, or compact tool schema) is what gives the model room to respond.

So the bulk of the 36k tokens is **system prompt + tool schemas**, not your one word. To reduce prompt size on low-end hardware:

### 1. Shorter system prompt: `promptMode: "lite"` (default)

LiteClaw **defaults** to **`promptMode: "lite"`** so the system prompt is already trimmed. To get even shorter, set **`promptMode`** to **`"minimal"`** in config. To get the full boilerplate, set it to **`"full"`**.

### 2. Fewer tools: `agents.defaults.tools.allow`

Send only the tools you need for simple chat so the model gets a smaller tool list and schemas:

- **`agents.defaults.tools.allow`** = **`["message", "read", "session_status"]`** (or add `exec`, `web_search`, etc. if you want them).

Then only those tools (and their schemas) are sent; prompt size drops a lot. In the UI: **Agents** → **main** → **Tools** → pick a **Minimal** preset (or similar) and **Save**, or set the allow list in Config.

### 3. Single “invoke” tool: `agents.defaults.tools.compactSchema`

To give the model a **short list** of tool names and only one schema instead of 20+ full JSON schemas:

- **`agents.defaults.tools.compactSchema`** = **`true`**

The model then sees a single tool **`invoke_tool`** with parameters `tool_name` and `arguments`. The system prompt still lists which tools exist (read, write, message, etc.); the model calls `invoke_tool(tool_name="read", arguments={ path: "..." })` and the runner dispatches to the real tool. This can save roughly 15k–25k tokens on the request while keeping all tools available.

### 4. Timeout

The **default run timeout** is **off** (**`timeoutSeconds: 0`** = no timeout). That avoids cutting off long runs on low-end hardware (e.g. slow prompt eval, web tools, or scripts that take a while). The Docker seed sets **`timeoutSeconds: 0`** so container runs are not time-limited. To cap runs again, set **`agents.defaults.timeoutSeconds`** to a positive value (e.g. **300** for 5 minutes).

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
