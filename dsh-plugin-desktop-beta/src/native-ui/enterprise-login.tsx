import React from 'react'
import { createRoot } from 'react-dom/client'
import 'dsh-enterprise-admin/style'
import 'dsh-enterprise-admin/admin-style'
import './enterprise-login.css'
import type { EnterpriseLoginBridge } from '../enterprise-login-contract.ts'
import {EnterpriseLoginApp} from './enterprise-login-view.tsx'
declare global { interface Window { letsEnterpriseLogin: EnterpriseLoginBridge } }
createRoot(document.getElementById('root')!).render(<React.StrictMode><EnterpriseLoginApp bridge={window.letsEnterpriseLogin}/></React.StrictMode>)
