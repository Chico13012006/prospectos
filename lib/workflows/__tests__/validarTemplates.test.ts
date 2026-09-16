// Publicar/retomar/ativar só com todos os templates realmente enviáveis.
import { describe, expect, it } from 'vitest'
import { BancoFalso, type Linha } from '@/lib/templates/__tests__/bancoFalso'
import { mensagemProblemasTemplate, validarTemplatesDaDefinicao } from '../validarTemplates'

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
const OUTRA = 'bbbbbbbb-0000-4000-8000-000000000002'

const template = (org: string, tipo: string, dados: Partial<Linha> = {}): Linha => ({
  id: `${org}-${tipo}-${dados.canal ?? 'email'}-${dados.ativo === false ? 'off' : 'on'}`,
  organizacao_id: org,
  tipo,
  canal: 'email',
  ativo: true,
  corpo: 'Olá {{nome}}',
  html: null,
  ...dados,
})

const definicao = (...tipos: string[]) => ({
  gatilho: { tipo: 'manual', config: {} },
  condicoes: [],
  acoes: tipos.map((tipo, i) => ({ id: `e${i}`, tipo: 'enviar_email', config: { template: tipo } })),
})

describe('validarTemplatesDaDefinicao', () => {
  it('definição sem envio de e-mail não tem o que validar', async () => {
    const banco = new BancoFalso({})
    expect(await validarTemplatesDaDefinicao(banco.cliente(), ORG, { acoes: [{ tipo: 'esperar', config: { dias: 1 } }] })).toEqual([])
    expect(banco.operacoes).toEqual([])
  })

  it('aprova quando existe variante ativa de e-mail com conteúdo', async () => {
    const banco = new BancoFalso({ templates: [template(ORG, 'reativacao_1'), template(ORG, 'renovacao_1', { corpo: '', html: '<p>Oi</p>' })] })
    expect(await validarTemplatesDaDefinicao(banco.cliente(), ORG, definicao('reativacao_1', 'renovacao_1'))).toEqual([])
  })

  it('aprova cópia de campanha (campanha_*) como qualquer outro template', async () => {
    const banco = new BancoFalso({ templates: [template(ORG, 'campanha_abc_m1')] })
    expect(await validarTemplatesDaDefinicao(banco.cliente(), ORG, definicao('campanha_abc_m1'))).toEqual([])
  })

  it('aponta ausente, inativo, canal errado e sem conteúdo', async () => {
    const banco = new BancoFalso({
      templates: [
        template(ORG, 'inativo_1', { ativo: false }),
        template(ORG, 'whats_1', { canal: 'whatsapp' }),
        template(ORG, 'vazio_1', { corpo: '   ', html: null }),
      ],
    })
    const problemas = await validarTemplatesDaDefinicao(banco.cliente(), ORG, definicao('some_1', 'inativo_1', 'whats_1', 'vazio_1'))
    expect(problemas).toEqual([
      { template: 'some_1', motivo: 'ausente' },
      { template: 'inativo_1', motivo: 'inativo' },
      { template: 'whats_1', motivo: 'canal' },
      { template: 'vazio_1', motivo: 'sem_conteudo' },
    ])
  })

  it('uma variante ativa basta, mesmo com outra desativada na mesma chave', async () => {
    const banco = new BancoFalso({
      templates: [template(ORG, 'reativacao_1', { ativo: false }), template(ORG, 'reativacao_1', { nicho: 'hotelaria' })],
    })
    expect(await validarTemplatesDaDefinicao(banco.cliente(), ORG, definicao('reativacao_1'))).toEqual([])
  })

  it('template que só existe em outra organização é apenas "ausente" aqui', async () => {
    const banco = new BancoFalso({ templates: [template(OUTRA, 'reativacao_1')] })
    const problemas = await validarTemplatesDaDefinicao(banco.cliente(), ORG, definicao('reativacao_1'))
    expect(problemas).toEqual([{ template: 'reativacao_1', motivo: 'ausente' }])
    const texto = mensagemProblemasTemplate(problemas)
    expect(texto).toBe('Não foi possível publicar: "reativacao_1" não existe na biblioteca desta organização.')
    expect(texto).not.toContain(OUTRA)
    for (const op of banco.operacoes) {
      expect(op.filtros).toContainEqual({ op: 'eq', coluna: 'organizacao_id', valor: ORG })
    }
  })

  it('lê o ramificar legado e o padrão follow_up_1 do bloco sem template', async () => {
    const banco = new BancoFalso({ templates: [] })
    const problemas = await validarTemplatesDaDefinicao(banco.cliente(), ORG, {
      acoes: [
        { tipo: 'enviar_email', config: {} },
        { tipo: 'ramificar', config: { entao: [{ tipo: 'enviar_email', config: { template: 'ramo_1' } }], senao: [] } },
      ],
    })
    expect(problemas.map((p) => p.template).sort()).toEqual(['follow_up_1', 'ramo_1'])
  })

  it('a mensagem muda conforme a ação', async () => {
    const problemas = [{ template: 'x', motivo: 'inativo' as const }]
    expect(mensagemProblemasTemplate(problemas, 'retomar')).toContain('Não foi possível retomar')
    expect(mensagemProblemasTemplate(problemas, 'ativar')).toContain('Não foi possível ativar')
  })
})
