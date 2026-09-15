// Regras puras da edição de mensagens de campanha publicada: só o conteúdo
// muda, a estrutura publicada e os campos materializados são preservados.
import { describe, it, expect } from 'vitest'
import {
  VARIAVEIS_AVISO_RESPOSTA,
  VARIAVEIS_MENSAGEM_CAMPANHA,
  aplicarEdicaoMensagens,
  motivoBloqueioEdicaoMensagens,
  variaveisDesconhecidas,
} from '../edicaoMensagens'

type Objeto = Record<string, unknown>

const publicoPublicado = () => ({
  objetivo: 'Renovar laudos',
  agenda: { diasSemana: ['seg', 'ter'] },
  operacao: {
    remetenteEmail: 'remetente@exemplo.com',
    workflowGerenciadoId: 'W1',
    mensagemInicial: {
      assunto: 'Assunto 1', corpo: 'Corpo 1', html: '<p>HTML 1</p>',
      templateId: 'T1', templateTipo: 'campanha_c1_m1', acaoId: 'email-0',
      modeloId: 'modelo-a', modeloCampos: { titulo: 'Título' },
    },
    followups: [{
      assunto: 'Assunto 2', corpo: 'Corpo 2', html: '<p>HTML 2</p>',
      templateId: 'T2', templateTipo: 'campanha_c1_m2', acaoId: 'email-1', diasApos: 3,
    }],
    resposta: {
      pararCadencia: true, notificarResponsavel: true,
      emailAssunto: 'Resposta', emailCorpo: 'Texto do aviso', emailHtml: '<p>{{nome_cliente}}</p>',
    },
  },
})

const edicaoValida = () => ({
  mensagemInicial: { assunto: '  Novo assunto  ', corpo: 'Olá {nome}', html: '<p>Olá {{nome}}</p>' },
  followups: [{ assunto: 'Novo follow-up', corpo: 'De novo, {nome}', html: '<p>HTML 2</p>', link: 'https://exemplo.com/renovar' }],
})

const operacao = (publico: Objeto) => publico.operacao as Objeto
const inicial = (publico: Objeto) => operacao(publico).mensagemInicial as Objeto
const followup = (publico: Objeto) => (operacao(publico).followups as Objeto[])[0]

