import { describe, expect, it } from 'vitest'
import { ErroEdicaoLead, normalizarPatchCadastralLead } from '../edicao'

describe('edição cadastral do lead', () => {
  it('normaliza os campos permitidos e ignora estados do motor', () => {
    const patch = normalizarPatchCadastralLead({
      contato_nome: '  Ana Silva  ',
      contato_email: ' ANA@EMPRESA.COM ',
      contato_telefone: '(11) 99999-0000',
      empresa: '  Empresa A  ',
      estado: 'sp',
      segmento: '',
      data_validade: '',
      estagio: 'ganho',
      owner: 'engine',
      score: 100,
      organizacao_id: 'org-invasora',
    })

    expect(patch).toEqual({
      contato_nome: 'Ana Silva',
      contato_email: 'ana@empresa.com',
      contato_telefone: '11999990000',
      empresa: 'Empresa A',
      estado: 'SP',
      segmento: null,
      data_validade: null,
    })
    expect(patch).not.toHaveProperty('estagio')
    expect(patch).not.toHaveProperty('owner')
    expect(patch).not.toHaveProperty('score')
    expect(patch).not.toHaveProperty('organizacao_id')
  })

  it('rejeita e-mail inválido e campos obrigatórios vazios', () => {
    expect(() => normalizarPatchCadastralLead({ contato_email: 'invalido' })).toThrow('Informe um e-mail válido.')
    expect(() => normalizarPatchCadastralLead({ empresa: '  ' })).toThrow('Informe a empresa.')
  })

  it('rejeita canal e data inexistentes', () => {
    expect(() => normalizarPatchCadastralLead({ canal_preferencial: 'telegram' })).toThrow(ErroEdicaoLead)
    expect(() => normalizarPatchCadastralLead({ data_validade: '2026-02-30' })).toThrow('Data de validade inválida.')
    expect(() => normalizarPatchCadastralLead({ site: 'javascript:alert(1)' })).toThrow('Informe um site válido.')
  })
})
