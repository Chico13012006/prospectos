import { describe, it, expect } from 'vitest'
import {
  MAX_TENTATIVAS_NOTIFICACAO,
  processarNotificacaoGrupo,
  registrarAlertaGrupo,
  reprocessarNotificacoesGrupo,
  type DepsNotificacaoGrupo,
} from '../grupoComercial'
import { montarMensagemGrupo } from '../mensagens'
import { MemoryNotificacaoRepository } from './memoryRepository'
import type { DadosAlertaHandoff, EnviadorGrupo } from '../types'

const ORG = 'org-a'
const GRUPO = '120363019502650977-group'

const dados = (over: Partial<DadosAlertaHandoff> = {}): DadosAlertaHandoff => ({
  empresa: 'ACME Ltda', contato: 'Ana Silva', responsavelNome: 'Bruno', motivo: 'round_robin', etapaCadencia: 'follow-up 2', ...over,
})

// Enviador falso: registra chamadas e devolve o que o teste mandar.
function enviadorFake(comportamento: 'ok' | 'offline' | 'excecao' = 'ok') {
  const chamadas: { grupoId: string; mensagem: string }[] = []
  const enviar: EnviadorGrupo = async (grupoId, mensagem) => {
    chamadas.push({ grupoId, mensagem })
    if (comportamento === 'excecao') throw new Error('rede caiu')
    if (comportamento === 'offline') return { ok: false, codigo: 'zapi_desconectada', mensagem: 'instância desconectada' }
    return { ok: true, providerMessageId: `zapi-${chamadas.length}` }
  }
  return { enviar, chamadas, set(c: typeof comportamento) { comportamento = c } }
}

function deps(over: Partial<DepsNotificacaoGrupo> & { grupo?: string | null; comportamento?: 'ok' | 'offline' | 'excecao' } = {}) {
  const repo = new MemoryNotificacaoRepository()
  const envio = enviadorFake(over.comportamento ?? 'ok')
  const grupo = over.grupo === undefined ? GRUPO : over.grupo
  const d: DepsNotificacaoGrupo = { repo, enviar: envio.enviar, lerGrupoId: async () => grupo, ...over }
  return { d, repo, envio }
}

describe('mensagens do grupo', () => {
  it('15. primeiro handoff: empresa, contato, responsável, origem e status', () => {
    const m = montarMensagemGrupo(dados())
    expect(m).toContain('NOVO LEAD INTERESSADO — ProspectOS')
    expect(m).toContain('Empresa: ACME Ltda')
    expect(m).toContain('Contato: Ana Silva')
    expect(m).toContain('Responsável: @Bruno')
    expect(m).toContain('Origem: Respondeu ao follow-up 2')
    expect(m).toContain('Status: Em contato comercial')
    expect(m).toContain('O lead foi direcionado para Bruno.')
  })

  it('16. reativação: identifica que voltou ao mesmo responsável, sem "novo lead"', () => {
    const m = montarMensagemGrupo(dados({ motivo: 'reativacao' }))
    expect(m).toContain('LEAD VOLTOU A RESPONDER — ProspectOS')
    expect(m).toContain('retorna para o mesmo responsável comercial')
    expect(m).toContain('Responsável: @Bruno')
    expect(m).not.toContain('NOVO LEAD')
  })
})

