import { describe, it, expect } from 'vitest'
import { vincularResponsavel, type MembroEquipe, type UsuarioRef } from '../responsavel'

// Cenário-base: os 3 membros/usuários reais depois da correção de raiz em
// `usuarios` (Rufs ganhou linha própria; e-mail da Silmara alinhado ao login).
const USUARIOS: UsuarioRef[] = [
  { id: 'u-francisco', nome: 'Francisco', email: 'suporteinterno1inovacode@gmail.com' },
  { id: 'u-silmara', nome: 'Silmara', email: 'silmaragoncalves@inovacode.com.br' },
  { id: 'u-rufs', nome: 'Francisco Rufs', email: 'franrufs13@gmail.com' },
]

const EQUIPE: MembroEquipe[] = [
  { authId: 'a-rufino', nome: 'Francisco Rufino', email: 'suporteinterno1inovacode@gmail.com' },
  { authId: 'a-silmara', nome: 'Silmara Gonçalves', email: 'silmaragoncalves@inovacode.com.br' },
  { authId: 'a-rufs', nome: 'Francisco Rufs', email: 'franrufs13@gmail.com' },
]

describe('vincularResponsavel', () => {
  it('resolve os 3 membros reais por E-MAIL exato, sem colisão', () => {
    for (const [membro, esperado] of [
      [EQUIPE[0], 'u-francisco'],
      [EQUIPE[1], 'u-silmara'],
      [EQUIPE[2], 'u-rufs'],
    ] as const) {
      const r = vincularResponsavel(membro, USUARIOS, EQUIPE)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.usuario.id).toBe(esperado)
        expect(r.via).toBe('email')
      }
    }
  })

  it('prefere e-mail exato mesmo quando o nome também casaria por prefixo', () => {
    // "Francisco Rufs" prefixaria o usuarios "Francisco", mas o e-mail é exato.
    const r = vincularResponsavel(EQUIPE[2], USUARIOS, EQUIPE)
    expect(r).toEqual({ ok: true, usuario: USUARIOS[2], via: 'email' })
  })

  it('cai no fallback por nome quando não há e-mail e o match é único', () => {
    const usuarios: UsuarioRef[] = [{ id: 'u1', nome: 'Ana', email: 'ana@x.com' }]
    const membro: MembroEquipe = { authId: 'm1', nome: 'Ana Paula', email: 'apaula@login.com' }
    const r = vincularResponsavel(membro, usuarios, [membro])
    expect(r).toEqual({ ok: true, usuario: usuarios[0], via: 'nome' })
  })

  it('PARA (ambiguo) quando o nome casa com mais de um usuarios por prefixo', () => {
    const usuarios: UsuarioRef[] = [
      { id: 'u1', nome: 'Ana', email: 'ana@x.com' },
      { id: 'u2', nome: 'Ana Paula', email: 'anapaula@x.com' },
    ]
    const membro: MembroEquipe = { authId: 'm1', nome: 'Ana Paula Silva', email: 'aps@login.com' }
    const r = vincularResponsavel(membro, usuarios, [membro])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('ambiguo')
  })

  it('PARA (ambiguo) quando dois membros caem no mesmo usuarios só por nome', () => {
    // Regressão do bug real: "Francisco Rufs" e "Francisco Rufino" sem e-mail
    // exato, ambos prefixando o único usuarios "Francisco".
    const usuarios: UsuarioRef[] = [{ id: 'u-francisco', nome: 'Francisco', email: 'interno@x.com' }]
    const equipe: MembroEquipe[] = [
      { authId: 'a-rufino', nome: 'Francisco Rufino', email: 'rufino@login.com' },
      { authId: 'a-rufs', nome: 'Francisco Rufs', email: 'rufs@login.com' },
    ]
    for (const membro of equipe) {
      const r = vincularResponsavel(membro, usuarios, equipe)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toBe('ambiguo')
    }
  })

  it('devolve nao_encontrado quando não há e-mail nem nome que case', () => {
    const usuarios: UsuarioRef[] = [{ id: 'u1', nome: 'Beatriz', email: 'bea@x.com' }]
    const membro: MembroEquipe = { authId: 'm1', nome: 'Carlos Dias', email: 'carlos@login.com' }
    const r = vincularResponsavel(membro, usuarios, [membro])
    expect(r).toEqual({ ok: false, motivo: 'nao_encontrado' })
  })
})
