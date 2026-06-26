'use client'

import { Mail, Phone, ExternalLink, Globe, MapPin, User, Clock, MessageSquare } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import { prioridadeFromScore, prioridadeClasses, diasDesde, rotuloDias } from './prioridade'

// Card compacto do Kanban. Mostra SÓ o que existe — campo vazio não aparece
// (sem traço nem vírgula solta). Fica enxuto quando faltam dados e rico quando
// estão preenchidos.
export default function LeadCardCompact({
  lead,
  respostaPendente,
  selected,
  onClick,
}: {
  lead: Lead
  respostaPendente?: boolean
  selected?: boolean
  onClick: () => void
}) {
  const cidadeEstado = [lead.cidade, lead.estado].filter(Boolean).join(', ')
  const prioridade = prioridadeFromScore(lead.score)
  const responsavel = lead.usuarios?.nome
  const ultima = rotuloDias(diasDesde(lead.ultimo_contato))

  const linkedinHref = lead.linkedin
    ? (lead.linkedin.startsWith('http') ? lead.linkedin : `https://${lead.linkedin}`)
    : null
  const siteHref = lead.site ? (lead.site.startsWith('http') ? lead.site : `https://${lead.site}`) : null

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="pb-2">
      <div
        onClick={onClick}
        className={`rounded-lg border bg-[#1a1f2e] px-3 py-2.5 cursor-pointer transition-colors ${
          selected
            ? 'border-indigo-500/70'
            : respostaPendente
              ? 'border-green-500/50 hover:border-green-500/70'
              : 'border-[#2a3147] hover:border-indigo-500/40'
        }`}
      >
        {respostaPendente && (
          <div className="flex items-center gap-1 mb-1.5 text-[11px] font-semibold text-green-400">
            <MessageSquare size={11} /> Resposta a tratar
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          </div>
        )}

        <div className="font-medium text-sm text-slate-100 leading-tight truncate">{lead.empresa}</div>

        {cidadeEstado && (
          <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
            <MapPin size={11} className="shrink-0" /> <span className="truncate">{cidadeEstado}</span>
          </div>
        )}

        {(lead.segmento || prioridade) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {lead.segmento && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#252b3b] text-slate-300">
                {lead.segmento}
              </span>
            )}
            {prioridade && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${prioridadeClasses[prioridade]}`}>
                {prioridade}
              </span>
            )}
          </div>
        )}

        {(responsavel || ultima || linkedinHref || siteHref || lead.contato_email || lead.contato_telefone) && (
          <div className="mt-2 flex items-center gap-2 text-slate-500">
            {responsavel && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400 truncate min-w-0">
                <User size={11} className="shrink-0" /> <span className="truncate">{responsavel}</span>
              </span>
            )}
            {ultima && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
                <Clock size={11} /> {ultima}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5 shrink-0">
              {lead.contato_email && (
                <a href={`mailto:${lead.contato_email}`} onClick={stop} title={lead.contato_email} className="hover:text-blue-400">
                  <Mail size={13} />
                </a>
              )}
              {lead.contato_telefone && (
                <a href={`tel:${lead.contato_telefone}`} onClick={stop} title={lead.contato_telefone} className="hover:text-green-400">
                  <Phone size={13} />
                </a>
              )}
              {linkedinHref && (
                <a href={linkedinHref} target="_blank" rel="noopener noreferrer" onClick={stop} title="LinkedIn" className="hover:text-blue-400">
                  <ExternalLink size={13} />
                </a>
              )}
              {siteHref && (
                <a href={siteHref} target="_blank" rel="noopener noreferrer" onClick={stop} title="Site" className="hover:text-indigo-400">
                  <Globe size={13} />
                </a>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
