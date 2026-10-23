/** Desktop projection over Harness 0.2's profile-backed configuration forms. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'

export function readConfigForm<T>(ctx: Context, namespace: string): T | undefined {
  return ctx.get('settings')?.describe().find(row => row.ns === namespace)?.value as T | undefined
}

export function watchConfigForms(ctx: Context, listener: (namespace: string, value: unknown) => void): () => void {
  let active=true
  const pending=new Set<string>()
  const stop=ctx.on('settings/document-updated', namespace => {
    if(pending.has(namespace))return
    pending.add(namespace)
    queueMicrotask(()=>{
      pending.delete(namespace)
      if(!active)return
      const value=readConfigForm(ctx,namespace)
      if(value!==undefined)listener(namespace,value)
    })
  })
  const dispose=()=>{active=false;pending.clear();stop()}
  ctx.effect(()=>dispose,'desktop config form observation')
  return dispose
}

export function desktopConfigScope<T extends object>(ctx: Context, namespace: string, initial: T, validate?: (value: T) => void) {
  return {
    get: (): T => readConfigForm<T>(ctx, namespace) ?? initial,
    watch: (listener: (value: T) => void): (() => void) => watchConfigForms(ctx, (ns, value) => {
      if (ns === namespace && value !== undefined) listener(value as T)
    }),
    update: async (patch: Partial<T>): Promise<void> => {
      validate?.({ ...(readConfigForm<T>(ctx, namespace) ?? initial), ...patch })
      await ctx.settings.update(namespace, patch)
    },
  }
}
