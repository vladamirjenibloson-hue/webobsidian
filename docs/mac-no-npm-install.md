# Mac install — the no-npm route

## What went wrong (so it doesn't happen again)

Your log shows this pair of lines, in order:

```
767 http cache readdirp@…readdirp-3.6.0.tgz 0ms (cache hit)
1659 silly tarball no local data for readdirp@… Extracting by manifest.
```

npm found the **index entry** but not the **file itself**. Then, because
`--offline` forbids the network, it gave up:

```
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/readdirp/-/readdirp-3.6.0.tgz
       failed: cache mode is 'only-if-cached' but no cached response is available.
```

`tsc: command not found` is just the consequence — the install aborted, so
nothing was in `node_modules`.

A healthy npm cache has **816 index entries and 816 content blobs** — a strict
1:1 ratio. Yours had the index without the blobs, which happens when a cache is
copied/zipped in a way that skips `_cacache/content-v2/` (symlink-following
copies, partial transfer, or transferring only `_cacache/index-v5/`). It cannot
be reconstructed remotely; the blobs are the actual `.tgz` payloads.

Also worth noting: your `npm ci` ran in `~/webobsidian/webobsidian-src`, not
`~/webobsidian-build/webobsidian-src` (see line 3617 of the log,
`cwd /Users/macbookair/webobsidian/webobsidian-src`) — two copies in play.

**So: stop fighting the cache.** Ship `node_modules` with the bundle.

---

## Why this works on a Mac at all

The runtime tree contains **zero** native addons:

```bash
find node_modules -name '*.node' -o -name 'binding.gyp' | wc -l     # -> 0
```

No `@esbuild/*`, no `@rollup/rollup-*` — those are build-time only and are not
in a production install. Everything is plain JavaScript, so a Linux-built
`node_modules` runs unchanged on macOS. That's why there is nothing to rebuild
and nothing to install.

Note it is **production-only**: `npm run build` will *not* work in this folder
(there's no `tsc`, no `vite`). That's the point — the built output is already in
`server/dist` and `server/public`.

---

## The bundle

`webobsidian-noinstall.tgz` — **63 MB**, SHA256
`293dd69cf5cabc1daa3a0d1bfa3b2727c54975603887638a24133455321cf6d3`

```
server/dist/        compiled server (tsc output)
server/public/      built web app, both fixes baked in
node_modules/       production dependencies, ready to run
package.json
package-lock.json
```

Verified locally: extracted to a clean folder, ran `node server/dist/index.js`,
got HTTP 200 on `/` and the built CSS contains both fixes. No `npm` was run at
any point.

---

## Step 1 — copy it to the Mac

Put `webobsidian-noinstall.tgz` on the USB stick. Nothing else is needed —
no npm cache, no source tarball.

Check it survived the trip:

```bash
shasum -a 256 /Volumes/YOUR_USB/webobsidian-noinstall.tgz
```

Must print `293dd69c…` exactly.

## Step 2 — extract into a fresh folder

```bash
cd ~
rm -rf webobsidian-run
mkdir webobsidian-run
cd webobsidian-run
tar xzf /Volumes/YOUR_USB/webobsidian-noinstall.tgz
ls
```

You should see exactly four entries: `node_modules  package-lock.json
package.json  server`.

## Step 3 — start it

```bash
cd ~/webobsidian-run
DATA_DIR="$HOME/.webobsidian-data" \
VAULT_PATH="$HOME/Documents/YourVault" \
WEBOBSIDIAN_PASSWORD='your-recovery-password' \
PORT=8787 HOST=0.0.0.0 \
node server/dist/index.js
```

Expected output:

```
[boot] indexing vault...
[boot] index ready

  WebObsidian server → http://0.0.0.0:8787
  Vault: /Users/macbookair/Documents/YourVault
  Data:  /Users/macbookair/.webobsidian-data
```

Then open **http://localhost:8787**.

`DATA_DIR` must be the **same path you used before**, or you'll get a fresh
vault with no password set.

## Step 4 — check the two fixes

1. **Caret:** switch to dark mode (moon icon, bottom-left), click into a line —
   caret is light grey `#dadada`, not black.
2. **Selection:** drag from one paragraph to the next — the highlight starts and
   ends exactly at the text, no 32px bleed into the gutter.

If either looks wrong, confirm the CSS actually shipped:

```bash
grep -o "border-left-color:var(--caret-color)!important" server/public/assets/index-*.css
grep -o "cm-scroller{padding:0 var(--file-margins)}" server/public/assets/index-*.css
```

Both must print a match.

## Step 5 — delete the old trees

Only after it runs:

```bash
rm -rf ~/webobsidian ~/webobsidian-build
```

That removes both old copies (the one with the broken cache and the one the log
showed you were actually running in).

---

## Things you lose by doing it this way

- **No `npm run build` in `~/webobsidian-run`.** If you edit a `.tsx` or `.css`
  file, you need a machine with internet (or the working dev tree) to rebuild,
  then re-transfer `server/public`. For a stable install that's fine.
- **`node` must be ≥ 20.** You have v24.15.0 — fine.
- **Re-transfers must be whole.** Don't copy `node_modules` by hand with `cp -r`
  or a GUI tool that follows symlinks; use the tarball, which preserves them.
  (Only `node_modules/.bin/*` are symlinks now — the workspace links were
  stripped because they pointed at folders not in the bundle.)

## Rollback

Keep `~/webobsidian` until the new folder works. If the new one misbehaves,
start the old one again with the same `DATA_DIR` — the data directory is
untouched by any of this.
