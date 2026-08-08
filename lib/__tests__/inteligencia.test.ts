import { describe, it, expect } from 'vitest'
import {
  filtrarLeads, calcularKpis, evolucao, performancePorCanal,
  respostasPorFollowup, topLeadsPorResposta, opcoesFiltro,
  type LeadIC, type InteracaoIC, FILTROS_IC_PADRAO,
} from '../inteligencia'

function lead(over: Partial<LeadIC> = {}): LeadIC {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    empresa: over.empresa ?? 'Acme',
    estagio: over.estagio ?? 'primeiro_contato',
    score: over.score ?? 50,
    canal_preferencial: over.canal_preferencial ?? 'email',
    segmento: over.segmento ?? null,
    estado: over.estado ?? null,
    created_at: over.created_at ?? new Date().toISOString(),
    ultimo_contato: over.ultimo_contato ?? null,
    responsavel_nome: over.responsavel_nome ?? 'Francisco',
    followups_enviados: over.followups_enviados ?? 0,
  }
}

describe('inteligencia — KPIs', () => {
  it('conta prospectados, responderam, reuniões, follow-ups e conversão (ganho)', () => {
    const leads = [
      lead({ estagio: 'novos_leads' }), // não prospectado
      lead({ estagio: 'primeiro_contato', followups_enviados: 2 }),
      lead({ estagio: 'interessado', followups_enviados: 1 }), // respondeu
      lead({ estagio: 'reuniao_agendada', followups_enviados: 3 }), // respondeu + reunião
      lead({ estagio: 'ganho', followups_enviados: 0 }), // respondeu + negócio fechado
    ]
    const k = calcularKpis(leads)
    expect(k.prospectados).toBe(4)
    expect(k.responderam).toBe(3)
    expect(k.reunioes).toBe(1)
    expect(k.followups).toBe(6)
    expect(k.conversao).toBe(25) // 1 ganho / 4 prospectados
  })

  it('conversão é 0 sem prospectados (não divide por zero)', () => {
    expect(calcularKpis([lead({ estagio: 'novos_leads' })]).conversao).toBe(0)
  })
})

describe('inteligencia — filtros', () => {
  it('filtra por período (última atividade), responsável e canal', () => {
    const hoje = new Date('2026-08-08T12:00:00Z')
    const antigo = new Date('2026-06-01T12:00:00Z').toISOString()
    const recente = new Date('2026-08-07T12:00:00Z').toISOString()
    const leads = [
      lead({ created_at: antigo }), // sem atividade recente → cai fora dos 30d
      lead({ created_at: recente, responsavel_nome: 'Silmara', canal_preferencial: 'whatsapp' }),
      lead({ created_at: recente, responsavel_nome: 'Francisco' }),
    ]
    // Últimos 30 dias a partir de 08/08 corta o de junho.
    expect(filtrarLeads(leads, { ...FILTROS_IC_PADRAO, periodoDias: 30 }, hoje)).toHaveLength(2)
    expect(filtrarLeads(leads, { ...FILTROS_IC_PADRAO, periodoDias: 30, responsavel: 'Francisco' }, hoje)).toHaveLength(1)
    expect(filtrarLeads(leads, { ...FILTROS_IC_PADRAO, periodoDias: null, canal: 'whatsapp' }, hoje)).toHaveLength(1)
  })

  it('período ancora em ultimo_contato: lead antigo mas com contato recente entra', () => {
    const hoje = new Date('2026-08-08T12:00:00Z')
    const l = lead({
      created_at: new Date('2026-06-01T12:00:00Z').toISOString(), // entrou há 2 meses
      ultimo_contato: new Date('2026-08-05T12:00:00Z').toISOString(), // mas foi contatado há 3d
    })
    expect(filtrarLeads([l], { ...FILTROS_IC_PADRAO, periodoDias: 30 }, hoje)).toHaveLength(1)
  })
})

describe('inteligencia — performance por canal', () => {
  it('agrupa por canal com taxa de resposta', () => {
    const leads = [
      lead({ canal_preferencial: 'email', estagio: 'primeiro_contato' }),
      lead({ canal_preferencial: 'email', estagio: 'interessado' }),
      lead({ canal_preferencial: 'whatsapp', estagio: 'novos_leads' }), // não prospectado, não entra
    ]
    const r = performancePorCanal(leads)
    const email = r.find((c) => c.canal === 'email')!
    expect(email.prospectados).toBe(2)
    expect(email.responderam).toBe(1)
    expect(email.taxa).toBe(50)
    expect(r.find((c) => c.canal === 'whatsapp')).toBeUndefined()
  })
})

describe('inteligencia — respostas por follow-up', () => {
  it('agrupa respondentes por nº de follow-ups; vazio se ninguém respondeu', () => {
    expect(respostasPorFollowup([lead({ estagio: 'primeiro_contato' })])).toEqual([])
    const leads = [
      lead({ estagio: 'interessado', followups_enviados: 0 }),
      lead({ estagio: 'reuniao_agendada', followups_enviados: 2 }),
    ]
    const r = respostasPorFollowup(leads)
    expect(r).toHaveLength(3) // 0,1,2
    expect(r[0]).toEqual({ etapa: '1º contato', respostas: 1 })
    expect(r[2]).toEqual({ etapa: '2º follow-up', respostas: 1 })
  })
})

describe('inteligencia — top leads e opções', () => {
  it('ordena por score desc e só prospectados', () => {
    const leads = [
      lead({ empresa: 'A', score: 90, estagio: 'interessado' }),
      lead({ empresa: 'B', score: 99, estagio: 'novos_leads' }), // não prospectado
      lead({ empresa: 'C', score: 70, estagio: 'follow_up' }),
    ]
    const top = topLeadsPorResposta(leads)
    expect(top.map((l) => l.empresa)).toEqual(['A', 'C'])
  })

  it('opções de filtro derivam do dado e ignoram nulos', () => {
    const leads = [
      lead({ responsavel_nome: 'Francisco', canal_preferencial: 'email', segmento: null }),
      lead({ responsavel_nome: 'Silmara', canal_preferencial: 'whatsapp', segmento: 'Hotelaria' }),
    ]
    const o = opcoesFiltro(leads)
    expect(o.responsaveis).toEqual(['Francisco', 'Silmara'])
    expect(o.canais).toEqual(['email', 'whatsapp'])
    expect(o.segmentos).toEqual(['Hotelaria'])
    expect(o.estados).toEqual([])
  })
})

describe('inteligencia — evolução', () => {
  it('semeia a janela e conta interações por tipo/dia', () => {
    const hoje = new Date('2026-08-08T12:00:00Z')
    const interacoes: InteracaoIC[] = [
      { tipo: 'abordagem', canal: 'email', created_at: '2026-08-08T09:00:00Z', lead_id: '1' },
      { tipo: 'resposta', canal: 'email', created_at: '2026-08-08T10:00:00Z', lead_id: '1' },
      { tipo: 'nota', canal: 'sistema', created_at: '2026-08-08T10:00:00Z', lead_id: '1' }, // ignorada
    ]
    const serie = evolucao(interacoes, 7, hoje)
    expect(serie).toHaveLength(7)
    const ultimo = serie[serie.length - 1]
    expect(ultimo.prospectados).toBe(1)
    expect(ultimo.respostas).toBe(1)
    expect(ultimo.reunioes).toBe(0)
  })
})
