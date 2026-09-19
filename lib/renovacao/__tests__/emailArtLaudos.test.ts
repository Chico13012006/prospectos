import { describe, expect, it } from 'vitest'
import {
  ASSUNTO_FOLLOWUP_RENOVACAO_ART_LAUDOS,
  ASSUNTO_RENOVACAO_ART_LAUDOS,
  configurarMensagensRenovacaoArtLaudos,
  CORPO_FOLLOWUP_RENOVACAO_ART_LAUDOS,
  CORPO_RENOVACAO_ART_LAUDOS,
  fraseValidadeRenovacao,
  HTML_FOLLOWUP_RENOVACAO_ART_LAUDOS,
  HTML_RENOVACAO_ART_LAUDOS,
  resolverCcResponsavelRenovacao,
  saudacaoRenovacao,
} from '../emailArtLaudos'

describe('e-mails de renovação da ART Laudos', () => {
  it('monta somente a mensagem inicial e o follow-up de 7 dias', () => {
    const publico = configurarMensagensRenovacaoArtLaudos({
      selecao: { modo: 'manual', leadIds: ['lead-antigo'] },
      operacao: {
        mensagemInicial: { acaoId: 'inicial', templateId: 'tpl-1', templateTipo: 'tipo-1' },
        followups: [
          { acaoId: 'fup-1', templateId: 'tpl-2', templateTipo: 'tipo-2', diasApos: 3 },
          { acaoId: 'remover', diasApos: 10 },
        ],
      },
    })

    expect(publico.selecao).toMatchObject({ modo: 'filtros', criterio: 'renovacao' })
    expect(publico.selecao?.leadIds).toBeUndefined()
    expect(publico.operacao?.mensagemInicial).toMatchObject({
      assunto: ASSUNTO_RENOVACAO_ART_LAUDOS,
      corpo: CORPO_RENOVACAO_ART_LAUDOS,
      html: HTML_RENOVACAO_ART_LAUDOS,
      acaoId: 'inicial',
    })
    expect(publico.operacao?.followups).toHaveLength(1)
    expect(publico.operacao?.followups?.[0]).toMatchObject({
      assunto: ASSUNTO_FOLLOWUP_RENOVACAO_ART_LAUDOS,
      corpo: CORPO_FOLLOWUP_RENOVACAO_ART_LAUDOS,
      html: HTML_FOLLOWUP_RENOVACAO_ART_LAUDOS,
      diasApos: 7,
      acaoId: 'fup-1',
    })
  })

  it('altera semanticamente a validade apenas quando a data já venceu', () => {
    const hoje = new Date('2026-09-14T12:00:00.000Z')
    expect(fraseValidadeRenovacao('2026-09-13', hoje)).toBe('venceu em')
    expect(fraseValidadeRenovacao('2026-09-14', hoje)).toBe('está com vencimento previsto para')
    expect(fraseValidadeRenovacao('2026-10-01', hoje)).toBe('está com vencimento previsto para')
  })

  it('usa primeiro nome e mantém o fallback sem nome exatamente como aprovado', () => {
    expect(saudacaoRenovacao('  Maria da Silva ')).toBe('Olá, Maria, tudo bem?')
    expect(saudacaoRenovacao(null)).toBe('Olá, tudo bem?')
    expect(saudacaoRenovacao('   ')).toBe('Olá, tudo bem?')
  })

  it('usa somente e-mail válido do responsável do lead e não duplica To/remetente', () => {
    const responsavelLead = { id: 'u1', nome: 'Ana', email: 'ana@artlaudos.com.br' }
    expect(resolverCcResponsavelRenovacao({ para: 'cliente@empresa.com', responsavelLead }))
      .toBe('ana@artlaudos.com.br')
    expect(resolverCcResponsavelRenovacao({ para: 'ANA@ARTLAUDOS.COM.BR', responsavelLead })).toBeUndefined()
    expect(resolverCcResponsavelRenovacao({
      para: 'cliente@empresa.com',
      remetenteEmail: 'ANA@ARTLAUDOS.COM.BR',
      responsavelLead,
    })).toBeUndefined()
    expect(resolverCcResponsavelRenovacao({
      para: 'cliente@empresa.com',
      responsavelLead: { ...responsavelLead, email: 'invalido' },
    })).toBeUndefined()
    expect(resolverCcResponsavelRenovacao({ para: 'cliente@empresa.com' })).toBeUndefined()
  })

  it('mantém a marca, a assinatura e placeholders seguros nos dois HTMLs', () => {
    for (const html of [HTML_RENOVACAO_ART_LAUDOS, HTML_FOLLOWUP_RENOVACAO_ART_LAUDOS]) {
      expect(html).toContain('ART LAUDOS')
      expect(html).toContain('Equipe ART Laudos')
      expect(html).not.toMatch(/undefined|null|\[object Object\]/)
      expect(html).not.toContain('InovaCode')
    }
  })
})
