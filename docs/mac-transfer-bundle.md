# Getting the latest fixes onto the airgapped Mac

Everything below was verified on the Linux dev machine before being written down:
the patch series re-applies cleanly and produces a **byte-identical tree**, the
prebuilt bundle boots with **production dependencies only** (229 packages, 23 MB),
and the built CSS in `server/public/assets/` actually contains both fixes.

Two fixes are waiting for you:

| commit | what |
|---|---|
| `1c46dd7` | multi-line selection is drawn at the text width, not across the padded box |
| `2e7b9cb` | dark-mode caret uses the theme's text colour instead of hardcoded black |

Plus `b299153`, the offline-npm write-up (`docs/offline-npm-airgapped.md`).

---

## Pick a route

| | **A. Prebuilt** | **B. Build on the Mac** |
|---|---|---|
| What crosses the gap | 2.8 MB tarball + production deps | 1.6 MB source + **full** dev deps |
| Needs a build on the Mac | no | yes (`npm run build`) |
| Risk | none — binaries already produced on Linux | must get the darwin cache right (`--os --cpu`) |
| Deps needed on the Mac | production only (229 pkgs) | everything (895 pkgs) |
| Node on the Mac | ≥ 20 | ≥ 20 |

**Recommended: A.** The app you run is `node server/dist/index.js` serving
`server/public` — both are plain files built on Linux (Vite/tsc output is
platform-independent). Nothing in the *runtime* path is a native module, so the
darwin/linux binary question only matters for route B.

If you'd rather keep one source of truth and build on the Mac, route B is fine —
you already have that cache working.

---

## Route A — prebuilt, no build on the Mac

### 1. On the Linux machine

You already have the clone. Make the bundle:

```bash
cd ~/webobsidian          # your existing clone
git fetch origin arena/7194f52a-webobsidian
git checkout arena/7194f52a-webobsidian
git pull
npm ci                                 # linux deps, for the build
npm run build                          # produces server/dist + server/public
```

Then either tar what you built:

```bash
SHA=$(git rev-parse --short HEAD)
tar -czf ~/webobsidian-prebuilt-$SHA.tgz server/dist server/public
```

…**or** use the bundle that already exists in this workspace
(`/home/user/mac-bundle/`), which was built and booted here:

```
webobsidian-prebuilt-2e7b9cb.tgz   2.8 MB
webobsidian-src-2e7b9cb.tgz        1.6 MB
patches/0001..0003.patch            24 KB   (alternative: git am onto your clone)
SHA256SUMS
README.txt                          (same instructions, plain text)
```

Seed the **production** dependency cache — same one-cache trick as before, just
`--omit=dev` so it stays small:

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --omit=dev \
  --os=darwin --cpu=arm64 --cache ./npm-offline-cache --no-audit --no-fund
tar -czf ~/npm-cache-prod.tgz npm-offline-cache
shasum -a 256 ~/webobsidian-prebuilt-*.tgz ~/npm-cache-prod.tgz
```

> If you already have `npm-offline-cache` from the earlier run, skip the re-seed:
> it contains both `--omit=dev` deps and the dev deps, so it serves both routes.
> `npm ci --omit=dev --offline` simply installs the smaller subset.

### 2. On the Mac

```bash
mkdir -p ~/wo-new && cd ~/wo-new
tar xzf ~/webobsidian-prebuilt-2e7b9cb.tgz                      # -> server/
tar xzf ~/webobsidian-src-2e7b9cb.tgz --strip-components=1 \
    webobsidian-src/package.json \
    webobsidian-src/package-lock.json \
    webobsidian-src/server/package.json                        # -> package.json, package-lock.json
```

You should now have `package.json`, `package-lock.json` and `server/` side by side.
`ls package-lock.json` must succeed — that's the check that bit us last time.

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --omit=dev --offline \
  --os=darwin --cpu=arm64 \
  --cache "$HOME/webobsidian/npm-offline-cache" --no-audit --no-fund
```

