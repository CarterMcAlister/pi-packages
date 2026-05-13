---
name: add-pi-package
description: Add a new Pi package to this pi-packages monorepo. Use when importing, vendoring, forking, or creating a package under packages/* and wiring it into this repo's workspace, Pi manifest, README, validation, and upstream-credit conventions.
---

# Add Pi Package

Use this skill when adding a package to this repository. The repo is a Bun workspace monorepo whose publishable packages live under `packages/*` and whose root manifest exposes local Pi extensions and skills.

## Repo Conventions

- Root package manager: `bun@1.3.12` from `package.json`.
- Workspace packages live directly under `packages/<directory>`.
- Root validation commands are:
  - `bun run lint`
  - `bun run typecheck`
  - `bun run validate:readme`
  - `bun run test`
  - `bun run check`
- Root `package.json` owns the Pi development manifest:
  - `pi.extensions` lists extension entry files that should load in local Pi sessions.
  - `pi.skills` lists skill directories exposed by this repo.
- `README.md` must stay aligned with package inventory:
  - the `Packages` table lists every package directory and notes.
  - `Install Individual Pi Packages` lists `pi install npm:<package-name>` commands for installable packages.
  - private/local-only packages should be called out instead of listed as normal npm installs.
  - forked, adapted, or vendored packages need a credit entry under `Credits`.
- Package names usually use `@carter-mcalister/*`; existing third-party names are preserved when intentionally vendored, such as `@victor-software-house/pi-multicodex`, `pi-lens`, `pi-ask-user`, and `pi-powerline-footer`.
- Each package `package.json` should set repository metadata with this monorepo URL and a package-specific `directory`:
  - `repository.url`: `https://github.com/CarterMcAlister/pi-packages.git`
  - `repository.directory`: `packages/<directory>`
  - `bugs.url`: `https://github.com/CarterMcAlister/pi-packages/issues`
  - `homepage`: `https://github.com/CarterMcAlister/pi-packages/tree/main/packages/<directory>#readme`
- Publishable packages should include `publishConfig.access: public`, a focused `files` list, `license: MIT`, and Pi-related keywords.
- Pi core packages should generally be `peerDependencies` and `devDependencies`, not normal runtime dependencies, unless Pi package docs require otherwise.
- TypeScript packages use ESM (`"type": "module"`) and should prefer TS source entry points because Pi can load TypeScript extension files directly.

## Before Adding

1. Identify whether the package is new original work, a fork, or a vendored upstream subtree.
2. Pick the package directory and npm package name.
3. Check for existing package inventory before editing:
   - `package.json`
   - `README.md`
   - `packages/*/package.json`
4. If importing upstream code, capture:
   - upstream repository URL
   - branch/tag/commit used
   - local prefix: `packages/<directory>`
   - whether the package should retain the upstream npm name or move under `@carter-mcalister/*`

## Add From Upstream With A Subtree

This repo vendors upstream packages into `packages/<directory>` so upstream source can be updated later without nested git repositories.

Use a temporary remote name based on the package directory:

```bash
git remote add upstream-<directory> <upstream-url>
git fetch upstream-<directory> <branch-or-tag>
git subtree add --prefix=packages/<directory> upstream-<directory> <branch-or-tag>
git remote remove upstream-<directory>
```

If the imported history is huge or noisy, discuss whether `--squash` is appropriate before using it. Do not leave nested `.git` directories inside `packages/<directory>`.

After the subtree import, make repo-local adaptation commits separately from the raw import whenever practical. Keep the raw import easy to identify in history.

## Add From Scratch

1. Create `packages/<directory>/package.json`.
2. Add runtime source under `src/` or at the package root, matching nearby package style.
3. Add `README.md` with install, local development, and package behavior.
4. Add tests only if the package has testable runtime behavior or adjacent packages use tests for similar features.
5. If it exposes Pi extensions, add package-local `pi.extensions` and root `pi.extensions` entries.
6. If it exposes skills, put them under `packages/<directory>/skills/<skill-name>/SKILL.md` and add package-local `pi.skills` if the package should expose them when installed independently.

## Wire Into This Monorepo

For every new package:

1. Confirm it is under `packages/*`; the root workspace already includes it.
2. Update `README.md` package table.
3. Update `README.md` install commands if the package is public and installable with `pi install npm:<name>`.
4. Add a `Credits` bullet if the package is forked, adapted, or vendored from upstream.
5. Update root `package.json` `pi.extensions` only for extension entry points that should load in local monorepo Pi sessions.
6. Update root `package.json` `pi.skills` only for skill directories that should be available in local monorepo Pi sessions.
7. Run `bun install` if package dependencies or lockfile-affecting manifests changed.
8. Run focused package checks first, then root checks as needed.

## Validation Checklist

Before finishing, verify:

- `packages/<directory>/package.json` has correct name, version, repository, files, license, and Pi manifest fields.
- `README.md` package table includes the package.
- install commands and private-package notes are correct.
- fork/vendor credits are present when applicable.
- root `pi.extensions` and `pi.skills` include only intended local-session entries.
- no nested `.git` directory exists under the package.
- `bun run validate:readme` passes.
- package-specific tests/checks pass if present.
- `bun run check` passes, or any unrelated failures are documented clearly.
