/** Enterprise first login uses prepared defaults without opening a setup window. */
import type {
  DesktopSetupWizardInput,
  DesktopSetupWizardResult,
} from './setup-wizard-contract.ts'

export async function resolveDesktopInitialSetup(
  input: DesktopSetupWizardInput,
  enterprise: boolean,
  showWizard: (input: DesktopSetupWizardInput) => Promise<DesktopSetupWizardResult>,
): Promise<DesktopSetupWizardResult> {
  if (!enterprise) return showWizard(input)
  return {
    action: 'complete',
    selection: {
      mode: input.mode,
      macosMaterial: input.macosMaterial,
      windowsMaterial: input.windowsMaterial,
      openBrowser: input.openBrowser,
      networkExposure: input.networkExposure,
      notifications: { ...input.notifications },
      market: input.market,
      aaEnabled: input.aaEnabled ?? false,
    },
  }
}
