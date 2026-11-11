# Offline `npm` installs for airgapped machines

Short field guide, written after moving this repo onto an airgapped MacBook Air.

If you know Python wheels: the mental model is **`pip download` → `pip install --no-index --find-links=`**,
except npm has no `--find-links`. Its "wheelhouse" is **the npm cache directory**, and you copy it as one
opaque blob instead of a folder of `.whl` files.

| | Python | npm |
|---|---|---|
| Build the offline bundle | `pip download -d wheelhouse/ -r req.txt` | `npm ci --os=… --cpu=… --cache ./npm-offline-cache` |
| What you copy | a folder of `.whl` / `.tar.gz` | `_cacache/` — content-addressed, not browsable |
| Install airgapped | `pip install --no-index --find-links=wheelhouse/` | `npm ci --offline --cache <abs path>` |
| Lockfile | `requirements.txt` | `package-lock.json` (**required** by `npm ci`) |
| Platform selection | `--platform` / `--only-binary` | `--os` / `--cpu` / `--libc` |

Three things make npm harder than wheels:

1. **The cache is not a package directory** (`_cacache/index-v5` + `content-v2`). Don't try to pull single
   tarballs out of it. Tar the whole folder or don't bother.
2. **Platform binaries are chosen at install time.** `esbuild`, `@rollup/rollup-*`, `sharp`, `@swc/core`,
   `lightningcss` ship one binary *per OS/CPU* as optional dependencies. Install on Linux and you get Linux
   binaries that are useless on the Mac (`Exec format error`, `ERR_DLOPEN_FAILED`). You must *target* the
   destination platform while seeding.
3. **Some packages download in a `postinstall` script**, outside npm's knowledge. Those bytes are never in
   the cache. Env vars are how you stop them (see §4).

---

## 1. On the connected machine

```bash
git clone <repo> && cd <repo>
node -v && npm -v      # --os/--cpu need npm >= 10.1, --libc >= 10.3. Match these on the target.

# Seed ONCE PER TARGET PLATFORM, into the SAME cache dir every time.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  npm ci --os=darwin --cpu=arm64 --cache ./npm-offline-cache --no-audit --no-fund
ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  npm ci --os=darwin --cpu=x64   --cache ./npm-offline-cache --no-audit --no-fund
# Windows target: --os=win32 --cpu=x64
# Linux target:   add --libc=glibc (or --libc=musl for Alpine)
```

Repeat runs just overwrite `node_modules`; the cache is what accumulates. `--ignore-scripts` is also safe
here (tarballs still get cached) and keeps post-install scripts from running on the wrong platform.

**Verify with a simulation before you walk to the other machine.** This is the step that saves the day:

```bash
cp -r . /tmp/sim && cd /tmp/sim && rm -rf node_modules
ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  npm ci --offline --os=darwin --cpu=arm64 --cache /abs/path/to/npm-offline-cache
```

No network and no `ENOTCACHED` = the transfer will work. `ENOTCACHED` = re-seed with `--prefer-online`
and simulate again.

**Package count is a fingerprint.** Host-native and cross-target installs give different counts
(this repo: 883 native vs 895 darwin). Same number on both sides = same resolution.

Ship it:

```bash
tar -czf ../npm-cache.tgz npm-offline-cache       # large, one file
git archive --format=tar.gz -o ../src.tgz HEAD    # source + package-lock.json, tiny
shasum -a 256 ../npm-cache.tgz ../src.tgz         # verify after the USB trip
```

`git archive` has **no top-level directory**: macOS Archive Utility wraps it in a folder, `tar -xzf` does
not. Know which directory you land in.

---

## 2. On the airgapped machine

```bash
ls package-lock.json      # ← the project root is wherever this lives. Not one level up.

ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
  npm ci --offline --os=darwin --cpu=arm64 \
         --cache "$HOME/transfer/npm-offline-cache" --no-audit --no-fund

npm run build && npm start
```

Get the target platform from **Node**, not from architecture folklore:

```bash
node -p "process.platform + ' ' + process.arch"    # darwin arm64 | darwin x64 | win32 x64
```

`x86_64`/`Intel`/`amd64` → `--cpu=x64`; `arm64`/Apple Silicon → `--cpu=arm64`.

