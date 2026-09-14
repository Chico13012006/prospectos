// Correção da base: reclassifica como `renovacao` os leads de UMA organização
// que têm data_validade e ainda estão num estágio de entrada/primeiro contato
// (ESTAGIOS_RECLASSIFICAVEIS_RENOVACAO). Núcleo de
// scripts/aplicar-estagio-renovacao.ts, separado para ser testável sem banco:
// recebe qualquer client com `query(sql, params)` (ex.: pg.Client).
//
// Travas:
//   - simulação por padrão: transação READ ONLY encerrada com ROLLBACK — o
//     próprio Postgres recusa qualquer escrita;
//   - gravação só com `confirmar` E `esperado` igual ao número encontrado;
//   - linhas travadas (FOR UPDATE) e UPDATE restrito aos IDs planejados, só na
//     coluna `estagio` (updated_at é carimbado pelo trigger da tabela);
//   - antes do COMMIT, prova por hash que os leads sem validade, os demais
//     leads da org e as outras organizações não mudaram, e que nos alterados só
//     estagio/updated_at mudaram. Qualquer divergência → ROLLBACK.
//
// Não liga a flag features.estagioRenovacaoPorValidade: essa é outra escrita,
// feita à parte (scripts/set-workspace-feature.ts).
import { parseWorkspaceConfig } from '../config/workspaceConfig'
import {
  ESTAGIO_RENOVACAO,
  ESTAGIOS_RECLASSIFICAVEIS_RENOVACAO,
  regraRenovacaoPorValidadeAtiva,
} from './estagioInicial'

