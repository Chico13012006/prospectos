import { describe, expect, it } from 'vitest'
import {
  aplicarRegraPublicoPorTipo,
  campanhaEhDisparoUnico,
  corpoComLink,
  montarDefinicaoCampanha,
  modeloEmailRespostaCampanha,
  normalizarPublicoCampanha,
  tipoTemplateCampanha,
  validarCampanhaGuiada,
} from '../configuracaoGuiada'

describe('configuração guiada de campanha', () => {
  it('normaliza listas, defaults seguros e não habilita recursos ainda não conectados', () => {
    const publico = normalizarPublicoCampanha({
      responsavel_id: ' perfil-1 ',
      selecao: { modo: 'manual', leadIds: ['lead-1', 'lead-1', ' lead-2 '], excluirEmpresas: [' id:acme ', 'id:acme'] },
      operacao: {
        mensagemInicial: { html: ' <p>Cliente</p> ' },
        resposta: { emailHtml: ' <p>Responsável</p> ' },
      },
    })

    expect(publico.responsavel_id).toBe('perfil-1')
    expect(publico.selecao).toMatchObject({ modo: 'manual', leadIds: ['lead-1', 'lead-2'], excluirEmpresas: ['id:acme'] })
    expect(publico.operacao?.mensagemInicial?.html).toBe('<p>Cliente</p>')
    expect(publico.operacao?.resposta?.emailHtml).toBe('<p>Responsável</p>')
    expect(publico.agenda?.pararAoResponder).toBe(true)
    expect(publico.operacao?.resposta).toMatchObject({
      pararCadencia: true,
      criarTarefa: false,
      notificarResponsavel: true,
      notificarAdministradores: false,
      prepararSugestao: false,
    })
  })

  it('valida somente dados necessários e links http/https', () => {
    const incompleta = normalizarPublicoCampanha({ selecao: { modo: 'manual' } })
    expect(validarCampanhaGuiada(incompleta)).toEqual(expect.arrayContaining([
      'Configure uma conta remetente no workspace.',
      'Defina o responsável pelos retornos.',
      'Selecione ao menos um contato.',
    ]))

    const completa = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha({
      responsavel_id: 'perfil-1',
      selecao: { modo: 'manual', leadIds: ['lead-1'] },
      operacao: {
        remetenteEmail: 'time@empresa.com',
        mensagemInicial: { assunto: 'Uma novidade', corpo: 'Olá', link: 'https://empresa.com/novidade' },
        followups: [{ diasApos: 3, assunto: 'Você viu?', corpo: 'Retomando.' }],
      },
    }), 'novidade_clientes')
    expect(validarCampanhaGuiada(completa)).toEqual([])
  })

  it('trata comunicação e renovação como disparos únicos impostos pelo servidor', () => {
    for (const tipo of ['novidade_clientes', 'renovacao']) {
      const publico = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha({
        agenda: { diasSemana: [] },
        operacao: {
          mensagemInicial: { assunto: 'Comunicado', corpo: 'Corpo', templateTipo: 'campanha_x_m1' },
          followups: [{ diasApos: 3, assunto: 'FUP indevido', corpo: 'Corpo', templateTipo: 'campanha_x_m2' }],
        },
      }), tipo)

      expect(campanhaEhDisparoUnico(tipo)).toBe(true)
      expect(publico.operacao?.modoEnvio).toBe('disparo_unico')
      expect(publico.operacao?.followups).toBeUndefined()
      expect(montarDefinicaoCampanha(publico).acoes).toEqual([
        { id: 'email-0', tipo: 'enviar_email', config: { template: 'campanha_x_m1' } },
      ])
      expect(validarCampanhaGuiada(publico)).not.toContain('Escolha ao menos um dia de envio.')
    }
  })

  it('materializa uma sequência determinística de e-mails e esperas incrementais', () => {
    const publico = normalizarPublicoCampanha({
      operacao: {
        mensagemInicial: { assunto: 'Inicial', corpo: 'Corpo', templateTipo: 'campanha_x_m1' },
        followups: [
          { diasApos: 3, assunto: 'F1', corpo: 'Corpo 1', templateTipo: 'campanha_x_m2' },
          { diasApos: 7, assunto: 'F2', corpo: 'Corpo 2', templateTipo: 'campanha_x_m3' },
        ],
      },
    })
    expect(montarDefinicaoCampanha(publico).acoes).toEqual([
      { id: 'email-0', tipo: 'enviar_email', config: { template: 'campanha_x_m1' } },
      { id: 'espera-1', tipo: 'esperar', config: { dias: 3, horas: 0 } },
      { id: 'email-1', tipo: 'enviar_email', config: { template: 'campanha_x_m2' } },
      { id: 'espera-2', tipo: 'esperar', config: { dias: 4, horas: 0 } },
      { id: 'email-2', tipo: 'enviar_email', config: { template: 'campanha_x_m3' } },
    ])
  })

  it('preserva follow-up parcial no rascunho para permitir retomada da edição', () => {
    const publico = normalizarPublicoCampanha({
      operacao: { followups: [{ diasApos: 3, assunto: '', corpo: '' }] },
    })
    expect(publico.operacao?.followups).toEqual([{ diasApos: 3 }])
    const comInicial = normalizarPublicoCampanha({
      operacao: {
        mensagemInicial: { assunto: 'Inicial', corpo: 'Corpo', templateTipo: 'campanha_x_m1' },
        followups: [{ diasApos: 3 }],
      },
    })
    expect(montarDefinicaoCampanha(comInicial).acoes).toHaveLength(1)
  })

  it('gera chave isolada por campanha e anexa link uma única vez', () => {
    expect(tipoTemplateCampanha('AB-CD', 1)).toBe('campanha_abcd_m2')
    expect(corpoComLink({ corpo: 'Leia mais', link: 'https://empresa.com' })).toBe('Leia mais\n\nhttps://empresa.com')
    expect(corpoComLink({ corpo: 'Leia https://empresa.com', link: 'https://empresa.com' })).toBe('Leia https://empresa.com')
  })

  it('impõe no servidor o público permitido para prospecção e renovação', () => {
    const bruto = normalizarPublicoCampanha({
      empresas: { segmento: 'Indústria', cidades: 'Brasil' },
      selecao: { estagios: ['follow_up', 'ganho'] },
    })

    const prospeccao = aplicarRegraPublicoPorTipo(bruto, 'prospeccao')
    expect(prospeccao.selecao?.estagios).toEqual(['novo', 'novos_leads'])
    expect(prospeccao.empresas).toMatchObject({ segmento: 'Indústria' })
    expect(prospeccao.empresas?.cidades).toBeUndefined()

    const renovacao = aplicarRegraPublicoPorTipo(bruto, 'renovacao')
    expect(renovacao.selecao?.criterio).toBe('renovacao')
    expect(renovacao.selecao?.estagios).toBeUndefined()

    const novidade = aplicarRegraPublicoPorTipo(bruto, 'novidade_clientes')
    expect(novidade.selecao?.criterio).toBe('base')
    expect(novidade.selecao?.estagios).toBeUndefined()
  })

  it('permite escolher apenas os grupos válidos em uma campanha de follow-up', () => {
    const publico = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha({
      selecao: { estagios: ['aguardando_resposta', 'sem_resposta', 'perdido'] },
    }), 'followup')

    expect(publico.selecao?.estagios).toEqual(['aguardando_resposta', 'sem_resposta'])
  })

  it('oferece modelo de resposta por objetivo sem sobrescrever conteúdo editado', () => {
    const modelo = modeloEmailRespostaCampanha('renovacao')
    expect(modelo.assunto).toContain('renovação')
    expect(modelo.corpo).toContain('{tipo_campanha}')

    const publico = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha({
      operacao: { resposta: { emailAssunto: 'Assunto próprio', emailCorpo: 'Corpo próprio' } },
    }), 'renovacao')
    expect(publico.operacao?.resposta?.emailAssunto).toBe('Assunto próprio')
    expect(publico.operacao?.resposta?.emailCorpo).toBe('Corpo próprio')
  })
})
