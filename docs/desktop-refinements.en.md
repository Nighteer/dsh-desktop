# Desktop refinements and PPT mode

[中文](desktop-refinements.md)

## Entry points and presentation

New local Windows configurations default to enhanced mode: only a sidebar toggle and Application remain in the upper-left corner, retaining LETS branding. There is no Edit button; existing copy, paste and undo shortcuts in inputs are unchanged. Application has five top-level entries: View, Tools, Check for updates, About LETS and Exit application. View contains reload and developer tools; Tools contains terminal, remote control, restart, recovery mode and diagnostic export. Unsupported remote control is omitted. Exiting the application is distinct from logging out; enterprise applications remain accessible in the sidebar.

Enterprise mode shows the current employee's name to the right of Settings on the same footer row. Its native menu shows name, login account and department, plus account switching and logout. Long names truncate with a full-name tooltip; the collapsed rail keeps a labelled user icon with keyboard access. Identity comes from the enterprise session, not the Windows username. Only name, username and department name reach the page; credentials remain in the main process and only the trusted main renderer can request the menu. Account switching preserves the existing orderly Host shutdown and relaunch-to-login flow, without reusing the old workspace instance.

Presentation modes remain available in Settings; explicit choices in existing Profiles are preserved. Legacy browser/LAN configurations and Safe Mode retain compatibility presentation. Ordinary development mode shows no enterprise account entry.

An existing account still using extended mode can select enhanced mode in Settings → Desktop and confirm restart. A new Profile or data migration is unnecessary.

The Windows desktop's sidebar and composer Add workspace actions open the system folder picker directly. Cancellation creates nothing. Picker or volume-validation errors use the existing retryable workspace error flow. Ordinary browsers retain directory browsing. Native volume admission and server-side workspace creation validation are preserved.

## Plugin management

Enhanced and extended modes use a Desktop-owned Profile interface for Plugins, separating user bundles, built-in/protected bundles and the current process's runtime components. Live runtime state is distinct from next-start configuration. Search, refresh and retry are available. Compatibility presentation leaves the upstream page unchanged; enterprise websites remain under Enterprise applications.

Enabling or disabling a user bundle requires confirmation and only changes the current account/Profile's startup state, retaining files and history. Disable markers apply with all three market selections; changing markets does not re-enable disabled user bundles. Core Web packages, Desktop, PPT and components with dedicated market/remote-control preferences are protected here. No code is hot-unloaded: save work and explicitly restart Desktop to apply changes.

Adding currently accepts trusted third-party npm DSH bundles at an exact version, such as `example-dsh-plugin@1.2.3`. Ranges, arbitrary commands, Git/URL/local paths, and replacement of existing dependencies or shipped packages are rejected. A separate confirmation explains local code execution. Installation reuses the existing account-scoped Desktop CLI and controlled pnpm subprocess. Pre-operation configuration copies remain in that Profile's `.desktop-plugin-backups/`. Failure neither rolls back another writer's edits nor automatically deletes files or restarts. Ordinary packages without a DSH bundle declaration are not activated. These copies are not transactional snapshots of the full dependency tree.

The management API uses Connection authentication plus actual loopback and same-origin checks; mutations require Origin. Confirmation tokens are generation-bound, single-use and expire after five minutes. Account shutdown cancels and awaits active installation. Account paths, raw installer logs and credentials are not returned to the page. Uninstallation and enterprise plugin approval/distribution are outside this page's scope.

## Brand-blue resource pages

Plugins, Skills & MCP and Enterprise applications share Desktop-owned brand-blue presentation: a pale blue-gray canvas, white resource cards, blue primary actions and text-labelled status colors. They follow the existing dark theme and support narrow windows, keyboard focus and reduced motion without changing the sidebar, chat interface or upstream submodule.

The plugin page initially collapses built-in bundles and runtime components, prioritizing user extensions. Skills & MCP retains Enterprise resources and My installations; personal Skills accept ZIP packages only, including drag-to-select. Enterprise applications support name/purpose search and category filters, while still opening in isolated embedded desktop web views. Manual refresh provides feedback; periodic resource checks remain quiet without resetting filters or closing dialogs. Permission checks, risk confirmations, account isolation and the no-file-deletion policy are unchanged.

## PPT usage

Select a workspace, enable PPT above the new-session composer, choose a template and describe the desired deck. Templates can be previewed, selected or deselected. The catalog contains 16 templates with 12 layouts each and English/Chinese source examples. English thumbnails do not determine the output language. PPTD validation precedes editable PPTX export; blocked validation requires revision, not a success claim.

Mode and template selection persist per session. Ordinary chat no longer receives automatic PPT instructions after the mode is disabled. Personal templates belong to the current account's local Profile, not an enterprise shared library. Review complex imported company templates for layout, font and Office-object fidelity.

PPT state lives in `ppt/` beneath the current account's Harness home; data is not migrated between accounts. Authoring and delivery remain confined to the active workspace. PPT does not bypass enterprise login. Model calls continue through the enterprise model gateway; this plugin stores no separate provider key.

## Engineering and development

`dsh-ppt-runtime/` is the private `dsh-ppt` workspace managed by root Yarn, separate from the unmodified Harness submodule. The reference is pinned to dataelement/dsh-desktop commit `bc732f5dc4c5465915d5b3f28d9b0b32703fc664`. Provenance, licenses and template-adaptation notices are retained in `PROVENANCE.md` and `packages/ppt-runtime/`. Maintained JavaScript seeds are not represented as the original complete TypeScript source.

Each edition has its own version-scoped patch of the published conversation package adding three PPT seats. The Harness family and source submodule are not upgraded. Safe Mode does not load PPT. Enhanced-layout consumers wait in child plugins, never making the layout-providing desktop parent wait for its own service.

For a normal installation, use root `corepack yarn install --immutable`, then `corepack yarn workspace dsh-ppt build`. Templates, previews and temporary artifacts stay under this new module's `.build/ppt-runtime/`; builds do not clean old desktop libraries, account data or historical artifacts. Enterprise incremental startup checks/builds PPT first and reuses unchanged results.

On this machine, existing dependency trees were preserved by installing new dependencies under `.enterprise-local/ppt-dependencies-20261017/` and adding missing links with `scripts/link-ppt-development.mjs`. This uses the same Yarn 4.18, not a separate product package-manager policy. Root lockfile updates use `install --mode=update-lockfile` to skip linking. A fresh environment uses a normal root installation and does not depend on that machine-local directory.

Root `corepack yarn test:ppt` builds and checks templates, real editable Chinese PPTX export, activation through both Harness editions, workspace path restrictions and transient Windows lock retries. It is included in root test/check commands. Alternatively run `node --test dsh-ppt-runtime/test/*.test.mjs`; set `DSH_PPT_TEST_EDITION=dsh-plugin-desktop` for stable. Test artifacts remain under the new `.build/acceptance/` without automatic deletion. Native menus, the folder picker and template previews also require Electron acceptance; browser preview alone is insufficient.
