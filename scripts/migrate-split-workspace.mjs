/** Copy-only migration. Never changes the source checkout, its data, or running services. */
import fs from 'node:fs'
import { resolve, join, dirname, relative, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const source = resolve(import.meta.dirname, '..')
const target = resolve(process.argv[2] ?? '../dev-lets-harness')
if (target === source || target.startsWith(source + '\\') || fs.existsSync(target)) throw new Error('Target must be a new sibling directory')
const run = (command, args, cwd = source) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
const read = path => fs.readFileSync(path, 'utf8')
const json = path => JSON.parse(read(path))
const put = (path, text) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text) }
const save = (path, value) => put(path, JSON.stringify(value, null, 2) + '\n')
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const copied = []
function copy(file, destination) {
  fs.mkdirSync(dirname(destination), { recursive: true })
  fs.copyFileSync(join(source, file), destination, fs.constants.COPYFILE_EXCL)
  copied.push({ source: file, destination: relative(target, destination).replaceAll('\\', '/'), sha256: hash(destination) })
}
fs.mkdirSync(target)
const desktop = join(target, 'desktop'), enterprise = join(target, 'enterprise'), shared = join(target, 'shared')
for (const directory of [desktop, enterprise, shared]) fs.mkdirSync(directory)
console.log('Copying current tracked and untracked source, excluding ignored/private state')
run('git', ['clone', '--no-hardlinks', '--no-checkout', source, desktop])
const backendScripts = new Set(['enterprise-db.mjs', 'package-enterprise-server.mjs', 'test-enterprise-deployment.mjs', 'test-enterprise-isolated-db.mjs', 'test-enterprise-ops.mjs', 'rehydrate-release-dependency.mjs', 'collect-enterprise-review.mjs'])
const files = [...new Set(run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))]
for (const file of files) {
  const first = file.split('/')[0]
  if (file === 'deepseek-harness' || !fs.existsSync(join(source, file)) || !fs.lstatSync(join(source, file)).isFile()) continue
  if (['output', '_deprecated', 'office'].includes(first)) continue
  if (first === 'dsh-enterprise-contracts') { copy(file, join(shared, file)); continue }
  if (['dsh-enterprise-admin', 'dsh-enterprise-server'].includes(first)) { copy(file, join(enterprise, file)); continue }
  if (file === 'compose.enterprise.yaml' || file.startsWith('deployment/enterprise/')) { copy(file, join(enterprise, file)); continue }
  if (/^docs\/enterprise-/.test(file)) { copy(file, join(enterprise, file)); continue }
  if (first === 'scripts' && backendScripts.has(basename(file))) { copy(file, join(enterprise, file)); continue }
  if (/^dsh-plugin-desktop-beta\/tests\/admin-.*\.spec\.ts$/.test(file)) { copy(file, join(enterprise, 'dsh-enterprise-admin/tests', basename(file))); continue }
  if (/^dsh-plugin-desktop\/tests\/admin-.*\.spec\.ts$/.test(file)) continue
  copy(file, join(desktop, file))
}
// Only public build tooling/configuration is shared; no local secrets are copied.
for (const name of ['LICENSE', '.yarnrc.yml', '.gitattributes']) {
  for (const directory of [enterprise, shared]) if (!fs.existsSync(join(directory, name))) copy(name, join(directory, name))
}
const yarnSource = join(source, '.corepack-cache/v1/yarn/4.18.0/yarn.js')
for (const directory of [desktop, enterprise, shared]) {
  fs.mkdirSync(join(directory, '.yarn/releases'), { recursive: true })
  fs.copyFileSync(yarnSource, join(directory, '.yarn/releases/yarn-4.18.0.cjs'))
}
console.log('Preserving pinned upstream Git checkout without changing the source submodule')
run('git', ['clone', '--no-hardlinks', join(source, 'deepseek-harness'), join(desktop, 'deepseek-harness')])
run('git', ['remote', 'set-url', 'origin', json(join(source, 'upstream.json')).repository], join(desktop, 'deepseek-harness'))
run('git', ['submodule', 'absorbgitdirs', 'deepseek-harness'], desktop)
save(join(target, 'migration-source-snapshot.json'), { createdAt: new Date().toISOString(), source, sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(), files: copied, excluded: ['ignored private/runtime state', 'node_modules', 'old generated output', '_deprecated'], originalPreserved: true })
for (const directory of [enterprise, shared]) {
  run('git', ['init', '-b', 'codex/split-workspace'], directory)
  fs.copyFileSync(join(source, 'yarn.lock'), join(directory, 'yarn.lock'))
  put(join(directory, '.gitignore'), 'node_modules/\n.yarn/*\n!.yarn/releases/\n.enterprise-local/\n.artifacts/\n**/dist/\n**/lib/\nlocal-development.json\n*.tsbuildinfo\n')
}
// Snapshot first, before dependency and layout transformations. Identity is scoped to these commits.
function checkpoint(directory, message) {
  run('git', ['add', '-A'], directory)
  run('git', ['-c', 'user.name=Codex', '-c', 'user.email=codex@local.invalid', 'commit', '-m', message], directory)
}
checkpoint(desktop, 'chore: snapshot desktop inputs before workspace separation')
checkpoint(enterprise, 'chore: snapshot enterprise inputs before workspace separation')
checkpoint(shared, 'chore: snapshot shared contracts before workspace separation')
console.log('Source snapshots committed; extracting shared packages')
const version = '0.1.0-split.1'
const ui = join(shared, 'dsh-enterprise-ui')
const sharedUiFiles = ['AdminLogin.tsx', 'Login.tsx', 'EnterpriseConnection.tsx', 'Brand.tsx', 'brand-theme.css', 'admin-design.css', 'style.css', 'confirmation.css', 'assets/lets-logo.png']
for (const name of sharedUiFiles) {
  const to = join(ui, 'src', name)
  fs.mkdirSync(dirname(to), { recursive: true })
  fs.copyFileSync(join(source, 'dsh-enterprise-admin/src', name), to, fs.constants.COPYFILE_EXCL)
}
const contractsFile = join(shared, 'dsh-enterprise-contracts/package.json'), contracts = json(contractsFile)
contracts.version = version
contracts.files = ['src']
contracts.exports['./enterprise-origin'] = './src/enterprise-origin.ts'
contracts.exports['./desktop-releases'] = './src/desktop-releases.ts'
save(contractsFile, contracts)
save(join(ui, 'package.json'), { name: 'dsh-enterprise-ui', version, private: true, type: 'module', files: ['src'], exports: { './login': './src/Login.tsx', './admin-login': './src/AdminLogin.tsx', './enterprise-connection': './src/EnterpriseConnection.tsx', './brand': './src/Brand.tsx', './style': './src/brand-theme.css', './admin-style': './src/admin-design.css' }, scripts: { typecheck: 'tsc --noEmit' }, peerDependencies: { react: '18.3.1', 'react-dom': '18.3.1' }, devDependencies: { '@types/react': '^18', '@types/react-dom': '^18', typescript: '6.0.3', vite: '8.2.1' } })
fs.copyFileSync(join(source, 'dsh-enterprise-admin/tsconfig.json'), join(ui, 'tsconfig.json'))
const baseManifest = { private: true, packageManager: 'yarn@4.18.0', engines: { node: '^22.19.0 || >=24.0.0' } }
save(join(shared, 'package.json'), { ...baseManifest, name: 'lets-shared', workspaces: ['dsh-enterprise-contracts', 'dsh-enterprise-ui'], scripts: { typecheck: 'yarn workspace dsh-enterprise-contracts typecheck && yarn workspace dsh-enterprise-ui typecheck', export: 'node scripts/export-packages.mjs' } })
// This export tool uses only shared-owned files and never overwrites an existing release.
const exportTool = `import fs from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');const output=join(root,'releases');fs.mkdirSync(output,{recursive:true});const records=[];
for(const name of ['dsh-enterprise-contracts','dsh-enterprise-ui']){const dir=join(root,name),p=JSON.parse(fs.readFileSync(join(dir,'package.json'),'utf8'));const stem=name+'-'+p.version;const archive=join(output,stem+'.tgz');if(fs.existsSync(archive))throw new Error('Release exists; increment version instead of overwriting: '+stem);const stage=join(output,'.staging',stem,'package');fs.mkdirSync(stage,{recursive:true});for(const entry of ['package.json',...p.files])fs.cpSync(join(dir,entry),join(stage,entry),{recursive:true,errorOnExist:true,force:false});execFileSync('tar',['-czf',archive,'-C',resolve(stage,'..'),'package'],{windowsHide:true});records.push({name,version:p.version,file:stem+'.tgz',sha256:createHash('sha256').update(fs.readFileSync(archive)).digest('hex')});}fs.writeFileSync(join(output,'manifest-'+Date.now()+'.json'),JSON.stringify(records,null,2)+'\\n',{flag:'wx'});console.log(JSON.stringify(records));`
put(join(shared, 'scripts/export-packages.mjs'), exportTool)
const archives = JSON.parse(run(process.execPath, [join(shared, 'scripts/export-packages.mjs')], shared).trim())
const archiveDependency = name => `file:vendor/shared/${archives.find(a => a.name === name).file}`
for (const directory of [desktop, enterprise]) for (const entry of archives) {
  fs.mkdirSync(join(directory, 'vendor/shared'), { recursive: true })
  fs.copyFileSync(join(shared, 'releases', entry.file), join(directory, 'vendor/shared', entry.file))
}
const sourceRoot = json(join(source, 'package.json'))
const desktopRoot = structuredClone(sourceRoot)
desktopRoot.name = 'lets-desktop'
desktopRoot.workspaces = desktopRoot.workspaces.filter(n => !n.startsWith('dsh-enterprise-'))
for (const key of ['enterprise:db','enterprise:migrate','enterprise:init-admin','enterprise:server','enterprise:admin','enterprise:package:server','enterprise:test:isolated','enterprise:test:deployment','enterprise:check','enterprise:typecheck']) delete desktopRoot.scripts[key]
desktopRoot.scripts.build = 'yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop build && yarn workspace dsh-plugin-desktop-beta build'
desktopRoot.scripts.typecheck = 'yarn workspace dsh-plugin-desktop typecheck && yarn workspace dsh-plugin-desktop-beta typecheck && yarn workspace dsh-community-market typecheck'
desktopRoot.scripts.check = 'yarn check:layout && yarn workspace dsh-community-fabric check && yarn workspace dsh-community-market check && yarn workspace dsh-plugin-desktop check && yarn workspace dsh-plugin-desktop-beta check && yarn test:ppt'
desktopRoot.scripts['enterprise:test:release'] = 'node --test scripts/desktop-release.test.mjs'
desktopRoot.dependencies = { 'dsh-enterprise-contracts': archiveDependency('dsh-enterprise-contracts') }
save(join(desktop, 'package.json'), desktopRoot)
for (const edition of ['dsh-plugin-desktop-beta', 'dsh-plugin-desktop']) {
  const path = join(desktop, edition, 'package.json'), manifest = json(path)
  for (const field of ['dependencies', 'devDependencies']) {
    if (manifest[field]?.['dsh-enterprise-admin']) { delete manifest[field]['dsh-enterprise-admin']; manifest[field]['dsh-enterprise-ui'] = '../' + archiveDependency('dsh-enterprise-ui').replace('file:', '') }
    if (manifest[field]?.['dsh-enterprise-ui']) manifest[field]['dsh-enterprise-ui'] = 'file:' + manifest[field]['dsh-enterprise-ui']
    if (manifest[field]?.['dsh-enterprise-contracts']) manifest[field]['dsh-enterprise-contracts'] = 'file:../' + archiveDependency('dsh-enterprise-contracts').replace('file:', '')
  }
  save(path, manifest)
  for (const directory of ['src', 'tests']) rewriteTree(join(desktop, edition, directory), text => text.replaceAll('dsh-enterprise-admin/', 'dsh-enterprise-ui/'))
}
function rewriteTree(directory, transform) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) rewriteTree(path, transform)
    else if (/\.(?:[cm]?[jt]sx?|css|json|ya?ml|md)$/.test(entry.name)) {
      const old = read(path), next = transform(old, path)
      if (old !== next) put(path, next)
    }
  }
}
// Shared components have one implementation; admin-local entry points remain compatible.
for (const [file, symbol, entry] of [['AdminLogin.tsx','AdminLogin','admin-login'],['Login.tsx','LoginView','login'],['EnterpriseConnection.tsx','EnterpriseConnection','enterprise-connection'],['Brand.tsx','Brand,Icon','brand']]) {
  put(join(enterprise, 'dsh-enterprise-admin/src', file), `export {${symbol}} from 'dsh-enterprise-ui/${entry}'\n` + (file === 'Login.tsx' ? `export type {LoginViewProps} from 'dsh-enterprise-ui/login'\n` : file === 'EnterpriseConnection.tsx' ? `export type {EnterpriseConnectionProps} from 'dsh-enterprise-ui/enterprise-connection'\n` : ''))
}
put(join(enterprise, 'dsh-enterprise-admin/src/brand-theme.css'), "@import 'dsh-enterprise-ui/style';\n")
put(join(enterprise, 'dsh-enterprise-admin/src/admin-design.css'), "@import 'dsh-enterprise-ui/admin-style';\n")
const adminPath = join(enterprise, 'dsh-enterprise-admin/package.json'), admin = json(adminPath)
admin.dependencies['dsh-enterprise-contracts'] = 'file:../' + archiveDependency('dsh-enterprise-contracts').slice(5)
admin.dependencies['dsh-enterprise-ui'] = 'file:../' + archiveDependency('dsh-enterprise-ui').slice(5)
Object.assign(admin.devDependencies, { vitest: '4.1.8', jsdom: '29.1.1' })
admin.scripts.test = 'vitest run'
save(adminPath, admin)
const serverPath = join(enterprise, 'dsh-enterprise-server/package.json'), server = json(serverPath)
server.dependencies['dsh-enterprise-contracts'] = 'file:../' + archiveDependency('dsh-enterprise-contracts').slice(5)
server.scripts.dev = 'node ../scripts/local-development.mjs server'
save(serverPath, server)
save(join(enterprise, 'package.json'), { ...baseManifest, name: 'lets-enterprise', workspaces: ['dsh-enterprise-admin', 'dsh-enterprise-server'], dependencies: { 'dsh-enterprise-contracts': archiveDependency('dsh-enterprise-contracts') }, scripts: { 'enterprise:db': 'node scripts/local-development.mjs database', 'enterprise:server': 'node scripts/local-development.mjs server', 'enterprise:admin': 'yarn workspace dsh-enterprise-admin dev', 'enterprise:migrate': 'node scripts/local-development.mjs migrate', 'enterprise:init-admin': 'node scripts/local-development.mjs init-admin', 'enterprise:package:server': 'node scripts/package-enterprise-server.mjs', 'enterprise:test:isolated': 'node scripts/test-enterprise-isolated-db.mjs', 'enterprise:test:deployment': 'node scripts/test-enterprise-deployment.mjs', build: 'yarn workspace dsh-enterprise-admin build', typecheck: 'yarn workspace dsh-enterprise-server typecheck && yarn workspace dsh-enterprise-admin typecheck', test: 'yarn workspace dsh-enterprise-admin test && node --test scripts/server-release.test.mjs', check: 'yarn typecheck && yarn test && yarn build' } })
put(join(enterprise, 'dsh-enterprise-admin/vitest.config.ts'), "import {defineConfig} from 'vitest/config'\nexport default defineConfig({resolve:{dedupe:['react','react-dom']},test:{environment:'jsdom',include:['tests/**/*.spec.ts'],maxWorkers:2}})\n")
// Server deployment continues to contain its own minimal runtime workspace, not sibling source.
let pack = read(join(enterprise, 'scripts/package-enterprise-server.mjs'))
pack = pack.replace("const source = join(sourceRoot, name, 'src')", "const source = name === 'dsh-enterprise-contracts' && !existsSync(join(sourceRoot,name,'src')) ? resolve(createRequire(join(sourceRoot,'package.json')).resolve('dsh-enterprise-contracts'),'..') : join(sourceRoot,name,'src')")
pack = pack.replace("createRequire(join(root, 'dsh-enterprise-contracts/package.json'))", "createRequire(join(root, 'package.json'))")
put(join(enterprise, 'scripts/package-enterprise-server.mjs'), pack)
// Desktop release helpers must not import the enterprise packager.
const originalPack = read(join(source, 'scripts/package-enterprise-server.mjs'))
const helperImports = originalPack.slice(0, originalPack.indexOf('const root ='))
const helperFunctions = originalPack.slice(originalPack.indexOf('export function run('), originalPack.indexOf('export const RELEASE_TEMPLATE_FILES'))
put(join(desktop, 'scripts/release-utils.mjs'), helperImports + "const root = resolve(import.meta.dirname, '..')\n" + helperFunctions)
const releasePath = join(desktop, 'scripts/release-enterprise-desktop.mjs')
put(releasePath, read(releasePath).replace("'./package-enterprise-server.mjs'", "'./release-utils.mjs'").replace("'../dsh-enterprise-contracts/src/enterprise-origin.ts'", "'dsh-enterprise-contracts/enterprise-origin'").replace("'../dsh-enterprise-contracts/src/desktop-releases.ts'", "'dsh-enterprise-contracts/desktop-releases'"))
const releaseTests = read(join(source, 'scripts/enterprise-release.test.mjs'))
put(join(desktop, 'scripts/desktop-release.test.mjs'), releaseTests.slice(0, releaseTests.indexOf("test('ops bundles")).replace('safeVersion, copyReleaseInputs, RELEASE_TEMPLATE_FILES','safeVersion').replace("'./package-enterprise-server.mjs'", "'./release-utils.mjs'"))
put(join(desktop, 'scripts/enterprise-release.test.mjs'), "// Compatibility entry; server packaging tests now belong to the enterprise project.\nimport './desktop-release.test.mjs'\n")
put(join(enterprise, 'scripts/server-release.test.mjs'), releaseTests.slice(0, releaseTests.indexOf("test('formal releases")).replace("import { cleanBuildEnvironment, releasePlan, verifyPE } from './release-enterprise-desktop.mjs'\n", '') + releaseTests.slice(releaseTests.indexOf("test('ops bundles")))
// Keep strict desktop topology checks, adjusting only the deliberately extracted packages.
const layout = join(desktop, 'scripts/verify-layout.mjs')
let check = read(layout)
check = check.replace(/const enterprisePackages = \['dsh-enterprise-contracts', 'dsh-enterprise-server', 'dsh-enterprise-admin'\]\s*\.map\(name => \[name, readJson\(`\$\{name\}\/package.json`\)\]\)/, 'const enterprisePackages = []')
check = check.replaceAll("  'dsh-enterprise-contracts',\n", '').replaceAll("  'dsh-enterprise-server',\n", '').replaceAll("  'dsh-enterprise-admin',\n", '')
put(layout, check)
// New local configuration contains paths only; credentials remain in the original private directory.
for (const directory of [desktop, enterprise]) {
  put(join(directory, '.gitignore'), read(join(directory, '.gitignore')) + '\nlocal-development.json\n')
  save(join(directory, 'local-development.json'), { legacyRoot: source })
}
put(join(enterprise, 'scripts/local-development.mjs'), `import fs from 'node:fs';import {resolve,join} from 'node:path';import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),config=join(root,'local-development.json');const legacy=fs.existsSync(config)?JSON.parse(fs.readFileSync(config,'utf8')).legacyRoot:root;const local=join(legacy,'.enterprise-local');const action=process.argv[2]??'server';const env={...process.env,ENTERPRISE_MODEL_KEY_FILE:process.env.ENTERPRISE_MODEL_KEY_FILE??join(local,'model-key.bin'),DESKTOP_RELEASES_DIR:process.env.DESKTOP_RELEASES_DIR??join(local,'desktop-releases')};
if(!fs.existsSync(join(local,'server.env')))throw new Error('Configure local-development.json or create a private server.env; migration never initializes an empty database');
const db=action==='database';if(!db&&!['server','migrate','init-admin'].includes(action))throw new Error('Unknown action');const args=db?['compose','--env-file',join(local,'server.env'),'-f',join(root,'compose.enterprise.yaml'),'up','-d','--wait']:['--env-file='+join(local,'server.env'),...(action==='server'?['--watch',join(root,'dsh-enterprise-server/src/main.ts')]:[join(root,'dsh-enterprise-server/src/cli.ts'),action])];const child=spawnSync(db?'docker':process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});if(child.error)throw child.error;process.exitCode=child.status??1;
`)
const desktopLauncher = join(desktop, 'scripts/enterprise-desktop.mjs')
let launcher = read(desktopLauncher)
launcher = "import {existsSync,readFileSync} from 'node:fs'\n" + launcher
launcher = launcher.replace("const args=new Set", "const config=resolve(root,'local-development.json')\nconst dataRoot=existsSync(config)?JSON.parse(readFileSync(config,'utf8')).legacyRoot:root\nconst args=new Set")
launcher = launcher.replace("resolve(root,'.runtime-appdata'", "resolve(dataRoot,'.runtime-appdata'")
put(desktopLauncher, launcher)
for (const directory of [desktop, enterprise, shared]) {
  // Pin a local Yarn executable; installation uses the same approved workspace policies.
  put(join(directory, '.yarnrc.yml'), read(join(directory, '.yarnrc.yml')) + '\nyarnPath: .yarn/releases/yarn-4.18.0.cjs\n')
  put(join(directory, 'AGENTS.md'), `# LETS ${basename(directory)} ownership\n\nNever delete user files, runtime data, secrets, backups or databases without explicit approval.\nUse Node ^22.19.0 or >=24 and Yarn 4.18.0. This is an independent project with its own lockfile.\nShared contracts/UI are immutable versioned archives under vendor/shared; do not import sibling source.\nDesktop: implement Beta first, synchronize stable, preserve variant identities. The deepseek-harness Git submodule is read-only and keeps pnpm. Never modify upstream sources.\nKeep builds and tests headless; application launch is explicit. Preserve the original dev-lets checkout and local-development.json paths.\n`)
}
put(join(target, 'README.md'), `# LETS separated development workspace\n\n- desktop/: desktop stable/Beta, pinned Harness and EXE packaging.\n- enterprise/: admin web, API, database/deployment tooling.\n- shared/: canonical contracts/UI sources and immutable versioned archives.\n\nEach project owns its Git history, Yarn 4.18.0 lock and commands. No root dependency installation is required.\nOriginal checkout remains at ${source}; local-development.json contains paths only and is ignored. No runtime data, passwords, database volumes or keys were migrated. Existing deployments are unchanged.\n\nSee MIGRATION.md for commands and verification status.\n`)
save(join(target, 'shared-packages.json'), archives)
console.log(`Copied ${copied.length} source files; immutable shared packages exported. Target: ${target}`)
