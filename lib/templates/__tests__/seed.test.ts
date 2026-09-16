// P0: o seed antigo apagava os templates de TODAS as organizações. Estes testes
// provam o contrário para o seed atual: organização obrigatória, ensaio por
// padrão, só inserção na organização alvo e nenhuma escrita em outra.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SeedTemplate } from '@/lib/engine/templates-seed'
import { BancoFalso } from './bancoFalso'
import { ErroSeedTemplates, executarSeedTemplates, lerOrganizacaoAlvo, planejarSeedTemplates } from '../seed'

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002'

const SEED: SeedTemplate[] = [
  { canal: 'email', nicho: null, tipo: 'primeiro_contato', nome: 'Base · 1º contato', assunto: '{empresa}', corpo: 'Texto base' },
  { canal: 'email', nicho: null, tipo: 'follow_up_1', nome: 'Base · FUP 1', assunto: 'Re', corpo: 'Retomando' },
  { canal: 'whatsapp', nicho: 'varejo', tipo: 'primeiro_contato', nome: 'Base · WhatsApp varejo', assunto: null, corpo: 'Oi' },
]

function montarBanco() {
  return new BancoFalso({
    organizacoes: [{ id: ORG_A, nome: 'Org A' }, { id: ORG_B, nome: 'Org B' }],
    templates: [
      { id: 'a-1', organizacao_id: ORG_A, canal: 'email', nicho: null, tipo: 'primeiro_contato', nome: 'Editado pela A', assunto: 'Assunto A', corpo: 'Conteúdo próprio da A', ativo: true },
      { id: 'b-1', organizacao_id: ORG_B, canal: 'email', nicho: null, tipo: 'primeiro_contato', nome: 'Da B', assunto: 'Assunto B', corpo: 'Conteúdo da B', ativo: true },
      { id: 'b-2', organizacao_id: ORG_B, canal: 'email', nicho: null, tipo: 'reativacao_1', nome: 'Reativação da B', assunto: 'B', corpo: 'B', ativo: false },
    ],
  })
}

describe('seed de templates — organização alvo', () => {
  it('sem --org, com valor vazio ou não-UUID: aborta', () => {
    expect(() => lerOrganizacaoAlvo(['node', 'seed.ts'])).toThrow(ErroSeedTemplates)
    expect(() => lerOrganizacaoAlvo(['--org='])).toThrow(/organização alvo/)
    expect(() => lerOrganizacaoAlvo(['--org=todas'])).toThrow(/inválida/)
    expect(() => lerOrganizacaoAlvo(['--org'])).toThrow(ErroSeedTemplates)
  })

  it('aceita --org=<uuid> e --org <uuid>', () => {
    expect(lerOrganizacaoAlvo([`--org=${ORG_A}`])).toBe(ORG_A)
    expect(lerOrganizacaoAlvo(['--org', ORG_B.toUpperCase(), '--confirmar'])).toBe(ORG_B)
  })

  it('organização ausente ou inválida: nenhuma consulta é feita', async () => {
    const banco = montarBanco()
    for (const organizacaoId of ['', 'abc', undefined as unknown as string]) {
      await expect(executarSeedTemplates(banco.cliente(), { organizacaoId, confirmar: true, seed: SEED }))
        .rejects.toThrow(ErroSeedTemplates)
    }
    expect(banco.operacoes).toEqual([])
  })

  it('organização inexistente: aborta sem escrever', async () => {
    const banco = montarBanco()
    await expect(executarSeedTemplates(banco.cliente(), {
      organizacaoId: 'cccccccc-0000-4000-8000-000000000003',
      confirmar: true,
      seed: SEED,
    })).rejects.toThrow(/não encontrada/)
    expect(banco.escritas()).toEqual([])
  })
})

describe('seed de templates — sem efeito fora da organização alvo', () => {
  it('ensaio (padrão) relata o que faria e não escreve nada', async () => {
    const banco = montarBanco()
    const antes = banco.copia('templates')
    const r = await executarSeedTemplates(banco.cliente(), { organizacaoId: ORG_A, confirmar: false, seed: SEED })
    expect(r.confirmado).toBe(false)
    expect(r.aInserir.map((t) => `${t.canal}:${t.tipo}`)).toEqual(['email:follow_up_1', 'whatsapp:primeiro_contato'])
    expect(r.inseridos).toBe(0)
    expect(banco.escritas()).toEqual([])
    expect(banco.copia('templates')).toEqual(antes)
  })

  it('confirmado na Org A: só insere o que falta na A e nunca apaga ou altera templates da B', async () => {
    const banco = montarBanco()
    const templatesDaB = banco.copia('templates').filter((t) => t.organizacao_id === ORG_B)
    const r = await executarSeedTemplates(banco.cliente(), { organizacaoId: ORG_A, confirmar: true, seed: SEED })

    expect(r.inseridos).toBe(2)
    expect(banco.escritas().every((op) => op.tipo === 'insert')).toBe(true)
    const inseridas = banco.escritas().flatMap((op) => op.payload as Record<string, unknown>[])
    expect(inseridas.every((linha) => linha.organizacao_id === ORG_A)).toBe(true)
    expect(banco.copia('templates').filter((t) => t.organizacao_id === ORG_B)).toEqual(templatesDaB)
    // O que a A já tinha (e editou) fica exatamente como estava.
    expect(banco.linhas('templates').find((t) => t.id === 'a-1')).toMatchObject({ nome: 'Editado pela A', corpo: 'Conteúdo próprio da A' })
  })

  it('toda leitura de templates filtra a organização alvo', async () => {
    const banco = montarBanco()
    await executarSeedTemplates(banco.cliente(), { organizacaoId: ORG_A, confirmar: true, seed: SEED })
    const leituras = banco.operacoes.filter((op) => op.tabela === 'templates' && op.tipo === 'select')
    expect(leituras.length).toBeGreaterThan(0)
    for (const op of leituras) {
      expect(op.filtros).toContainEqual({ op: 'eq', coluna: 'organizacao_id', valor: ORG_A })
    }
  })

  it('é idempotente: a segunda execução não insere nada', async () => {
    const banco = montarBanco()
    await executarSeedTemplates(banco.cliente(), { organizacaoId: ORG_A, confirmar: true, seed: SEED })
    const segunda = await executarSeedTemplates(banco.cliente(), { organizacaoId: ORG_A, confirmar: true, seed: SEED })
    expect(segunda.inseridos).toBe(0)
    expect(banco.linhas('templates').filter((t) => t.organizacao_id === ORG_A)).toHaveLength(3)
  })

  it('a chave considera canal, segmento e estágio, e não repete chave do próprio seed', () => {
    const plano = planejarSeedTemplates(
      [{ canal: 'email', nicho: 'varejo', tipo: 'primeiro_contato' }],
      [...SEED, SEED[0]],
    )
    expect(plano.map((t) => `${t.canal}:${t.nicho}:${t.tipo}`)).toEqual([
      'email:null:primeiro_contato',
      'email:null:follow_up_1',
      'whatsapp:varejo:primeiro_contato',
    ])
  })

  it('o script não tem DELETE e exige organização explícita', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts', 'seed-templates.ts'), 'utf-8')
    expect(script).not.toMatch(/DELETE|\.delete\(/)
    expect(script).toContain('lerOrganizacaoAlvo(process.argv)')
    expect(script).toContain('anunciarModo(')
    expect(script).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })
})