export interface ClienteSql {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export interface LeadCandidatoRenovacao {
  id: string
  empresa: string | null
  estagio: string
  owner: string | null
  data_validade: string
}

export interface RelatorioEstagioRenovacao {
  modo: 'simulacao' | 'gravacao'
  org: { id: string; nome: string | null; regraAtiva: boolean }
  totais: { total: number; comValidade: number; semValidade: number }
  distribuicaoComValidade: { estagio: string; leads: number }[]
  candidatos: LeadCandidatoRenovacao[]
  // Com validade, mas em estágio comercial posterior — preservados.
  comValidadeForaDoFiltro: number
  leadsOutrasOrganizacoes: number
  gravacao?: { alterados: number; renovacaoNaOrganizacao: number }
}

export interface BackupEstagioRenovacao {
  tipo: 'estagio-renovacao'
  org: string
  geradoEm: string
  leads: { id: string; empresa: string | null; estagioAnterior: string }[]
}

export interface RelatorioReversaoEstagioRenovacao {
  modo: 'simulacao' | 'gravacao'
  noBackup: number
  revertiveis: BackupEstagioRenovacao['leads']
  // Já não estão em `renovacao` (movidos depois por pessoa ou automação):
  // ficam como estão.
  preservados: { id: string; estagioAtual: string | null }[]
  revertidos?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Cada consulta leva uma etiqueta: fica legível nos logs do banco e permite
// aos testes reconhecerem o passo.
const SQL = {
  org: `/* estagio-renovacao:org */ select id::text as id, nome, configuracoes from organizacoes where id = $1`,
  totais: `/* estagio-renovacao:totais */ select count(*)::int as total,
      count(*) filter (where data_validade is not null)::int as com_validade,
      count(*) filter (where data_validade is null)::int as sem_validade
    from leads where organizacao_id = $1`,
  distribuicao: `/* estagio-renovacao:distribuicao */ select coalesce(estagio, '(sem estágio)') as estagio, count(*)::int as leads
    from leads where organizacao_id = $1 and data_validade is not null
    group by 1 order by 2 desc, 1`,
  candidatos: `/* estagio-renovacao:candidatos */ select id::text as id, empresa, estagio, owner, data_validade::text as data_validade
    from leads
    where organizacao_id = $1 and data_validade is not null and estagio = any($2::text[])
    order by id`,
  // Impressão digital: quantidade + md5 da linha inteira, inclusive updated_at.
  // Qualquer escrita incidental nesses conjuntos muda o hash.
  impressaoSemValidade: `/* estagio-renovacao:impressao-sem-validade */ select count(*)::int as total,
      md5(coalesce(string_agg(l::text, '|' order by l.id), '')) as hash
    from leads l where l.organizacao_id = $1 and l.data_validade is null`,
  impressaoOrgForaDoAlvo: `/* estagio-renovacao:impressao-org-fora-do-alvo */ select count(*)::int as total,
      md5(coalesce(string_agg(l::text, '|' order by l.id), '')) as hash
    from leads l where l.organizacao_id = $1 and l.data_validade is not null and not (l.id = any($2::uuid[]))`,
  impressaoOutrasOrgs: `/* estagio-renovacao:impressao-outras-orgs */ select count(*)::int as total,
      md5(coalesce(string_agg(l::text, '|' order by l.id), '')) as hash
    from leads l where l.organizacao_id is distinct from $1::uuid`,
  // Nos alvos, tudo exceto as duas colunas que a gravação muda.
  impressaoAlvo: `/* estagio-renovacao:impressao-alvo */ select count(*)::int as total,
      md5(coalesce(string_agg((to_jsonb(l) - 'estagio' - 'updated_at')::text, '|' order by l.id), '')) as hash
    from leads l where l.organizacao_id = $1 and l.id = any($2::uuid[])`,
  atualizar: `/* estagio-renovacao:atualizar */ update leads set estagio = $3
    where organizacao_id = $1 and data_validade is not null
      and estagio = any($2::text[]) and id = any($4::uuid[])
    returning id::text as id`,
  conferirAlvo: `/* estagio-renovacao:conferir-alvo */ select count(*)::int as total
    from leads where organizacao_id = $1 and id = any($2::uuid[]) and estagio = $3`,
  contarRenovacao: `/* estagio-renovacao:contar-renovacao */ select count(*)::int as total
    from leads where organizacao_id = $1 and estagio = $2`,
  reverterAtuais: `/* estagio-renovacao:reverter-atuais */ select id::text as id, estagio
    from leads where organizacao_id = $1 and id = any($2::uuid[])
    order by id`,
  reverter: `/* estagio-renovacao:reverter */ update leads as l set estagio = x.anterior
    from unnest($2::uuid[], $3::text[]) as x(id, anterior)
    where l.id = x.id and l.organizacao_id = $1 and l.estagio = $4
    returning l.id::text as id`,
}

interface Impressao { total: number; hash: string }

async function linhas(db: ClienteSql, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  return (await db.query(sql, params)).rows
}

async function impressao(db: ClienteSql, sql: string, params: unknown[]): Promise<Impressao> {
  const [r] = await linhas(db, sql, params)
  return { total: Number(r?.total ?? 0), hash: String(r?.hash ?? '') }
}

async function impressoes(db: ClienteSql, org: string, ids: string[]) {
  return {
    semValidade: await impressao(db, SQL.impressaoSemValidade, [org]),
    orgForaDoAlvo: await impressao(db, SQL.impressaoOrgForaDoAlvo, [org, ids]),
    outrasOrgs: await impressao(db, SQL.impressaoOutrasOrgs, [org]),
    alvo: await impressao(db, SQL.impressaoAlvo, [org, ids]),
  }
}

const mesma = (a: Impressao, b: Impressao) => a.total === b.total && a.hash === b.hash
const textoOuNulo = (valor: unknown) => (valor == null ? null : String(valor))

export async function aplicarEstagioRenovacao(
  db: ClienteSql,
  opts: {
    org: string
    confirmar?: boolean
    esperado?: number
    // Chamado com o plano já travado, antes do UPDATE (ex.: gravar o backup).
    // Se lançar, nada é gravado.
    antesDeGravar?: (plano: RelatorioEstagioRenovacao) => Promise<void> | void
  },
): Promise<RelatorioEstagioRenovacao> {
  if (!UUID_RE.test(opts.org)) throw new Error('Informe o id (uuid) da organização.')
  const confirmar = opts.confirmar === true
  if (confirmar && !(Number.isInteger(opts.esperado) && (opts.esperado as number) > 0)) {
    throw new Error('Para gravar, informe --esperado com a quantidade vista na simulação.')
  }
  const estagios = [...ESTAGIOS_RECLASSIFICAVEIS_RENOVACAO]

  await db.query(confirmar ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY')
  let aberta = true
  try {
    const [orgRow] = await linhas(db, SQL.org, [opts.org])
    if (!orgRow) throw new Error(`Organização ${opts.org} não encontrada.`)
    const [totais] = await linhas(db, SQL.totais, [opts.org])
    const distribuicao = await linhas(db, SQL.distribuicao, [opts.org])
    const candidatos: LeadCandidatoRenovacao[] = (await linhas(
      db,
      confirmar ? `${SQL.candidatos}\n    for update` : SQL.candidatos,
      [opts.org, estagios],
    )).map((r) => ({
      id: String(r.id),
      empresa: textoOuNulo(r.empresa),
      estagio: String(r.estagio),
      owner: textoOuNulo(r.owner),
      data_validade: String(r.data_validade),
    }))
    const ids = candidatos.map((c) => c.id)
    const antes = await impressoes(db, opts.org, ids)

    const comValidade = Number(totais?.com_validade ?? 0)
    const relatorio: RelatorioEstagioRenovacao = {
      modo: confirmar ? 'gravacao' : 'simulacao',
      org: {
        id: opts.org,
        nome: textoOuNulo(orgRow.nome),
        regraAtiva: regraRenovacaoPorValidadeAtiva(parseWorkspaceConfig(orgRow.configuracoes)),
      },
      totais: { total: Number(totais?.total ?? 0), comValidade, semValidade: Number(totais?.sem_validade ?? 0) },
      distribuicaoComValidade: distribuicao.map((r) => ({ estagio: String(r.estagio), leads: Number(r.leads) })),
      candidatos,
      comValidadeForaDoFiltro: comValidade - candidatos.length,
      leadsOutrasOrganizacoes: antes.outrasOrgs.total,
    }

    if (!confirmar) {
      await db.query('ROLLBACK')
      aberta = false
      return relatorio
    }
    if (candidatos.length !== opts.esperado) {
      throw new Error(`Esperava ${opts.esperado} lead(s), encontrei ${candidatos.length}. Nada foi gravado.`)
    }
    await opts.antesDeGravar?.(relatorio)

    const atualizados = (await linhas(db, SQL.atualizar, [opts.org, estagios, ESTAGIO_RENOVACAO, ids]))
      .map((r) => String(r.id))
    const depois = await impressoes(db, opts.org, ids)
    const [conferido] = await linhas(db, SQL.conferirAlvo, [opts.org, ids, ESTAGIO_RENOVACAO])

    const falhas: string[] = []
    if (atualizados.length !== ids.length || atualizados.some((id) => !ids.includes(id))) {
      falhas.push(`UPDATE devolveu ${atualizados.length} linha(s), esperado ${ids.length}`)
    }
    if (Number(conferido?.total ?? 0) !== ids.length) falhas.push('nem todos os alvos ficaram em renovacao')
    if (!mesma(antes.semValidade, depois.semValidade)) falhas.push('leads sem validade mudaram')
    if (!mesma(antes.orgForaDoAlvo, depois.orgForaDoAlvo)) falhas.push('leads da organização fora do filtro mudaram')
    if (!mesma(antes.outrasOrgs, depois.outrasOrgs)) falhas.push('leads de outras organizações mudaram')
    if (!mesma(antes.alvo, depois.alvo)) falhas.push('campos além do estágio mudaram nos alvos')
    if (falhas.length) throw new Error(`Conferência falhou (${falhas.join('; ')}). ROLLBACK — nada foi gravado.`)

    await db.query('COMMIT')
    aberta = false
    const [renovacao] = await linhas(db, SQL.contarRenovacao, [opts.org, ESTAGIO_RENOVACAO])
    return {
      ...relatorio,
      gravacao: { alterados: atualizados.length, renovacaoNaOrganizacao: Number(renovacao?.total ?? 0) },
    }
  } catch (erro) {
    if (aberta) await db.query('ROLLBACK').catch(() => {})
    throw erro
  }
}

export function montarBackupEstagioRenovacao(
  plano: RelatorioEstagioRenovacao,
  geradoEm = new Date().toISOString(),
): BackupEstagioRenovacao {
  return {
    tipo: 'estagio-renovacao',
    org: plano.org.id,
    geradoEm,
    leads: plano.candidatos.map((c) => ({ id: c.id, empresa: c.empresa, estagioAnterior: c.estagio })),
  }
}

// Desfaz a correção a partir do backup. Só volta quem AINDA está em
// `renovacao`; quem foi movido depois é preservado. Simulação por padrão.
export async function reverterEstagioRenovacao(
  db: ClienteSql,
  opts: { org: string; backup: BackupEstagioRenovacao; confirmar?: boolean },
): Promise<RelatorioReversaoEstagioRenovacao> {
  if (!UUID_RE.test(opts.org)) throw new Error('Informe o id (uuid) da organização.')
  const { backup } = opts
  if (backup?.tipo !== 'estagio-renovacao' || backup.org !== opts.org || !Array.isArray(backup.leads)) {
    throw new Error('Backup inválido ou de outra organização.')
  }
  for (const lead of backup.leads) {
    if (!UUID_RE.test(lead.id) || !ESTAGIOS_RECLASSIFICAVEIS_RENOVACAO.includes(lead.estagioAnterior)) {
      throw new Error(`Backup inválido no lead ${lead.id}.`)
    }
  }
  const confirmar = opts.confirmar === true
  const ids = backup.leads.map((lead) => lead.id)

  await db.query(confirmar ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY')
  let aberta = true
  try {
    const atuais = new Map((await linhas(
      db,
      confirmar ? `${SQL.reverterAtuais}\n    for update` : SQL.reverterAtuais,
      [opts.org, ids],
    )).map((r) => [String(r.id), textoOuNulo(r.estagio)]))
    const revertiveis = backup.leads.filter((lead) => atuais.get(lead.id) === ESTAGIO_RENOVACAO)
    const relatorio: RelatorioReversaoEstagioRenovacao = {
      modo: confirmar ? 'gravacao' : 'simulacao',
      noBackup: backup.leads.length,
      revertiveis,
      preservados: backup.leads
        .filter((lead) => atuais.get(lead.id) !== ESTAGIO_RENOVACAO)
        .map((lead) => ({ id: lead.id, estagioAtual: atuais.get(lead.id) ?? null })),
    }
    if (!confirmar || revertiveis.length === 0) {
      await db.query('ROLLBACK')
      aberta = false
      return confirmar ? { ...relatorio, revertidos: 0 } : relatorio
    }

    const revertidos = await linhas(db, SQL.reverter, [
      opts.org,
      revertiveis.map((lead) => lead.id),
      revertiveis.map((lead) => lead.estagioAnterior),
      ESTAGIO_RENOVACAO,
    ])
    if (revertidos.length !== revertiveis.length) {
      throw new Error(`Reversão devolveu ${revertidos.length} linha(s), esperado ${revertiveis.length}. ROLLBACK.`)
    }
    await db.query('COMMIT')
    aberta = false
    return { ...relatorio, revertidos: revertidos.length }
  } catch (erro) {
    if (aberta) await db.query('ROLLBACK').catch(() => {})
    throw erro
  }
}