describe('aplicarEdicaoMensagens', () => {
  it('troca só o conteúdo e preserva ids, intervalos e o resto do público', () => {
    const { publico, templates } = aplicarEdicaoMensagens(publicoPublicado(), edicaoValida())

    expect(inicial(publico)).toMatchObject({
      assunto: 'Novo assunto', corpo: 'Olá {nome}', html: '<p>Olá {{nome}}</p>',
      templateId: 'T1', templateTipo: 'campanha_c1_m1', acaoId: 'email-0',
    })
    expect(followup(publico)).toMatchObject({
      assunto: 'Novo follow-up', link: 'https://exemplo.com/renovar',
      templateId: 'T2', templateTipo: 'campanha_c1_m2', acaoId: 'email-1', diasApos: 3,
    })
    expect(publico.agenda).toEqual({ diasSemana: ['seg', 'ter'] })
    expect(operacao(publico).workflowGerenciadoId).toBe('W1')
    expect(operacao(publico).resposta).toEqual(publicoPublicado().operacao.resposta)
    expect(templates).toEqual([
      { indice: 0, templateTipo: 'campanha_c1_m1', assunto: 'Novo assunto', corpo: 'Olá {nome}' },
      { indice: 1, templateTipo: 'campanha_c1_m2', assunto: 'Novo follow-up', corpo: 'De novo, {nome}\n\nhttps://exemplo.com/renovar' },
    ])
  })

  it('HTML trocado descarta os campos do modelo pronto; HTML igual os mantém', () => {
    const trocado = aplicarEdicaoMensagens(publicoPublicado(), edicaoValida()).publico
    expect(inicial(trocado)).not.toHaveProperty('modeloId')
    expect(inicial(trocado)).not.toHaveProperty('modeloCampos')

    const mesmoHtml = edicaoValida()
    mesmoHtml.mensagemInicial.html = '<p>HTML 1</p>'
    const mantido = aplicarEdicaoMensagens(publicoPublicado(), mesmoHtml).publico
    expect(inicial(mantido)).toMatchObject({ modeloId: 'modelo-a', modeloCampos: { titulo: 'Título' } })
  })

  it('remover o HTML ou o link tira o campo da mensagem', () => {
    const edicao = edicaoValida()
    delete (edicao.mensagemInicial as { html?: string }).html
    const { publico } = aplicarEdicaoMensagens(publicoPublicado(), edicao)
    expect(inicial(publico)).not.toHaveProperty('html')
    expect(inicial(publico)).not.toHaveProperty('link')
  })

  it('não deixa mudar a quantidade de mensagens', () => {
    expect(() => aplicarEdicaoMensagens(publicoPublicado(), { ...edicaoValida(), followups: [] }))
      .toThrow(/quantidade de mensagens/)
  })

  it('exige assunto e texto e valida link e tamanho do HTML', () => {
    const semAssunto = edicaoValida()
    semAssunto.followups[0].assunto = '   '
    expect(() => aplicarEdicaoMensagens(publicoPublicado(), semAssunto)).toThrow('Informe o assunto do follow-up 1.')

    const semTexto = edicaoValida()
    semTexto.mensagemInicial.corpo = ''
    expect(() => aplicarEdicaoMensagens(publicoPublicado(), semTexto)).toThrow('Escreva o texto da mensagem inicial.')

    const linkRuim = edicaoValida()
    linkRuim.followups[0].link = 'javascript:alert(1)'
    expect(() => aplicarEdicaoMensagens(publicoPublicado(), linkRuim)).toThrow(/http ou https/)

    const htmlGrande = edicaoValida()
    htmlGrande.mensagemInicial.html = 'x'.repeat(200_001)
    expect(() => aplicarEdicaoMensagens(publicoPublicado(), htmlGrande)).toThrow(/200 KB/)
  })

  it('mensagem sem template publicado não pode ser editada por aqui', () => {
    const publico = publicoPublicado()
    delete (publico.operacao.mensagemInicial as { templateTipo?: string }).templateTipo
    expect(() => aplicarEdicaoMensagens(publico, edicaoValida())).toThrow(/assistente/)
  })

  it('edita o aviso ao responsável e exige assunto e texto enquanto o aviso está ligado', () => {
    const { publico } = aplicarEdicaoMensagens(publicoPublicado(), {
      ...edicaoValida(),
      resposta: { emailAssunto: 'Novo aviso', emailCorpo: '{contato} respondeu', emailHtml: '<p>{{resposta}}</p>' },
    })
    expect(operacao(publico).resposta).toEqual({
      pararCadencia: true, notificarResponsavel: true,
      emailAssunto: 'Novo aviso', emailCorpo: '{contato} respondeu', emailHtml: '<p>{{resposta}}</p>',
    })

    expect(() => aplicarEdicaoMensagens(publicoPublicado(), { ...edicaoValida(), resposta: { emailAssunto: 'Aviso' } }))
      .toThrow('Escreva o texto do aviso ao responsável.')
  })
})

describe('motivoBloqueioEdicaoMensagens', () => {
  it('ativa e pausada podem ser editadas; rascunho e concluída não', () => {
    expect(motivoBloqueioEdicaoMensagens('ativa')).toBeNull()
    expect(motivoBloqueioEdicaoMensagens('pausada')).toBeNull()
    expect(motivoBloqueioEdicaoMensagens('rascunho')).toMatch(/assistente/)
    expect(motivoBloqueioEdicaoMensagens('concluida')).toMatch(/somente leitura/)
  })
})

describe('variaveisDesconhecidas', () => {
  it('aponta variáveis que o envio não preenche, com uma ou duas chaves', () => {
    const html = '<style>p{color:red} td { margin: 0 }</style><p>Olá {{ nome }}, {empresa} — {{nome_cliente}} {valor}</p>'
    expect(variaveisDesconhecidas(html, VARIAVEIS_MENSAGEM_CAMPANHA)).toEqual(['nome_cliente', 'valor'])
  })

  it('aceita os apelidos do aviso ao responsável', () => {
    expect(variaveisDesconhecidas('{{nome_cliente}}: {{resposta_cliente}}', VARIAVEIS_AVISO_RESPOSTA)).toEqual([])
  })
})
