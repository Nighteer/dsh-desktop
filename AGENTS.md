# LETS desktop ownership

Never delete user files, runtime data, secrets, backups or databases without explicit approval.
Use Node ^22.19.0 or >=24 and Yarn 4.18.0. This is an independent project with its own lockfile.
Shared contracts/UI are immutable versioned archives under vendor/shared; do not import sibling source.
Desktop: implement Beta first, synchronize stable, preserve variant identities. The deepseek-harness Git submodule is read-only and keeps pnpm. Never modify upstream sources.
Keep builds and tests headless; application launch is explicit. Preserve the original dev-lets checkout and local-development.json paths.
