export const ENTERPRISE_LOGIN_CHANNEL = 'lets:enterprise-login'
export interface EnterpriseLoginState {
  mustChangePassword: boolean; allowRemember: boolean; message: string
  phase?: 'connection' | 'login'; origin?: string; instanceId?: string
  instanceChange?: { previous: string; next: string }
}
export type EnterpriseLoginAction =
  | { action: 'state' }
  | { action: 'connect'; origin: string }
  | { action: 'confirm-service' | 'change-service' | 'cancel-service-change' }
  | { action: 'login'; username: string; password: string; remember: boolean }
  | { action: 'password'; currentPassword: string; password: string }
export interface EnterpriseLoginReply { ok: boolean; state?: EnterpriseLoginState; error?: string }
export interface EnterpriseLoginBridge { invoke(action: EnterpriseLoginAction): Promise<EnterpriseLoginReply> }
