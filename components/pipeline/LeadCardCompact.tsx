'use client'

import { Mail, Phone, ExternalLink, Globe, MapPin, User, Clock, MessageSquare } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import { prioridadeFromScore, prioridadeClasses, diasDesde, rotuloDias } from './prioridade'

// Card compacto do Kanban. Mostra em TEXTO o que existe — empresa, contato e
// e-mail aparecem como texto (não só ícones). Campo vazio é omitido, sem traço
// nem vírgula solta. Fica cheio com o que há e mais rico quando há mais dados.
// Chip de status usado na visão Cadência (no comercial não é passado).
export type StatusChip = { label: string; classes: string }

export default function LeadCardCompact({
  lead,
  respostaPendente,
  statusChip,
  selected,
  onClick,
}: {
  lead: Lead
  respostaPendente?: boolean
  statusChip?: StatusChip
  selected?: boolean
  onClick: () => void
}) {
  const cidadeEstado = [lead.cidade, lead.estado].filter(Boolean).join(', ')
  const prioridade = prioridadeFromScore(lead.score)
  const responsavel = lead.usuarios?.nome ?? lead.responsavel_nome ?? null
  const ultima = rotuloDias(diasDesde(lead.ultimo_contato))

  const linkedinHref = lead.linkedin
    ? (lead.linkedin.startsWith('http') ? lead.linkedin : `https://${lead.linkedin}`)
    : null
  const siteHref = lead.site ? (lead.site.startsWith('http') ? lead.site : `https://${lead.site}`) : null

  // meta secundária (só o que existe)
  const meta: string[] = []
  if (cidadeEstado) meta.push(cidadeEstado)
  if (lead.segmento) meta.push(lead.segmento)

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

        {/* Empresa (destaque) + prioridade (só quando relevante) */}
        <div className="flex items-start gap-2">
          <div className="font-semibold text-sm text-slate-100 leading-tight truncate flex-1">{lead.empresa}</div>
          {prioridade && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${prioridadeClasses[prioridade]}`}>
              {prioridade}
            </span>
          )}
        </div>

        {/* Nome do contato (texto) */}
        {lead.contato_nome && (
          <div className="mt-0.5 text-xs text-slate-300 truncate">{lead.contato_nome}</div>
        )}

        {/* E-mail (texto, clicável) */}
        {lead.contato_email && (
          <a
            href={`mailto:${lead.contato_email}`}
            onClick={stop}
            className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 truncate"
            title={lead.contato_email}
          >
            <Mail size={11} className="shrink-0" />
            <span className="truncate">{lead.contato_email}</span>
          </a>
        )}

        {/* Cidade / segmento */}
        {meta.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
            <MapPin size={11} className="shrink-0" />
            <span className="truncate">{meta.join(' · ')}</span>
          </div>
        )}

        {/* Responsável */}
        {responsavel && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 truncate">
            <User size={11} className="shrink-0" />
            <span className="truncate">{responsavel}</span>
          </div>
        )}

        {/* Chip de status (visão Cadência) */}
        {statusChip && (
          <div className="mt-1.5">
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusChip.classes}`}>
              {statusChip.label}
            </span>
          </div>
        )}

        {/* Rodapé: "há Xd" + ações rápidas */}
        {(ultima || lead.contato_telefone || linkedinHref || siteHref) && (
          <div className="mt-2 flex items-center gap-2 text-slate-500">
            {ultima && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <Clock size={11} /> {ultima}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5 shrink-0">
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
