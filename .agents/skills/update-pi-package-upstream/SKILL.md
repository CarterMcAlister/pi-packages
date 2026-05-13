---
name: update-pi-package-upstream
description: Update a vendored or forked Pi package in this pi-packages monorepo from its upstream source using git subtree workflows. Use when refreshing packages/* from upstream repositories while preserving this repo's package, README, Pi manifest, and adaptation conventions.
---

# Update Pi Package From Upstream

Use this skill when refreshing an existing package under `packages/*` from an upstream repository. This repo keeps upstream packages as normal files in the monorepo, not as git submodules, so updates should use `git subtree`-style imports and then reapply or adjust local adaptations.

## Repo Conventions

- Packages live under `packages/<directory>` and are part of the root Bun workspace.
- Root package manager is `bun@1.3.12`.
- Root checks:
  - `bun run lint`
  - `bun run typecheck`
  - `bun run validate:readme`
  - `bun run test`
  - `bun run check`
- Root `README.md` is the package inventory and must stay accurate.
- Root `package.json` `pi.extensions` and `pi.skills` define what this monorepo loads in local Pi sessions.
- Forked, adapted, or vendored packages need credits in root `README.md`.
- Package manifests in this repo should use the `@carter-mcalister/*` package namespace and this repository metadata even when the code started upstream. Do not keep an upstream publisher namespace for a fork or vendored adaptation; preserve upstream identity in README credits and package notes instead:
  - `repository.url`: `https://github.com/CarterMcAlister/pi-packages.git`
  - `repository.directory`: `packages/<directory>`
  - package-specific `homepage` pointing to the package directory in this repo.
- Keep package-local conventions unless intentionally changing them. For example, `pi-lens` has its own `AGENTS.md`, package-lock, build/test workflow, and generated-JS cautions.
- Keep local package adaptations separate from raw upstream import commits when possible.

## Preflight

1. Inspect current state:
   - `git status --short`
   - `README.md`
   - `packages/<directory>/package.json`
   - package-local `README.md`, `AGENTS.md`, `CHANGELOG.md`, and tests if present.
2. Identify the upstream source from root `README.md` credits, package README prior-art sections, package metadata, or user input.
3. Capture the upstream branch/tag/commit you intend to import.
4. Check for local uncommitted changes in the package. Do not overwrite unrelated user work.
5. Decide with the user before any destructive reset, force overwrite, large conflict resolution, package rename, or history rewrite.

## Subtree Update Workflow

Use a temporary remote name tied to the package directory:

```bash
git remote add upstream-<directory> <upstream-url>
git fetch upstream-<directory> <branch-or-tag>
git subtree pull --prefix=packages/<directory> upstream-<directory> <branch-or-tag>
git remote remove upstream-<directory>
```

If the package was originally imported with a squashed subtree, use the same squashing style for updates:

```bash
git subtree pull --prefix=packages/<directory> upstream-<directory> <branch-or-tag> --squash
```

If history does not include subtree metadata, use the current package state and the original import commit as evidence, then proceed carefully with a subtree pull only when Git can merge it cleanly. If Git cannot establish subtree history, stop and use an explicit import plan rather than forcing a blind overwrite.

Never leave the temporary upstream remote in the repo after the update.

## Reapply Repo-Local Adaptations

After the raw upstream update, inspect and restore this repo's conventions:

1. Package manifest:
   - keep the intended `@carter-mcalister/*` package name and version policy.
   - keep monorepo repository, bugs, homepage, publishConfig, files, keywords, license, and Pi manifest fields.
   - keep Pi core packages in `peerDependencies`/`devDependencies` unless docs require runtime dependencies.
2. Entrypoints:
   - preserve root `pi.extensions` paths for local Pi sessions.
   - preserve root/package `pi.skills` entries for skills.
3. Documentation:
   - update package README only where behavior changed.
   - keep root `README.md` package table, install commands, private notes, and credits aligned.
4. Tooling:
   - keep package-local lockfiles only when that package convention already includes them.
   - do not convert the whole monorepo away from Bun because an upstream package uses npm or pnpm.
5. Generated artifacts:
   - follow package-local rules. For `pi-lens`, edit `.ts` sources and regenerate `.js` with the package build when needed; do not hand-edit generated sibling JS files.

## Conflict Strategy

- Prefer upstream source for generic implementation files.
- Prefer this repo's local version for monorepo metadata, `@carter-mcalister/*` package names, Pi manifests, README inventory, release/install notes, and local adaptation docs.
- When both sides changed behavior, inspect tests and changelogs before choosing.
- Keep conflicts small and explain any intentional divergence from upstream.
- Avoid unrelated cleanup while resolving subtree conflicts.

## Validation Checklist

Before finishing, verify with real evidence:

- `git status --short` shows only intended package/update files.
- temporary `upstream-<directory>` remote was removed.
- no nested `.git` directory exists under `packages/<directory>`.
- root `README.md` still lists the package correctly.
- package `README.md` and credits still name the upstream source when applicable.
- forked or adapted package manifests keep the `@carter-mcalister/*` namespace rather than reverting to upstream package names.
- root `pi.extensions` and `pi.skills` still expose the intended local-session entries.
- package-specific checks pass when available.
- `bun run validate:readme` passes after README or package inventory changes.
- run `bun run check` when the update touches TypeScript source, package manifests, or shared repo config. If unrelated existing failures block it, report them separately.

## Useful Commands

```bash
git status --short
git remote -v
git log --oneline -- packages/<directory> | head -20
git diff -- packages/<directory>
find packages/<directory> -name .git -type d
bun run validate:readme
bun run check
```
