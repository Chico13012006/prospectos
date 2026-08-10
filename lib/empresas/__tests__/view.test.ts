import { describe, it, expect } from 'vitest'
import {
  montarEmpresaView,
  montarContatoView,
  type LeadCompat,
  type EmpresaRow,
  type ContatoRow,
} from '../view'

const lead = (over: Partial<LeadCompat> = {}): LeadCompat => ({
  id: 'L1', empresa: 'Ótica Central', cidade: 'Rio', estado: 'RJ', segmento: 'Óticas',
  site: null, dominio: null, origem: 'import_hubspot',
  contato_nome: 'João', contato_cargo: 'Gerente', contato_email: 'joao@central.com', contato_telefone: '21999',
  ...over,
})

const empresaRow = (over: Partial<EmpresaRow> = {}): EmpresaRow => ({
  id: 'E1', nome: 'Ótica Central', cnpj: '11222333000181', dominio: 'central.com', segmento: 'Óticas',
  cidade: 'Rio', estado: 'RJ', site: null, origem: 'lead_backfill',
  revisao_pendente: false, motivo_revisao: null, arquivado: false, ...over,
})

const contatoRow = (over: Partial<ContatoRow> = {}): ContatoRow => ({
  id: 'C1', nome: 'João', cargo: 'Gerente', email: 'joao@central.com', telefone: '21999',
  email_validado: true, whatsapp: null, linkedin: null, senioridade: 'pleno', origem: 'lead_backfill', arquivado: false, ...over,
})

describe('view — fonte da verdade na transição', () => {
  it('empresa: campos só-entidade vêm da entidade (cnpj, revisão)', () => {
    const v = montarEmpresaView(lead(), empresaRow({ revisao_pendente: true, motivo_revisao: 'x' }))
    expect(v.id).toBe('E1')
    expect(v.cnpj).toBe('11222333000181')
    expect(v.revisaoPendente).toBe(true)
    expect(v.motivoRevisao).toBe('x')
    expect(v.fonte).toBe('entidade')
  })

  it('CONSISTÊNCIA: lead alterado prevalece sobre projeção defasada (sem divergência de leitura)', () => {
    // Simula: alteraram o lead (novo e-mail/nome) mas a projeção do backfill está velha.
    const leadAlterado = lead({ empresa: 'Ótica Central NOVA', contato_email: 'novo@central.com', contato_nome: 'João Silva' })
    const emp = montarEmpresaView(leadAlterado, empresaRow({ nome: 'Ótica Central' }))
    const ct = montarContatoView(leadAlterado, contatoRow({ email: 'velho@central.com', nome: 'João', email_validado: true }))
    // core mutável reflete o LEAD (autoritativo)
    expect(emp.nome).toBe('Ótica Central NOVA')
    expect(ct.email).toBe('novo@central.com')
    expect(ct.nome).toBe('João Silva')
    // campo só-entidade preservado da projeção
    expect(ct.emailValidado).toBe(true)
  })

  it('fallback LEGADO: lead sem entidade ligada → tudo derivado do lead', () => {
    const emp = montarEmpresaView(lead(), null)
    const ct = montarContatoView(lead(), null)
    expect(emp.fonte).toBe('legado')
    expect(emp.id).toBeNull()
    expect(emp.nome).toBe('Ótica Central')
    expect(emp.cnpj).toBeNull()
    expect(ct.fonte).toBe('legado')
    expect(ct.email).toBe('joao@central.com')
    expect(ct.emailValidado).toBe(false)
  })

  it('entidade sem lead (contato/empresa futuros) → tudo da entidade', () => {
    const emp = montarEmpresaView(null, empresaRow())
    const ct = montarContatoView(null, contatoRow())
    expect(emp.nome).toBe('Ótica Central')
    expect(emp.cnpj).toBe('11222333000181')
    expect(ct.email).toBe('joao@central.com')
    expect(ct.senioridade).toBe('pleno')
  })

  it('domínio: leads autoritativo quando preenchido, senão cai na entidade', () => {
    expect(montarEmpresaView(lead({ dominio: 'lead-dominio.com' }), empresaRow({ dominio: 'proj.com' })).dominio).toBe('lead-dominio.com')
    expect(montarEmpresaView(lead({ dominio: null }), empresaRow({ dominio: 'proj.com' })).dominio).toBe('proj.com')
  })
})
