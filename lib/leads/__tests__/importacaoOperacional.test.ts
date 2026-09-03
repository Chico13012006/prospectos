import { describe, expect, it } from 'vitest'
import { camposBaseImportacao, montarAvisoImportacao } from '../importacaoOperacional'

describe('importação operacional de leads', () => {
  it('mantém o lote fora do motor até a ativação deliberada pelo gestor', () => {
    expect(camposBaseImportacao('org-1')).toMatchObject({
      organizacao_id: 'org-1',
      owner: 'n8n',
      estagio: 'novos_leads',
      followups_enviados: 0,
    })
  })

  it('monta o aviso ao gestor deixando explícito que não houve envio', () => {
    const aviso = montarAvisoImportacao('Francisco', {
      novos: 4,
      jaExistentes: 2,
      duplicadosNoArquivo: 1,
      totalPulados: 3,
    })
    expect(aviso.titulo).toContain('Francisco')
    expect(aviso.mensagem).toContain('4 leads')
    expect(aviso.mensagem).toContain('Nenhum envio foi iniciado')
  })
})
