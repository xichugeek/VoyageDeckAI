import { ChartNoAxesColumnIncreasing, CircleDot, Crosshair, Headset, PackageCheck, PanelsTopLeft, Radio, Video, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { AgentId } from './model'

export const roleIcons = { scout: Crosshair, lister: PanelsTopLeft, creator: Video, ads: ChartNoAxesColumnIncreasing, service: Headset, fulfillment: PackageCheck }
export const tint = (color: string) => ({ '--role': color }) as CSSProperties

export function RoleIcon({ agent, size = 20 }: { agent: AgentId; size?: number }) {
  const Icon = roleIcons[agent]
  return <Icon size={size} strokeWidth={1.65} aria-hidden="true" />
}

export function Logo() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M20 4 35 13v15l-15 8L5 28V13Z" stroke="currentColor" strokeOpacity=".45"/><path d="m11 26 9-15 9 15-9-4z" fill="currentColor"/><path d="M20 25v6M3 20h5m24 0h5" stroke="currentColor" strokeWidth="1.4"/></svg></span>
}

export function Radar() {
  return <svg className="radar-art" viewBox="0 0 710 170" fill="none" aria-hidden="true">
    <defs>
      <pattern id="radar-grid" width="21" height="21" patternUnits="userSpaceOnUse"><path d="M21 0H0V21" stroke="#3b869b" strokeOpacity=".18"/></pattern>
      <radialGradient id="radar-haze"><stop stopColor="#44d5f4" stopOpacity=".22"/><stop offset="1" stopColor="#44d5f4" stopOpacity="0"/></radialGradient>
      <linearGradient id="radar-beam" x1="478" y1="96" x2="537" y2="27" gradientUnits="userSpaceOnUse"><stop stopColor="#48d7e9" stopOpacity=".02"/><stop offset="1" stopColor="#48d7e9" stopOpacity=".23"/></linearGradient>
      <linearGradient id="route-line" x1="101" x2="685" gradientUnits="userSpaceOnUse"><stop stopColor="#2f697f" stopOpacity="0"/><stop offset=".64" stopColor="#74e5f2"/><stop offset="1" stopColor="#3ba2bf" stopOpacity=".12"/></linearGradient>
    </defs>
    <path fill="url(#radar-grid)" d="M0 0h710v170H0z" />
    <ellipse cx="478" cy="90" rx="220" ry="109" fill="url(#radar-haze)" />
    <g stroke="#48b4d2" transform="translate(478 88)">
      {[21, 42, 64, 86, 105, 125].map((r, i) => <circle key={r} r={r} strokeOpacity={i % 2 ? '.34' : '.21'} strokeDasharray={i === 5 ? '2 5' : undefined} />)}
      <ellipse rx="119" ry="31" transform="rotate(-22)" strokeOpacity=".43" />
      <ellipse rx="131" ry="42" transform="rotate(-22)" strokeOpacity=".22" strokeDasharray="4 5" />
      <path d="M-140 0h280M0-125v250m-78-78L78 78m0-156L-78 78" strokeOpacity=".22" strokeDasharray="2 5" />
      <path d="M0 0 29-81a86 86 0 0 1 52 54Z" fill="url(#radar-beam)" strokeOpacity=".35" />
      {Array.from({ length: 48 }, (_, i) => <path key={i} d={i % 4 === 0 ? 'M0-106v7' : 'M0-106v3'} transform={`rotate(${i * 7.5})`} strokeOpacity={i % 4 === 0 ? '.65' : '.32'} />)}
      <path d="m-12 0 12-12 12 12L0 12z" fill="#0e313e" stroke="#72e5f1" />
      <circle r="3" fill="#9bfbff" stroke="none" />
    </g>
    <path d="M85 137h145l39-33h80l28-29h65l36 13 34-34h97l33-29h68" stroke="url(#route-line)" strokeWidth="1.15" />
    <g fill="#66e9f6"><circle cx="378" cy="75" r="3"/><circle cx="512" cy="54" r="3"/><circle cx="593" cy="78" r="2"/><circle cx="440" cy="111" r="2"/><circle cx="642" cy="25" r="2"/></g>
    <g stroke="#52829a" strokeOpacity=".7"><path d="M602 124h75m-44-6v11M337 34h52m-38-6v11"/><circle cx="337" cy="34" r="3"/><circle cx="677" cy="124" r="3"/></g>
    <g fill="#77a8bb" fontFamily="monospace" fontSize="9" letterSpacing="1"><text x="615" y="143">87.42° W</text><text x="331" y="23">39.81° N</text><text x="534" y="43">VD / 01</text></g>
  </svg>
}

export function Dialog({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const trigger = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={ref} className={wide ? 'modal modal-wide' : 'modal'} onCancel={(event) => { event.preventDefault(); close() }} aria-label={title}>
    <header className="modal-heading"><h2>{title}</h2><button className="btn icon-btn" aria-label="关闭" onClick={close}><X size={18} /></button></header>
    <div className="modal-body">{children}</div>
  </dialog>
}

export function PanelTitle({ title, english, live = false }: { title: string; english: string; live?: boolean }) {
  return <div className="panel-title"><h2>{live ? <Radio size={17} /> : <CircleDot size={17} />}{title}</h2><span>{english}</span></div>
}
