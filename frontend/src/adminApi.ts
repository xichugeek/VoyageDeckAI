import type { AgentId } from './model'

export type ProviderMode = 'mock' | 'openai_compatible'
export interface Session { enabled: boolean; authenticated: boolean }
export interface ProviderInput {
  mode: ProviderMode
  endpoint: string
  model: string
  timeout_seconds: number
  max_tokens: number
}
export interface Provider extends ProviderInput { key_configured: boolean }
export interface Workflow {
  id: string
  task_id: string
  agent: AgentId
  context: string
  status: 'running' | 'succeeded' | 'failed' | 'interrupted'
  provider_mode: ProviderMode
  data_source: 'mock_simulated' | 'ai_generated_draft'
  created_at: string
  updated_at: string
  output: { id: string; title: string; summary: string; sections: { heading: string; items: string[] }[] } | null
  failure: string | null
  review: { decision: 'approved' | 'rejected'; note: string | null; created_at: string } | null
}

export interface WorkflowEvent { seq: number; kind: string; message: string; created_at: string }

export class AdminRequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: {
        ...(method !== 'GET' && { 'X-VoyageDeck-Request': 'cockpit' }),
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
    })
  } catch {
    if (signal?.aborted) throw signal.reason
    throw new AdminRequestError(0, '无法连接管理 API，请检查本地服务。')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload) {
    const detail = payload?.detail
    throw new AdminRequestError(response.status, typeof detail === 'string' ? detail : `管理 API 请求失败（HTTP ${response.status}）`)
  }
  return payload as T
}

export const adminApi = {
  session: (signal?: AbortSignal) => request<Session>('/admin/session', 'GET', undefined, signal),
  login: (password: string) => request<Session>('/admin/session', 'POST', { password }),
  logout: () => request<Session>('/admin/session', 'DELETE'),
  provider: (signal?: AbortSignal) => request<Provider>('/settings/provider', 'GET', undefined, signal),
  saveProvider: (provider: ProviderInput) => request<Provider>('/settings/provider', 'PUT', provider),
  workflows: (signal?: AbortSignal) => request<{ workflows: Workflow[] }>('/workflows', 'GET', undefined, signal),
  workflow: (id: string) => request<Workflow>(`/workflows/${encodeURIComponent(id)}`),
  events: (id: string) => request<{ events: WorkflowEvent[]; after: number }>(`/workflows/${encodeURIComponent(id)}/events`),
  inference: (agent: AgentId, context: string, request_id: string) => request<Workflow>('/admin/inferences', 'POST', { agent, context, request_id }),
  review: (id: string, decision: 'approved' | 'rejected', note: string) => request<Workflow>(`/workflows/${encodeURIComponent(id)}/approve`, 'POST', { decision, note }),
}
