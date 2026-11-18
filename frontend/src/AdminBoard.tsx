import { ArrowDownToLine, ChevronRight, Clipboard, Cpu, Gauge, History, KeyRound, LogOut, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AdminRequestError, adminApi } from './adminApi'
import type { Provider, Session, Workflow, WorkflowEvent } from './adminApi'
import { agents, localTime } from './model'
import type { AgentId } from './model'
import './admin.css'

const stateName = { running: '推理中', succeeded: '草稿就绪', failed: '失败', interrupted: '运行中断' }
const sourceName = { mock_simulated: 'Mock 模拟草稿', ai_generated_draft: '模型生成草稿' }
const roleNames = new Map(agents.map(item => [item.id, item.name]))

function sourceLabel(workflow: Workflow) {
  if (workflow.provider_mode === 'openai_compatible' && !workflow.output) return '真实文本推理请求'
  return sourceName[workflow.data_source]
}

function textOf(error: unknown) {
  return error instanceof Error ? error.message : '管理 API 请求失败。'
}

function AdminLogin({ login, busy }: { login: (password: string) => Promise<void>; busy: boolean }) {
  return <form className="admin-login" onSubmit={event => {
    event.preventDefault()
    const form = event.currentTarget
    const password = String(new FormData(form).get('password'))
    form.reset()
    void login(password)
  }}>
    <p>登录后可配置文本模型、审阅和查询持久化草稿。访客演示保持在当前隔离会话中。</p>
    <div className="form-grid"><label>管理员密码<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label></div>
    <button className="btn btn-primary" type="submit" disabled={busy}><KeyRound size={16} /> 登录</button>
  </form>
}

function ProviderForm({ provider, disabled, save }: { provider: Provider; disabled: boolean; save: (input: Omit<Provider, 'key_configured'>) => Promise<void> }) {
  const [mode, setMode] = useState(provider.mode)
  const isReal = mode === 'openai_compatible'
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    void save({
      mode, endpoint: String(values.get('endpoint')).trim(), model: String(values.get('model')).trim(),
      timeout_seconds: Number(values.get('timeout_seconds')), max_tokens: Number(values.get('max_tokens')),
    })
  }
  return <details className="admin-panel admin-provider">
    <summary><Cpu size={16} /> 模型配置 <span>{provider.mode === 'mock' ? 'Mock' : 'OpenAI-compatible'}</span><ChevronRight size={15} /></summary>
    <form className="admin-form" onSubmit={submit}>
      <p>API Key 由服务端环境变量提供。当前状态为<strong> {provider.key_configured ? '已设置' : '未设置'}</strong>。</p>
      <div className="form-grid"><label>Provider 模式<select value={mode} onChange={event => setMode(event.target.value as Provider['mode'])}><option value="mock">Mock · 固定模拟结果</option><option value="openai_compatible">OpenAI-compatible · 真实文本推理</option></select></label>
        <label>模型<input name="model" defaultValue={provider.model} maxLength={120} required /></label>
        <label className="admin-spanning">HTTPS API 基址<input type="url" name="endpoint" defaultValue={provider.endpoint} maxLength={300} placeholder="https://provider.example/v1" required={isReal} /></label>
        <label>超时（秒）<input name="timeout_seconds" type="number" min="2" max="45" defaultValue={provider.timeout_seconds} required /></label>
        <label>输出 token 上限<input name="max_tokens" type="number" min="150" max="2400" defaultValue={provider.max_tokens} required /></label></div>
      <button type="submit" className="btn" disabled={disabled}>保存模型设置</button>
    </form>
  </details>
}

