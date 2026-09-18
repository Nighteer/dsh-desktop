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
  return <>LETS HERNESS</>
}

/** Replace official brand occupants after all three declared slots become available. */
export function applyLetsBrand(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, LetsBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, LetsBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, LetsBrandMark)
      })))
}
