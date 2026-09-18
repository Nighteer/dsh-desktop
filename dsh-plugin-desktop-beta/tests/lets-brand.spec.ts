// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  applyLetsBrand,
  LETS_BRAND_INJECT,
  LetsBrandMark,
  LetsBrandName,
} from '../src/client/lets-brand.tsx'

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

/** Minimal slot-runtime harness exercising the Desktop plugin's public slot boundary. */
class SlotBench {
  private readonly injectors = new Map<string, (() => unknown)[]>()
  private readonly declared = new Set<string>()
  private readonly registered = new Map<string, { readonly options: { readonly priority?: number } }[]>()

  declare(name: string): void {
    this.declared.add(name)
    const pending = this.injectors.get(name) ?? []
    this.injectors.delete(name)
    for (const injector of pending) this.run(injector)
  }

  entries(name: string) {
    return this.registered.get(name) ?? []
  }

  inject(name: string, injector: () => unknown): void {
    if (this.declared.has(name)) {
      this.run(injector)
      return
    }
    const pending = this.injectors.get(name) ?? []
    pending.push(injector)
    this.injectors.set(name, pending)
  }

  register(options: { readonly name: string; readonly priority?: number }): () => void {
    const entries = this.registered.get(options.name) ?? []
    const entry = { options }
    entries.push(entry)
    this.registered.set(options.name, entries)
    return () => { this.registered.set(options.name, entries.filter(candidate => candidate !== entry)) }
  }

  private run(injector: () => unknown): void {
    const result = injector()
    if (typeof (result as Iterable<unknown> | undefined)?.[Symbol.iterator] === 'function') {
      for (const _effect of result as Iterable<unknown>) { /* register effects are already applied. */ }
    }
  }
}

describe('LETS Desktop browser brand', () => {
  it('renders the supplied company mark at the host-requested size and names the product LETS HERNESS', () => {
    const mark = renderToStaticMarkup(createElement(LetsBrandMark, { className: 'hero-mark', size: 34 }))
    expect(mark).toContain('src="data:image/png;base64,')
    expect(mark).toContain('width="34"')
    expect(mark).toContain('height="34"')
    expect(mark).toContain('class="hero-mark"')
    expect(renderToStaticMarkup(createElement(LetsBrandName, {}))).toBe('LETS HERNESS')
  })

  it('shadows the upstream whale in both sidebar positions and the blank-session hero', () => {
    expect(LETS_BRAND_INJECT).toEqual(['slots'])
    const slots = new SlotBench()
    for (const hole of HOLES) slots.declare(hole)
    applyLetsBrand({ slots } as never)
    for (const hole of HOLES) {
      expect(slots.entries(hole)).toHaveLength(1)
      expect(slots.entries(hole)[0]?.options.priority).toBe(-100)
    }
  })

  it('waits for every slot declaration instead of leaving a partial brand', () => {
    const slots = new SlotBench()
    applyLetsBrand({ slots } as never)
    slots.declare(HOLES[0])
    for (const hole of HOLES) expect(slots.entries(hole)).toHaveLength(0)
    slots.declare(HOLES[1])
    for (const hole of HOLES) expect(slots.entries(hole)).toHaveLength(0)
    slots.declare(HOLES[2])
    for (const hole of HOLES) expect(slots.entries(hole)).toHaveLength(1)
  })
})
