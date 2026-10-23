# LETS Desktop project

Owns stable/Beta Desktop, the read-only pinned Harness submodule, desktop plugins, official Office/PPT and EXE packaging.

Run commands in this directory using Node ^22.19 or >=24 and the bundled Yarn4.18.0:

- Install: `node .yarn/releases/yarn-4.18.0.cjs install --immutable`
- Enterprise Beta: `node .yarn/releases/yarn-4.18.0.cjs enterprise:desktop`
- Enterprise stable: `node .yarn/releases/yarn-4.18.0.cjs enterprise:desktop:stable`
- Typecheck: `node .yarn/releases/yarn-4.18.0.cjs typecheck`
- Ownership boundaries: `node .yarn/releases/yarn-4.18.0.cjs check:boundaries`
- Candidate installer: `node .yarn/releases/yarn-4.18.0.cjs enterprise:release:candidate`

Validate Beta before synchronizing stable. Contracts/UI are fixed archives in vendor/shared; sibling backend/shared sources are not build dependencies.

Ignored local-development.json contains only the original checkout path. Enterprise launchers reuse its .runtime-appdata; no accounts or chats are migrated. Never start old and new copies against the same account simultaneously. Earlier release documents remain as reference; use these commands as the current entry point.
