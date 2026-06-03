---
name: tiles-release
description: Release the tiles macOS Tauri app via GitHub Actions, GitHub Releases, Homebrew tap, and Tauri updater manifest. Use only when the user explicitly asks to release tiles or prepare a tiles release.
---

# tiles Release

Release `tiles`, the macOS Tauri desktop app, through the tag-driven GitHub Actions pipeline.

## Safety

- Never release without explicit user confirmation of the target version/tag.
- Require a clean working tree before tagging or pushing.
- Do not edit secrets, signing keys, GitHub Actions credentials, or Homebrew tap credentials.
- Do not replace `/Applications/tiles.app` as part of release prep unless the user explicitly asks for local install testing.

## Release facts

- App/package version lives in `package.json`.
- `pnpm build` runs `prebuild`, which invokes `scripts/bump-version.mjs` and may auto-bump the patch version.
- Release is triggered by pushing a `vX.Y.Z` git tag.
- `.github/workflows/release.yml` builds a universal macOS app bundle on GitHub Actions.
- The workflow uploads a DMG plus Tauri updater tarball/signature to GitHub Releases.
- The workflow updates `whaleen/homebrew-tap`:
  - `Casks/tiles.rb`
  - `tiles-latest.json`
- Required GitHub secrets include `GH_PAT`, `TAURI_SIGNING_PRIVATE_KEY`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- The app is not notarized; first launch may require clearing quarantine.

## Preflight

1. Confirm repository and status:

```bash
git status --short
git branch --show-current
```

2. Inspect current version and release workflow:

```bash
node -p "require('./package.json').version"
sed -n '1,220p' .github/workflows/release.yml
```

3. Run appropriate validation before tagging. Prefer targeted checks if the tree has unrelated work; otherwise run the normal release build path:

```bash
pnpm lint
cargo check --workspace
pnpm build
```

If validation is expensive or the app requires human UI validation, ask the user before proceeding.

## Version and tag

1. Ask/confirm the intended semantic version, e.g. `0.1.5`.
2. Ensure `package.json` matches the intended version after any build/prebuild behavior.
3. Commit version/release-prep changes if needed.
4. Create and push the tag only after confirmation:

```bash
git tag vX.Y.Z
git push origin HEAD
git push origin vX.Y.Z
```

If the commit is already pushed, pushing only the tag is sufficient:

```bash
git push origin vX.Y.Z
```

## After push

1. Watch the release workflow in GitHub Actions.
2. Verify the GitHub Release has:
   - `tiles_X.Y.Z_universal.dmg`
   - `tiles.app.tar.gz`
   - `tiles.app.tar.gz.sig`
3. Verify `whaleen/homebrew-tap` was updated.
4. Verify Homebrew upgrade path when available:

```bash
brew update
brew upgrade whaleen/tap/tiles
```

## Failure handling

- If the workflow fails before publishing a release, fix the issue and move/recreate the tag only with user approval.
- If a release was partially published, do not delete or overwrite artifacts without explicit user approval.
- If Homebrew tap update fails, inspect the workflow logs and the tap repo state before retrying.