function InferenceForm({ provider, disabled, infer }: { provider: Provider; disabled: boolean; infer: (agent: AgentId, context: string) => Promise<void> }) {
  const isReal = provider.mode === 'openai_compatible'
  return <section className="admin-panel" aria-label="文本推理"><h3><Gauge size={16} /> 文本推理</h3>
    <form className="admin-form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void infer(data.get('agent') as AgentId, String(data.get('context')).trim())
    }}>
      <div className="form-grid"><label>岗位<select name="agent">{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.label}</option>)}</select></label>
        <label className="admin-spanning">任务上下文<textarea name="context" placeholder="输入虚构商品、模拟市场和文案要求。" rows={4} minLength={3} maxLength={2400} required /></label></div>
      {isReal && <label className="admin-confirm"><input type="checkbox" required /> 同意将上下文发送给已配置的 Provider。本次调用可能产生费用。</label>}
      <div className="admin-actions"><button type="submit" className="btn btn-primary" disabled={disabled}><Cpu size={16} /> 生成文本草稿</button><span>{isReal ? '真实文本推理' : 'Mock · 固定模拟结果'}</span></div>
    </form>
  </section>
}

function WorkflowDetail({ workflow, events, busy, review }: { workflow: Workflow; events: WorkflowEvent[]; busy: boolean; review: (id: string, decision: 'approved' | 'rejected', note: string) => Promise<void> }) {
  const [copied, setCopied] = useState('')
  return <section className="admin-panel admin-result" aria-label="持久化任务详情">
    <h3><ArrowDownToLine size={16} /> {roleNames.get(workflow.agent)} · 任务详情 <span data-state={workflow.status}>{stateName[workflow.status]}</span></h3>
    <div className="admin-form">
      <p>{sourceLabel(workflow)} · {new Date(workflow.created_at).toLocaleString('zh-CN')}</p>
      <details className="admin-context"><summary>输入上下文</summary><p>{workflow.context}</p></details>
      {workflow.failure && <p className="admin-error" role="alert">{workflow.failure}</p>}
      {workflow.output && <article className="admin-output">
        <h4>{workflow.output.title}</h4><p>{workflow.output.summary}</p>
        {workflow.output.sections.map((section, index) => <div key={index}><h5>{section.heading}</h5><ul>{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}
        <div className="admin-actions"><button className="btn" onClick={async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(workflow.output, null, 2)); setCopied('已复制') } catch { setCopied('复制失败，可直接选择文本') }
        }}><Clipboard size={15} /> 复制文本草稿</button><span role="status">{copied}</span></div>
      </article>}
      {workflow.review ? <p className="admin-review-record">{workflow.review.decision === 'approved' ? '审批记录 · 已批准' : '审批记录 · 已驳回'} · {localTime(workflow.review.created_at)}{workflow.review.note && ` · ${workflow.review.note}`}</p> : workflow.status === 'succeeded' && <form className="admin-review" onSubmit={event => {
        event.preventDefault()
        const note = String(new FormData(event.currentTarget).get('note')).trim()
        const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')
        if (decision === 'approved' || decision === 'rejected') void review(workflow.id, decision, note)
      }}><div className="form-grid"><label className="admin-spanning">审核备注<input name="note" maxLength={480} /></label></div><div className="admin-actions"><button className="btn btn-primary" type="submit" value="approved" disabled={busy}>批准草稿</button><button className="btn btn-danger" type="submit" value="rejected" disabled={busy}>驳回草稿</button></div></form>}
      {!!events.length && <details className="admin-context"><summary>后台事件记录</summary><ol>{events.map(event => <li key={event.seq}><time>{localTime(event.created_at)}</time> {event.message}</li>)}</ol></details>}
    </div>
  </section>
}