describe('notificação do grupo — ciclo de vida', () => {
  it('registra a intenção uma vez por handoff (idempotente) e envia uma única mensagem', async () => {
    const { d, repo, envio } = deps()
    const a = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    const b = await registrarAlertaGrupo(d, ORG, 'h1', dados({ responsavelNome: 'Outro' }))
    expect(b.id).toBe(a.id)
    expect(repo.linhas).toHaveLength(1)
    expect(repo.linhas[0].dados.responsavelNome).toBe('Bruno') // a primeira vale

    const r1 = await processarNotificacaoGrupo(d, ORG, a.id)
    const r2 = await processarNotificacaoGrupo(d, ORG, a.id)
    expect(r1.tipo).toBe('enviada')
    expect(r2.tipo).toBe('ja_enviada')
    expect(envio.chamadas).toHaveLength(1)
    expect(envio.chamadas[0].grupoId).toBe(GRUPO)
    expect(repo.linhas[0]).toMatchObject({ status: 'enviada', tentativas: 1, destino: GRUPO, providerMessageId: 'zapi-1' })
    expect(repo.linhas[0].enviadoEm).not.toBeNull()
  })

  it('10. grupo não configurado → configuracao_ausente, sem consumir tentativa; configurado depois → envia', async () => {
    let grupo: string | null = null
    const { d, repo, envio } = deps({ lerGrupoId: async () => grupo })
    const n = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    const r = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r.tipo).toBe('configuracao_ausente')
    expect(repo.linhas[0]).toMatchObject({ status: 'configuracao_ausente', tentativas: 0 })
    expect(envio.chamadas).toHaveLength(0)

    grupo = GRUPO
    const r2 = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r2.tipo).toBe('enviada')
    expect(envio.chamadas).toHaveLength(1)
  })

  it('11. Z-API offline → falhou (retentável), depois volta e envia uma única vez', async () => {
    const { d, repo, envio } = deps({ comportamento: 'offline' })
    const n = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    const r = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r.tipo).toBe('falhou')
    if (r.tipo !== 'falhou') return
    expect(r.retentavel).toBe(true)
    expect(repo.linhas[0]).toMatchObject({ status: 'falhou', tentativas: 1 })
    expect(repo.linhas[0].ultimoErro).toContain('zapi_desconectada')

    envio.set('ok')
    const r2 = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r2.tipo).toBe('enviada')
    expect(envio.chamadas).toHaveLength(2)
    expect(repo.linhas[0]).toMatchObject({ status: 'enviada', tentativas: 2 })
  })

  it('exceção do transporte não escapa: vira falhou', async () => {
    const { d, repo } = deps({ comportamento: 'excecao' })
    const n = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    const r = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r.tipo).toBe('falhou')
    expect(repo.linhas[0].ultimoErro).toContain('rede caiu')
  })

  it('teto de tentativas: sem retry infinito', async () => {
    const { d, envio } = deps({ comportamento: 'offline' })
    const n = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    for (let i = 0; i < MAX_TENTATIVAS_NOTIFICACAO; i++) {
      const r = await processarNotificacaoGrupo(d, ORG, n.id)
      expect(r.tipo).toBe('falhou')
    }
    const r = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r.tipo).toBe('esgotada')
    expect(envio.chamadas).toHaveLength(MAX_TENTATIVAS_NOTIFICACAO)
    expect(await d.repo.listarReprocessaveis(ORG, MAX_TENTATIVAS_NOTIFICACAO, 10)).toHaveLength(0)
  })

  it("processo morreu entre enviar e marcar ('enviando' preso) → 'incerta', NUNCA reenvia", async () => {
    const { d, repo, envio } = deps()
    const n = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    await repo.reivindicarEnvio(ORG, n.id, 0) // simula o crash logo após a reivindicação
    const r = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r.tipo).toBe('incerta')
    expect(envio.chamadas).toHaveLength(0)
    expect(await repo.listarReprocessaveis(ORG, MAX_TENTATIVAS_NOTIFICACAO, 10)).toHaveLength(0)
  })

  it('8. dois processadores concorrentes → só um vence o compare-and-swap e envia', async () => {
    const { d, repo, envio } = deps()
    const n = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    let chegaram = 0; let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    repo.antesDeReivindicar = async () => { if (++chegaram === 2) liberar(); await barreira }
    const [a, b] = await Promise.all([processarNotificacaoGrupo(d, ORG, n.id), processarNotificacaoGrupo(d, ORG, n.id)])
    expect([a.tipo, b.tipo].sort()).toEqual(['concorrente', 'enviada'])
    expect(envio.chamadas).toHaveLength(1)
  })

  it('13. notificação de outra organização não é encontrada nem enviada', async () => {
    const { d, envio } = deps()
    const n = await registrarAlertaGrupo(d, 'org-b', 'h1', dados())
    const r = await processarNotificacaoGrupo(d, ORG, n.id)
    expect(r.tipo).toBe('nao_encontrada')
    expect(envio.chamadas).toHaveLength(0)
  })

  it('reprocessar: entrega pendentes/falhas da org, para no grupo ausente, ignora enviadas', async () => {
    const { d, repo, envio } = deps({ comportamento: 'offline' })
    const n1 = await registrarAlertaGrupo(d, ORG, 'h1', dados())
    const n2 = await registrarAlertaGrupo(d, ORG, 'h2', dados())
    await registrarAlertaGrupo(d, 'org-b', 'h3', dados())
    await processarNotificacaoGrupo(d, ORG, n1.id) // falhou
    envio.set('ok')
    const r = await reprocessarNotificacoesGrupo(d, ORG)
    expect(r).toEqual({ processadas: 2, enviadas: 2, falhas: 0, semConfiguracao: 0 })
    expect(repo.linhas.filter((n) => n.organizacaoId === ORG).every((n) => n.status === 'enviada')).toBe(true)
    expect(repo.linhas.find((n) => n.organizacaoId === 'org-b')?.status).toBe('pendente')
    expect(envio.chamadas.map((c) => c.grupoId)).toEqual([GRUPO, GRUPO, GRUPO])
    expect((await reprocessarNotificacoesGrupo(d, ORG)).processadas).toBe(0)
    expect(n2.status).toBe('pendente') // snapshot antigo; o repo é a verdade
  })
})
