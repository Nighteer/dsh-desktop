import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  prepareMacUniversalRuntime,
} from '../scripts/mac-universal.ts'

describe('universal macOS native runtime preparation', () => {
  it('preserves thin Office interpreters and hidden NumPy libraries in both slices', () => {
    const require = createRequire(import.meta.url)
    const universalRequire = createRequire(require.resolve('@electron/universal'))
    const { minimatch } = universalRequire('minimatch')
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      build: { mac: { x64ArchFiles: string } }
    }
    const matches = (path: string): boolean => minimatch(path, manifest.build.mac.x64ArchFiles, { matchBase: true })
    const root = 'Contents/Resources/official-office/snapshot/primary-runtime/dependencies/python'
    expect(matches(`${root}/bin/python3.12`)).toBe(true)
    expect(matches(`${root}/lib/python3.12/site-packages/numpy/.dylibs/libscipy_openblas64_.dylib`)).toBe(true)
    for (const arch of ['x64', 'arm64']) {
      expect(matches(`Contents/Resources/app/node_modules/@deepseek-ai/libreoffice-kit-darwin-${arch}/native.dylib`)).toBe(true)
      expect(matches(`Contents/Resources/app/node_modules/sherpa-onnx-darwin-${arch}/sherpa-onnx.node`)).toBe(true)
      expect(matches(`Contents/Resources/app/node_modules/@esbuild/darwin-${arch}/bin/esbuild`)).toBe(true)
    }
    expect(matches('Contents/Resources/unrelated/native.dylib')).toBe(false)
  })

  it.skipIf(process.platform !== 'darwin')('tracks the installed Sharp and libvips files for both CPUs', () => {
    const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
    for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => entry.path.startsWith('node_modules/@img/'))) {
      const path = join(desktopRoot, entry.path)
      expect(existsSync(path), `missing installed native file: ${path}`).toBe(true)
    }
  })

  // fs-ext is the only universal entry whose filename moves with the Electron ABI. Spelling
  // that number out made this spec the last thing standing between an ABI bump and a green
  // `check` job, and it lost: bumping Electron turned a previously green job red instead of
  // catching the drift. Derive the number so the assertion survives the next bump.
  it('tracks the fs-ext binding for both CPU architectures at the installed Electron ABI', () => {
    const abi = readFileSync(
      fileURLToPath(new URL('../node_modules/electron/abi_version', import.meta.url)),
      'utf8',
    ).trim()
    expect(abi).toMatch(/^\d+$/)

    expect(MACOS_UNIVERSAL_NATIVE_ENTRIES).toEqual(expect.arrayContaining([
      {
        arch: 'arm64',
        path: `node_modules/fs-ext/prebuilds/darwin-arm64/electron.abi${abi}.node`,
      },
      {
        arch: 'x86_64',
        path: `node_modules/fs-ext/prebuilds/darwin-x64/electron.abi${abi}.node`,
      },
    ]))
  })

  it('requires every CPU-specific file and repairs both node-pty helpers', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')

    prepareMacUniversalRuntime({ desktopRoot, exists: () => true, chmod })

    expect(chmod.mock.calls).toEqual([
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755],
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'), 0o755],
    ])
  })

  it('fails before changing permissions when one architecture is incomplete', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')
    const missing = MACOS_UNIVERSAL_NATIVE_ENTRIES.at(-1)!.path

    expect(() => prepareMacUniversalRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod,
    })).toThrow(join(desktopRoot, missing))
    expect(chmod).not.toHaveBeenCalled()
  })
})
