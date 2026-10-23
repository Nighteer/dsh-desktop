/** Preserve Electron's sample outside the application resources before verification. */
import { existsSync, lstatSync, renameSync } from 'node:fs'
import { basename, dirname, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export default async function enterpriseAfterPack(context) {
  const root = resolve(import.meta.dirname, '..')
  const output = process.env.DSH_ENTERPRISE_PACKAGE_OUTPUT
  const name = process.env.DSH_ENTERPRISE_PACKAGE_WORKSPACE
  if (!output || !['dsh-plugin-desktop-beta', 'dsh-plugin-desktop'].includes(name)) {
    throw new Error('Enterprise packaging context is missing')
  }
  const expectedOutput = resolve(output)
  if (dirname(expectedOutput) !== resolve(root, '.artifacts') ||
    !expectedOutput.startsWith(join(root, '.artifacts', `enterprise-${name}-`)) ||
    dirname(resolve(context.appOutDir)) !== expectedOutput ||
    !/^(?:win(?:-arm64)?-unpacked|mac(?:-arm64|-universal)?)$/u.test(basename(context.appOutDir))) {
    throw new Error('Enterprise packaging output is outside its fresh output directory')
  }
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const sample = join(resources, 'default_app.asar')
  const preserved = join(expectedOutput, `${basename(context.appOutDir)}-electron-default-app.preserved`)
  if (existsSync(sample)) {
    const stat = lstatSync(sample)
    if (!stat.isFile() || stat.isSymbolicLink() || existsSync(preserved)) {
      throw new Error('Refusing to overwrite or move an unexpected Electron sample')
    }
    renameSync(sample, preserved)
  }
  const { afterPack, smokePackagedElectronRuntime } = await import(pathToFileURL(resolve(root, name, 'scripts/verify-packaged-runtime.ts')).href)
  await afterPack(context)
  // Catch unsupported native runtime fingerprints before compressing a large installer.
  smokePackagedElectronRuntime(context)
}
