import { describe, it, expect } from 'vitest'
import {
  parseCSV,
  detectarDelimitador,
  emailValido,
  processarPlanilhaPadrao,
  dedupeInternaPorEmail,
  ORIGEM_PADRAO_IMPORT,
  type LeadPadrao,
} from '../importarCsv'

describe('parseCSV', () => {
  it('respeita aspas com o delimitador dentro do campo', () => {
    const csv = 'nome;empresa\n"Silva; & Cia";"Acme, Inc"'
    const rows = parseCSV(csv, ';')
    expect(rows).toEqual([{ nome: 'Silva; & Cia', empresa: 'Acme, Inc' }])
  })

  it('aceita delimitador vírgula quando informado', () => {
    const rows = parseCSV('a,b\n1,2', ',')
    expect(rows).toEqual([{ a: '1', b: '2' }])
  })

  it('ignora linhas totalmente vazias', () => {
    const rows = parseCSV('a;b\n1;2\n\n', ';')
    expect(rows).toHaveLength(1)
  })
})

describe('detectarDelimitador', () => {
  it('detecta ; , e tab pela primeira linha', () => {
    expect(detectarDelimitador('a;b;c\n1;2;3')).toBe(';')
    expect(detectarDelimitador('a,b,c\n1,2,3')).toBe(',')
    expect(detectarDelimitador('a\tb\n1\t2')).toBe('\t')
  })
})

describe('emailValido', () => {
  it('valida formato básico', () => {
    expect(emailValido('a@b.com')).toBe(true)
    expect(emailValido('sem-arroba')).toBe(false)
    expect(emailValido('a@b')).toBe(false)
  })
})

describe('processarPlanilhaPadrao', () => {
  it('mapeia cabeçalhos pt/en e acentos e normaliza e-mail', () => {
    const csv = 'Nome;E-mail;Empresa;Origem;Telefone;Cargo;Cidade;Estado\n' +
      'Ana;ANA@X.COM;Acme;LinkedIn;(11) 99999-0000;CEO;São Paulo;SP'
    const { validos, pulados } = processarPlanilhaPadrao(csv)
    expect(pulados).toHaveLength(0)
    expect(validos[0]).toEqual<LeadPadrao>({
      contato_nome: 'Ana',
      contato_email: 'ana@x.com',
      empresa: 'Acme',
      origem: 'LinkedIn',
      contato_telefone: '11999990000',
      contato_cargo: 'CEO',
      cidade: 'São Paulo',
      estado: 'SP',
    })
  })

  it('pula linhas sem nome, sem e-mail válido ou sem empresa (2.2)', () => {
    const csv = 'nome;email;empresa\n' +
      ';a@x.com;Acme\n' +          // sem_nome
      'B;;Acme\n' +                // sem_email
      'C;invalido;Acme\n' +        // email_invalido
      'D;d@x.com;\n' +             // sem_empresa
      'E;e@x.com;Acme'             // válido
    const { validos, pulados } = processarPlanilhaPadrao(csv)
    expect(validos).toHaveLength(1)
    expect(validos[0].contato_email).toBe('e@x.com')
    expect(pulados.map((p) => p.motivo).sort()).toEqual(
      ['email_invalido', 'sem_email', 'sem_empresa', 'sem_nome'],
    )
  })

  it('usa origem padrão quando a coluna Origem falta/está vazia', () => {
    const { validos } = processarPlanilhaPadrao('nome;email;empresa\nA;a@x.com;Acme')
    expect(validos[0].origem).toBe(ORIGEM_PADRAO_IMPORT)
  })
})

describe('dedupeInternaPorEmail', () => {
  it('mantém o primeiro de cada e-mail (case-insensitive)', () => {
    const leads = [
      { contato_email: 'a@x.com', v: 1 },
      { contato_email: 'A@X.COM', v: 2 },
      { contato_email: 'b@x.com', v: 3 },
    ]
    const { unicos, duplicados } = dedupeInternaPorEmail(leads)
    expect(duplicados).toBe(1)
    expect(unicos.map((u) => u.v)).toEqual([1, 3])
  })
})
