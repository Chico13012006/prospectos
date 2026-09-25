// Kanban do Pipeline: mover um lead entre etapas e, opcionalmente, enviar a
// MENSAGEM DA ETAPA de destino (Plano de Execução 24/09, item 5).
//
// Regras PURAS e client-safe (sem I/O) — a rota e a tela usam as mesmas:
//   - quais colunas aceitam lead e em que estágio ele cai;
//   - data e hora obrigatórias ao entrar em Reunião Agendada;
//   - qual template é "a mensagem da etapa": template ATIVO da organização com
//     `tipo` = chave do estágio de destino (ex.: `reuniao_agendada`) e o canal
//     escolhido; a variante do nicho do lead tem prioridade sobre a genérica e,
//     havendo várias, a escolha é estável por lead (mesma regra do motor);
//   - preenchimento pelo MESMO `preencher` do envio real, com as variáveis da
//     reunião ({{data_reuniao}}, {{hora_reuniao}}).
import { indiceVariante, preencher } from '@/lib/engine/mensagem'
import type { Lead } from '@/lib/engine/types'
import { normalizarNicho } from '@/lib/nichos/normalizar'
import { variaveisPendentes } from '@/lib/templates/central'

export const CANAIS_MENSAGEM_ETAPA = ['email', 'whatsapp'] as const
export type CanalMensagemEtapa = (typeof CANAIS_MENSAGEM_ETAPA)[number]

export function ehCanalMensagemEtapa(valor: unknown): valor is CanalMensagemEtapa {
  return valor === 'email' || valor === 'whatsapp'
}

// Coluna do Kanban (COLUNAS_KANBAN) → estágio gravado ao soltar nela. A coluna
// "Respondeu" agrupa interessado/respondeu/com_closer; soltar nela grava
// `respondeu`.
export const ESTAGIO_DESTINO_POR_COLUNA: Readonly<Record<string, string>> = {
  respondeu: 'respondeu',
  reuniao: 'reuniao_agendada',
  ganho: 'ganho',
}

export const ESTAGIOS_DESTINO_KANBAN: readonly string[] = Object.values(ESTAGIO_DESTINO_POR_COLUNA)

export const ESTAGIO_REUNIAO = 'reuniao_agendada'

export function exigeReuniao(estagio: string): boolean {
  return estagio === ESTAGIO_REUNIAO
}

// Variáveis que só existem na mensagem de etapa (além das de sempre).
export const VARIAVEIS_REUNIAO = ['data_reuniao', 'hora_reuniao'] as const

export interface DadosReuniao {
  data: string // AAAA-MM-DD (dia da reunião, no horário local da operação)
  hora: string // HH:MM
}

export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string }

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

// Data e hora de parede (sem fuso): é o que o vendedor combinou com o cliente
// e o que vai escrito na mensagem. Não converte para UTC.
export function validarReuniao(bruto: unknown): Validacao<DadosReuniao> {
  const obj = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {}
  const data = typeof obj.data === 'string' ? obj.data.trim() : ''
  const hora = typeof obj.hora === 'string' ? obj.hora.trim() : ''
  if (!data || !hora) return { ok: false, erro: 'Informe a data e a hora da reunião.' }
  const m = DATA.exec(data)
  if (!m) return { ok: false, erro: 'Data da reunião inválida.' }
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return { ok: false, erro: 'Data da reunião inválida.' }
  }
  if (!HORA.test(hora)) return { ok: false, erro: 'Hora da reunião inválida.' }
  return { ok: true, valor: { data, hora } }
}

export function variaveisDaReuniao(r: DadosReuniao): Record<(typeof VARIAVEIS_REUNIAO)[number], string> {
  const [ano, mes, dia] = r.data.split('-')
  return { data_reuniao: `${dia}/${mes}/${ano}`, hora_reuniao: r.hora }
}

export function descreverReuniao(r: DadosReuniao): string {
  const v = variaveisDaReuniao(r)
  return `${v.data_reuniao} às ${v.hora_reuniao}`
}

export interface TemplateEtapa {
  id: string
  nome: string
  nicho: string | null
  assunto: string | null
  corpo: string
  html: string | null
  created_at: string | null
}

// Recebe os templates ativos do canal e do estágio (já filtrados pela
// organização). Nicho do lead primeiro; sem variante do nicho, a genérica.
export function escolherTemplateEtapa(
  templates: readonly TemplateEtapa[],
  lead: { id: string; segmento?: string | null },
): TemplateEtapa | null {
  const nicho = normalizarNicho(lead.segmento)
  const ordenar = (lista: TemplateEtapa[]) =>
    [...lista].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
  const doNicho = nicho ? ordenar(templates.filter((t) => t.nicho === nicho)) : []
  const candidatos = doNicho.length ? doNicho : ordenar(templates.filter((t) => t.nicho === null))
  if (candidatos.length === 0) return null
  return candidatos[indiceVariante(lead.id, candidatos.length)]
}

export interface MensagemEtapa {
  templateId: string
  templateNome: string
  canal: CanalMensagemEtapa
  assunto: string | null // só e-mail
  texto: string
  // HTML próprio do template (e-mail), já com variáveis; o envio sanitiza.
  html: string | null
  pendentes: string[]
}

export function materializarMensagemEtapa(
  template: TemplateEtapa,
  canal: CanalMensagemEtapa,
  lead: Lead,
  extras: Record<string, string>,
): MensagemEtapa {
  const texto = preencher(template.corpo, lead, extras)
  if (canal === 'whatsapp') {
    return {
      templateId: template.id, templateNome: template.nome, canal,
      assunto: null, texto, html: null,
      pendentes: variaveisPendentes(null, texto),
    }
  }
  const assunto = preencher(template.assunto ?? '', lead, extras)
  const html = template.html?.trim() ? preencher(template.html, lead, extras) : null
  const pendentes = new Set([
    ...variaveisPendentes(assunto, texto),
    ...(html ? variaveisPendentes(null, html, { htmlNoTexto: true }) : []),
  ])
  return { templateId: template.id, templateNome: template.nome, canal, assunto, texto, html, pendentes: [...pendentes] }
}
