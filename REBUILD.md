# Rebuilding LiteClaw so changes apply

If your backend/UI changes never seem to apply, the running container is likely an old image or the build context is wrong. Use the fingerprint below to prove the container is from _this_ repo build.

## 0. Prove the container is from your build (no browser needed)

After rebuilding and `docker compose up -d`, run:

```bash
curl -s http://localhost:18789/build-info.txt
```

You should see one line like: `LiteClaw 2025-03-03T14:22:00+00:00 image-build`

- If you get **that line** → the container is serving the image you just built; any remaining issue is in the app code or browser cache.
- If you get **404** or something else → the container is not using the image from this Dockerfile (old image, wrong compose, or gateway not serving control-ui from the image).

## 1. Rebuild the image without cache

From this directory (`liteclaw`):

```bash
docker compose build --no-cache
```

Then start/restart:

```bash
docker compose up -d
```

## 2. Hard-refresh the browser

After the new container is running:

- **Chrome/Edge:** `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Or open the dashboard in a private/incognito window

Otherwise the browser may keep using the old Control UI bundle.

## 3. Check that the new build is running

- The **browser tab title** should be **"LiteClaw"** (set in `ui/index.html`).
- The **top bar** should show **"LiteClaw"** and "Gateway Dashboard" (from `ui/src/ui/app-render.ts`).

If you still see "OpenClaw Control" or "OPENCLAW", the build context or cache is wrong: ensure you run `docker compose build --no-cache` from the repo that contains these changes.

## When the UI won't load at all

If the page never loads or stops after a while:

1. **Check the container is running:** `docker ps` — you should see `liteclaw` with status Up.
2. **Check logs for crashes:** `docker logs liteclaw` (or `docker compose logs liteclaw`). Look for Node errors, OOM, or "address already in use".
3. **Confirm you're on the new image:** `docker images liteclaw:local` — check the "Created" time is from your last build.
4. **Version "dev"** in the header is normal for a non-release build; it does not block the app or mean your changes are missing. The brand (LiteClaw) is set at **build time** via `VITE_APP_BRAND=LiteClaw` in the Dockerfile, so a successful image build will show LiteClaw in the top bar.