Expect **~229 packages**, not 895 — that difference is the early warning that you
got an `--omit=dev` install rather than the full one.

Start it (same flags as before; keep the same `DATA_DIR` so your password,
settings and workspace survive):

```bash
VAULT_PATH="$HOME/Documents/YourVault" \
DATA_DIR="$HOME/.webobsidian-data" \
WEBOBSIDIAN_PASSWORD='<your-recovery-password>' \
PORT=8787 HOST=0.0.0.0 \
node server/dist/index.js
```

Check the startup lines: `[boot] indexing vault...`, `Vault:`, `Data:`,
`WebObsidian server → http://0.0.0.0:8787`. Then open `http://localhost:8787`.

### 3. Confirm the two fixes are live

1. **Caret:** switch to dark mode (moon icon, bottom-left). Click into a line —
   the caret should be light grey (`#dadada`), not black.
2. **Selection:** drag-select from the start of one paragraph down to the start of
   the next. The highlight should stop exactly at the text, not bleed 32px left
   into the gutter or past the last character.
3. If either looks wrong, you're on a stale build — check the CSS actually shipped:

```bash
grep -o 'cm-cursor{.*}' server/public/assets/*.css | head -1
grep -o 'cm-scroller{padding:0 var(--file-margins)}' server/public/assets/*.css
```

Both should print a match.

---

## Route B — build on the Mac from source

```bash
# Linux: make the source tarball (lockfile included, tiny)
git archive --format=tar.gz --prefix=webobsidian-src/ \
  -o ~/webobsidian-src-$(git rev-parse --short HEAD).tgz HEAD

# Mac
tar xzf ~/webobsidian-src-2e7b9cb.tgz && cd webobsidian-src
ls package-lock.json
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --offline --os=darwin --cpu=arm64 \
  --cache "$HOME/webobsidian/npm-offline-cache" --no-audit --no-fund      # 895 packages
npm run build
VAULT_PATH=... DATA_DIR=... WEBOBSIDIAN_PASSWORD=... npm start
```

`x86_64`/Intel Mac → `--cpu=x64` instead. Get it from Node, not from folklore:

```bash
node -p "process.platform + ' ' + process.arch"     # darwin arm64 | darwin x64
```

---

## Route C — if you kept the clone on the Linux box

Smallest thing that crosses the gap (24 KB). On the Mac, in your existing
`~/webobsidian/webobsidian-src` clone:

```bash
git checkout -b newest
git am /Volumes/USB/patches/*.patch        # or: git apply
```

Then rebuild with the full darwin cache (`npm ci --offline --os=darwin --cpu=arm64 …`,
`npm run build`). If `git am` complains about whitespace, `git am --3way` usually
settles it.

---

## Why route A is safe (the bit that sounds too good)

`server/dist` is `tsc` output — plain JavaScript. `server/public` is the Vite
build of the web app — HTML/CSS/JS. Neither contains a binary for any OS.

What *does* contain native binaries is the dev toolchain (`esbuild`,
`@rollup/rollup-*`), and route A never runs it. That's why it dodges the
`Exec format error` / `ERR_DLOPEN_FAILED` class of problem entirely: those were
build-time failures on a darwin-targeted tree, and there is no build.

The one caveat: **the prebuilt bundle is only valid for the exact source it was
built from.** If you edit a `.tsx`/`.css` file on the Mac, you must switch to
route B (or rebuild on Linux) — `server/public` won't update itself.

---

## Housekeeping

- **Keep `DATA_DIR` stable** across upgrades — it holds the password hash,
  settings and workspace layout. Re-cloning elsewhere without pointing at it
  gives you a fresh, password-less vault.
- **Backup before upgrading** an existing `DATA_DIR`: `cp -a ~/.webobsidian-data
  ~/.webobsidian-data.bak`.
- **Rollback** is just starting the old `server/` directory again — keep the
  previous `~/wo-*` folder until the new one checks out.
- Verify checksums after the USB trip: `shasum -a 256 -c SHA256SUMS`.
