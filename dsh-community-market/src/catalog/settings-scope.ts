/** Small source-store port over the native profile Config forms. */
export interface SettingsScope<T> {
  get(): T
  update(patch: Partial<T>): Promise<void>
}