export function AdminBoard() {
  const [session, setSession] = useState<Session>()
  const [provider, setProvider] = useState<Provider>()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selected, setSelected] = useState<Workflow>()
  const [events, setEvents] = useState<WorkflowEvent[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const pending = useRef<{ agent: AgentId; context: string; id: string } | null>(null)

  const reportError = useCallback((error: unknown) => {
    if (error instanceof AdminRequestError && error.status === 401) {
      setSession(current => current && { ...current, authenticated: false })
      setProvider(undefined); setWorkflows([]); setSelected(undefined); setEvents([])
    }
    setError(textOf(error))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void adminApi.session(controller.signal).then(setSession, error => {
      if (!controller.signal.aborted) setError(textOf(error))
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!session?.authenticated) return
    const controller = new AbortController()
    void Promise.all([adminApi.provider(controller.signal), adminApi.workflows(controller.signal)]).then(([configuration, history]) => {
      setProvider(configuration)
      setWorkflows(history.workflows)
    }, error => { if (!controller.signal.aborted) reportError(error) })
    return () => controller.abort()
  }, [session?.authenticated, reportError])

  async function execute(label: string, operation: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setError(''); setNotice(''); setBusy(label)
    try { await operation() } catch (error) { reportError(error) } finally { setBusy(''); lock.current = false }
  }

  async function select(workflow: Workflow) {
    setSelected(workflow)
    setEvents([])
    setWorkflows(items => [workflow, ...items.filter(item => item.id !== workflow.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    const records = await adminApi.events(workflow.id)
    setEvents(records.events)
  }

  async function infer(agent: AgentId, context: string) {
    await execute('正在生成文本草稿…', async () => {
      if (context.length < 3) throw new Error('请输入至少 3 个字符的任务上下文。')
      const previous = pending.current
      const id = previous && previous.agent === agent && previous.context === context ? previous.id : crypto.randomUUID()
      pending.current = { agent, context, id }
      const workflow = await adminApi.inference(agent, context, id)
      pending.current = null
      await select(workflow)
    })
  }

  return <div className="admin-board">
    {!session && !error && <p role="status">正在连接管理 API…</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    {session && !session.enabled && <p>管理后台尚未启用。配置服务端管理员密码散列并重启应用后，可在此登录。</p>}
    {session?.enabled && !session.authenticated && <AdminLogin busy={!!busy} login={password => execute('正在验证…', async () => setSession(await adminApi.login(password)))} />}
    {session?.authenticated && <>
      <div className="admin-toolbar"><p><span className="online-dot" /> 管理员会话 · {provider?.mode === 'openai_compatible' ? '真实文本推理' : 'Mock 模式'}</p><button className="btn" disabled={!!busy} onClick={() => execute('正在退出…', async () => {
        setSession(await adminApi.logout()); setProvider(undefined); setSelected(undefined); setEvents([]); setWorkflows([]); pending.current = null
      })}><LogOut size={15} /> 退出管理</button></div>
      {provider && <>
        <ProviderForm provider={provider} disabled={!!busy} save={configuration => execute('正在保存…', async () => {
          setProvider(await adminApi.saveProvider(configuration)); setNotice('模型设置已保存。')
        })} />
        <InferenceForm provider={provider} disabled={!!busy} infer={infer} />
      </>}
      <section className="admin-panel" aria-label="持久化任务"><h3><History size={16} /> 持久化任务 <button className="btn icon-btn" aria-label="刷新持久化任务" title="刷新持久化任务" disabled={!!busy} onClick={() => execute('正在读取…', async () => setWorkflows((await adminApi.workflows()).workflows))}><RefreshCw size={14} /></button></h3>
        {workflows.length ? <ol className="admin-history">{workflows.map(workflow => <li key={workflow.id}>
          <button className="btn" aria-pressed={selected?.id === workflow.id} disabled={!!busy} onClick={() => execute('正在读取…', async () => select(await adminApi.workflow(workflow.id)))}><span><strong>{roleNames.get(workflow.agent)}</strong><small>{workflow.id.slice(0, 8)} · {sourceLabel(workflow)}</small></span><span>{stateName[workflow.status]}</span><ChevronRight size={15} /></button>
        </li>)}</ol> : <p className="admin-form">等待首份文本草稿。</p>}
      </section>
      {selected && <WorkflowDetail key={selected.id} workflow={selected} events={events} busy={!!busy} review={(id, decision, note) => execute('正在记录审批…', async () => select(await adminApi.review(id, decision, note)))} />}
    </>}
    {(busy || notice) && <p className="admin-notice" role="status">{busy || notice}</p>}
  </div>
}
