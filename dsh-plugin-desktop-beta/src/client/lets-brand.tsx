/** LETS Desktop replacements for the upstream browser-brand occupants. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps,
  SidebarBrandNameOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { LETS_BRAND_IMAGE_DATA_URL } from './lets-brand-data.ts'

/** UI services needed to register browser-brand slot occupants. */
export const LETS_BRAND_INJECT = ['slots']

/** Visible LETS product wordmark shared by every browser surface. */
export const LETS_BRAND_NAME = 'LETS HARNESS'
export const LETS_HERO_HEADLINE = '垒墨知行，共创未来'

type LetsBrandMarkProps = SidebarBrandMarkOwnerProps & Pick<HeroBrandMarkOwnerProps, 'className'>

/** Render the supplied corporate mark at the dimensions requested by its host surface. */
export function LetsBrandMark({ className, size }: LetsBrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      src={LETS_BRAND_IMAGE_DATA_URL}
      style={{ display: 'block', height: size, objectFit: 'contain', width: size }}
      width={size}
    />
  )
}

/** Render the company wordmark beside the Desktop sidebar icon. */
export function LetsBrandName(_props: SidebarBrandNameOwnerProps) {
  return <>{LETS_BRAND_NAME}</>
}

/** Own the Desktop greeting beside its brand mark without changing upstream copy. */
export function LetsHeroBrand(props: HeroBrandMarkOwnerProps) {
  return <><style>{`
    .lets-hero-brand{display:inline-flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;max-width:100%}
    .lets-hero-brand>img{flex:none}
    .lets-hero-headline{font:inherit;text-align:center;overflow-wrap:anywhere}
    span:has(>[data-slot="conversation.hero.brand.mark"] .lets-hero-brand){min-width:0;max-width:100%;flex-shrink:1}
    span:has(>[data-slot="conversation.hero.brand.mark"] .lets-hero-brand)+span{display:none}
  `}</style><span className="lets-hero-brand"><LetsBrandMark {...props}/><span className="lets-hero-headline">{LETS_HERO_HEADLINE}</span></span></>
}

/** Replace official brand occupants after all three declared slots become available. */
export function applyLetsBrand(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, LetsBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, LetsBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, LetsHeroBrand)
      })))
}