**Windows** differs only in syntax (PowerShell):

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD=1
npm ci --offline --os=win32 --cpu=x64 --cache "$HOME\transfer\npm-offline-cache" --no-audit --no-fund
```

`tar` and `Expand-Archive` both ship with Windows 10+. Long paths can bite — extract to something short
like `C:\transfer` rather than deep inside `Documents`.

No `package-lock.json`? Then it isn't an `npm ci` project: use `npm install` with the same flags
(`--offline --os --cpu --cache`), accepting that resolution is no longer pinned.

---

## 3. Error → cause

| Symptom | Cause / fix |
|---|---|
| `EUSAGE … requires a package-lock.json` | `npm ci` in a directory with no lockfile — wrong folder, or no lockfile in the repo. |
| `ENOTCACHED`, `only-if-cached but no cached response` | The seed cache lacks that entry — usually an `--os`/`--cpu` mismatch. Re-seed, then simulate again. |
| `ENOENT … package.json` | Same wrong-directory problem, one step later. |
| `Exec format error`, `ERR_DLOPEN_FAILED`, "installed for another platform" | Tree built for the wrong OS/CPU. `rm -rf node_modules`, then re-seed **and** re-install with matching flags. |
| `unable to verify the first certificate` during install | A post-install script is downloading through a proxy. Skip it (§4). |
| `EBADENGINE` | Target Node is older than the project's `engines`. |
| Installs "fine", fails much later with a cryptic bundler error | **Worst case, and it is silent.** Verified: seeding host-native then installing with `--os=darwin` on Linux exits `0` and installs a *Linux* binary. npm never complains. |
| Cache is zero bytes | You seeded with a different `--cache` path than you meant; a relative path resolves against cwd. |

Because of that silent case, the rule is: **always simulate, and trust the package count, not the exit code.**

---

## 4. Post-install downloads to disable

| Tool | Env var |
|---|---|
| Electron | `ELECTRON_SKIP_BINARY_DOWNLOAD=1` |
| Cypress | `CYPRESS_INSTALL_BINARY=0` |
| Playwright / Puppeteer | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, `PUPPETEER_SKIP_DOWNLOAD=1` |
| `sharp` | `SHARP_IGNORE_GLOBAL_LIBVIPS=1`, or install with `--os/--cpu/--libc` |
| Everything (blunt) | `npm ci --ignore-scripts` — but then `node_modules` may be missing those binaries |

A project that doesn't need Electron (this one doesn't, for the browser app) should skip it rather than
transfer it.

---

## 5. Rules of thumb

- **`npm ci` on both sides, never `npm install`.** `ci` is lockfile-exact and clears `node_modules` first.
- **Match npm major versions**, or at least re-run the simulation after upgrading.
- **Keep the seed cache.** Point `--cache` at it on every future install and the airgapped machine behaves
  like a connected one for that lockfile. It is *not* a package mirror — a new dependency means a new seed.
- **Ship the cache, not `node_modules`.** Workspaces create symlinks (`server`, `web` → `node_modules/*`);
  symlinks + portable archives + Windows is a bad afternoon.
- **Hash after the transfer.** 200 MB on a USB stick is fine; a truncated tarball is not.

---

## 6. Alternatives

- **Docker** — if the target has Docker: `docker build -t app .` → `docker save app | gzip > app.tar.gz`,
  then `docker load` + `docker run`. One file, no npm involved, multi-arch bases (`node:22-alpine`) just work.
- **Local registry (Verdaccio)** — run it on the connected box, ship the storage dir. More faithful to
  `install` workflows, more moving parts.
- **`npm pack` / vendored tarballs** — fine for a few direct deps, falls apart on deep transitive trees.
- **pnpm / Yarn** — same idea, different flags: pnpm `--os/--cpu/--libc` (≥10.14) + `pnpm fetch`; Yarn Berry
  `supportedArchitectures` + `.yarn/cache` in-repo. The cache-as-blob instinct transfers, the flags do not.

---

*Worked example: this document came out of moving WebObsidian (Electron + Vite + React + CodeMirror
workspaces) to an airgapped Apple Silicon Mac — 883 → 895 packages, a 199 MB cache covering darwin arm64
and x64, and a 1.6 MB `git archive` of the source.*
