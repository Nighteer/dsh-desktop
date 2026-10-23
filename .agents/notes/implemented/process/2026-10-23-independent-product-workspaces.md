# Independent product workspaces

Status: implemented

Desktop, enterprise and shared are independent projects under dev-lets-harness. Desktop retains stable/Beta, community/PPT workspaces, pinned read-only upstream and its pnpm boundary. Enterprise owns admin/server, production templates and backend tests. Shared owns source for contracts/UI; consumers use immutable compiled archives, not workspace/sibling-source imports.

The 2026-08-15 topology decision remains historical provenance; its former enterprise members have been extracted under the user-approved 2026-10-23 migration. Current ownership is enforced by scripts/check-boundaries.mjs and updated verify-layout.mjs.

Do not move private state or change Docker volume/project identity as part of source refactors. Local migration configuration references the original data directory. Original checkout preserved; no production service deployment performed.
