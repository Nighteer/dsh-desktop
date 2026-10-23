import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopDialogToneIcon,
  DesktopProductDialogBrand,
  DesktopDialogApp,
  desktopDialogAdvisoryLines,
  desktopDialogButtonClassName,
  desktopDialogShowsToneIcon,
} from '../src/native-ui/desktop-dialog/App.tsx'

describe('Desktop dialog native UI', () => {
  it('shares compact LETS branding and readable details between About and updates', () => {
    const brand = renderToStaticMarkup(createElement(DesktopProductDialogBrand))
    expect(brand).toContain('LETS Desktop')
    expect(brand).toContain('<img')
    for (const message of ['关于 LETS', '上游 DSH Desktop 2.0.18-beta.1 已可用']) {
      const state = Buffer.from(JSON.stringify({
        type: 'info', title: message, message, detail: '当前版本：2.0.12-beta.1',
        buttons: ['确定'], defaultId: 0, cancelId: 0, presentation: 'product-info',
      })).toString('base64url')
      vi.stubGlobal('window', { location: { search: `?state=${state}&frame=false` } })
      try {
        const html = renderToStaticMarkup(createElement(DesktopDialogApp))
        expect(html).toContain('LETS Desktop')
        expect(html).toContain(message)
        expect(html).toContain('当前版本：2.0.12-beta.1')
        expect(html).not.toContain('h-28')
        expect(desktopDialogShowsToneIcon('product-info')).toBe(false)
      } finally { vi.unstubAllGlobals() }
    }
  })

  it('omits the leading tone icon for the centered Profile compatibility surface', () => {
    expect(desktopDialogShowsToneIcon('profile-compatibility')).toBe(false)
    expect(desktopDialogShowsToneIcon('default')).toBe(true)
    expect(desktopDialogButtonClassName('profile-compatibility', 0)).toBe('mr-auto')
    expect(desktopDialogButtonClassName('profile-compatibility', 1)).toBeUndefined()
    expect(renderToStaticMarkup(createElement(DesktopDialogToneIcon, {
      type: 'warning',
    }))).toContain('<svg')
  })

  it('renders each compatibility advisory line as its own block', () => {
    expect(desktopDialogAdvisoryLines('Summary:\n1. First\n2. Second\nRecommendation')).toEqual([
      'Summary:',
      '1. First',
      '2. Second',
      'Recommendation',
    ])
  })

  it('uses the shared ScrollArea for long default dialog details', () => {
    const source = readFileSync(new URL('../src/native-ui/desktop-dialog/App.tsx', import.meta.url), 'utf8')
    expect(source).toContain('<ScrollArea className="mt-2 h-28 pr-3">')
    expect(source).not.toContain('max-h-28 overflow-auto')
  })

  it('tones the advisory for both color schemes', () => {
    const source = readFileSync(new URL('../src/native-ui/desktop-dialog/App.tsx', import.meta.url), 'utf8')
    // A bare `text-amber-100` is near white and disappears on the light-mode amber panel.
    expect(source).toContain('text-amber-900 dark:text-amber-100')
  })

})
