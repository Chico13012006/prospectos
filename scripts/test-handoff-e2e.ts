/**
 * Teste E2E do handoff comercial (migration 0041) num Postgres LOCAL descartável.
 *
 * NUNCA roda contra produção: exige HANDOFF_E2E_DATABASE_URL apontando para
 * localhost/127.0.0.1 (não lê DATABASE_URL do .env.local de propósito).
 *
 *   docker run -d --rm --name prospectos-handoff-e2e -e POSTGRES_PASSWORD=e2e \
 *     -e POSTGRES_DB=e2e -p 55432:5432 postgres:17
 *   HANDOFF_E2E_DATABASE_URL=postgres://postgres:e2e@127.0.0.1:55432/e2e npx tsx scripts/test-handoff-e2e.ts
 *   docker stop prospectos-handoff-e2e
 *
 * O que prova (com o SERVIÇO real, lib/comercial/handoff, e a FUNÇÃO real da
 * migration, sobre um repository `pg` mínimo que espelha o Supabase):
 *   - a 0041 aplica num banco limpo e é idempotente (aplica 2x);
 *   - rodízio, reativação (cursor parado), idempotência por evento;
 *   - concorrência REAL (conexões paralelas + barreira p/ decidir sobre o mesmo
 *     cursor): compare-and-swap + advisory lock → comerciais diferentes;
 *   - atomicidade: falha no último passo (trigger que lança) desfaz cursor e
 *     registro juntos;
 *   - isolamento: FK composta barra usuário de outra org; RLS de leitura por
 *     org; função não executável por anon/authenticated.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { atribuirResponsavelHandoff } from '../lib/comercial/handoff/handoffService'
import { processarAcompanhamentoHandoff } from '../lib/comercial/handoff/acompanhamentoService'
import { processarComandoGrupo } from '../lib/comercial/grupo/comandoService'
import type { ComandoGrupoRegistro, ComandoGrupoRepository, NovoComandoGrupo } from '../lib/comercial/grupo/repository'
import type { NotificacaoHandoffRepository } from '../lib/comercial/notificacoes/repository'
import type { DadosAlertaHandoff, NotificacaoHandoff, TipoNotificacaoHandoff } from '../lib/comercial/notificacoes/types'
import type {
  DecisaoHandoff, HandoffRepository, HistoricoHandoffLead, LeadHandoffView, ResultadoConfirmacao,
} from '../lib/comercial/handoff/repository'
import type { ComercialParticipante, CursorDistribuicao, EntradaHandoff, RegistroHandoff } from '../lib/comercial/handoff/types'

const url = process.env.HANDOFF_E2E_DATABASE_URL
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('HANDOFF_E2E_DATABASE_URL ausente ou não-local. Este teste só roda em Postgres local descartável.')
  process.exit(1)
}

const results: [boolean, string][] = []
const ok = (nome: string, cond: boolean, detalhe?: unknown) => {
  results.push([cond, nome])
  console.log(`${cond ? '  ok ' : ' FAIL'} ${nome}${cond ? '' : ' → ' + JSON.stringify(detalhe)}`)
}

const pool = new pg.Pool({ connectionString: url, max: 8 })

// --- schema mínimo que a 0041 referencia (o Supabase real já tem tudo isso) ---
async function bootstrap() {
  await pool.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    -- Como no Supabase: toda tabela/função nova nasce acessível aos papéis da
    -- API; RLS (e o revoke explícito da função) é o que isola de verdade.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table if not exists organizacoes (id uuid primary key default gen_random_uuid(), nome text, configuracoes jsonb not null default '{}'::jsonb);
    create table if not exists usuarios (
      id uuid primary key default gen_random_uuid(), nome text not null, email text not null unique,
      ativo boolean default true, organizacao_id uuid not null references organizacoes(id));
    create table if not exists leads (
      id uuid primary key default gen_random_uuid(), organizacao_id uuid not null references organizacoes(id),
      responsavel_id uuid references usuarios(id) on delete set null, responsavel_nome text, estagio text,
      empresa text, contato_nome text);
    -- current_org_id() do Supabase lê auth.uid(); aqui lê um setting de sessão p/ testar RLS.
    create or replace function current_org_id() returns uuid language sql stable as
      $f$ select nullif(current_setting('app.org', true), '')::uuid $f$;
    create or replace function set_atualizado_em() returns trigger language plpgsql as
      $f$ begin new.atualizado_em := now(); return new; end $f$;
    grant select on organizacoes, usuarios, leads to authenticated;
  `)
}

async function aplicarMigration(arquivo = '0041_comercial_handoff.sql') {
  const sql = fs.readFileSync(path.join(process.cwd(), 'db/migrations', arquivo), 'utf8')
  const c = await pool.connect()
  try { await c.query('begin'); await c.query(sql); await c.query('commit') }
  catch (e) { await c.query('rollback'); throw e }
  finally { c.release() }
}

// --- repository `pg` mínimo (espelha SupabaseHandoffRepository) ---------------
function mapear(l: Record<string, unknown>): RegistroHandoff {
  return {
    id: l.id as string, organizacaoId: l.organizacao_id as string, leadId: l.lead_id as string,
    eventoId: l.evento_id as string, origem: l.origem as string,
    responsavelId: (l.responsavel_id as string | null) ?? null, motivo: (l.motivo as RegistroHandoff['motivo']) ?? null,
    primeiraAtribuicao: (l.primeira_atribuicao as boolean | null) ?? null, status: l.status as RegistroHandoff['status'],
    atribuidoEm: (l.atribuido_em as string | null) ?? null, encerradoEm: (l.encerrado_em as string | null) ?? null,
    encerradoMotivo: (l.encerrado_motivo as string | null) ?? null,
    criadoEm: l.criado_em as string,
  }
}

class PgHandoffRepository implements HandoffRepository {
  aoLerCursor?: (org: string) => Promise<void>
  constructor(private db: pg.Pool | pg.PoolClient) {}
  async buscarLead(org: string, leadId: string): Promise<LeadHandoffView | null> {
    const r = await this.db.query('select id, responsavel_id, empresa, contato_nome from leads where organizacao_id=$1 and id=$2', [org, leadId])
    return r.rows[0] ? { id: r.rows[0].id, responsavelId: r.rows[0].responsavel_id, empresa: r.rows[0].empresa ?? '', contatoNome: r.rows[0].contato_nome ?? '' } : null
  }
  async buscarHandoffAberto(org: string, leadId: string): Promise<RegistroHandoff | null> {
    const r = await this.db.query('select * from comercial_handoffs where organizacao_id=$1 and lead_id=$2 and encerrado_em is null limit 1', [org, leadId])
    return r.rows[0] ? mapear(r.rows[0]) : null
  }
  async buscarHistorico(org: string, leadId: string): Promise<HistoricoHandoffLead> {
    const r = await this.db.query(
      `select responsavel_id from comercial_handoffs where organizacao_id=$1 and lead_id=$2 and status='em_contato_comercial' order by criado_em desc limit 1`, [org, leadId])
    const ultimo = r.rows[0]
    if (!ultimo) return { jaTeveAtribuicao: false, responsavelPreservavel: null }
    if (!ultimo.responsavel_id) return { jaTeveAtribuicao: true, responsavelPreservavel: null }
    const u = await this.db.query('select id, nome from usuarios where organizacao_id=$1 and id=$2 and ativo=true', [org, ultimo.responsavel_id])
    return { jaTeveAtribuicao: true, responsavelPreservavel: u.rows[0] ? { usuarioId: u.rows[0].id, nome: u.rows[0].nome } : null }
  }
  async listarDistribuicao(org: string): Promise<ComercialParticipante[]> {
    const r = await this.db.query(
      `select u.id, u.nome, u.email, coalesce(p.participa, false) as participa
         from usuarios u left join comercial_distribuicao_participantes p on p.usuario_id = u.id and p.organizacao_id = u.organizacao_id
        where u.organizacao_id=$1 and u.ativo=true order by u.nome`, [org])
    return r.rows.map((u) => ({ usuarioId: u.id, nome: u.nome, email: u.email, participa: u.participa }))
  }
  async lerCursor(org: string): Promise<CursorDistribuicao> {
    await this.aoLerCursor?.(org)
    const r = await this.db.query('select ultimo_usuario_id, versao from comercial_distribuicao_cursor where organizacao_id=$1', [org])
    return r.rows[0] ? { ultimoUsuarioId: r.rows[0].ultimo_usuario_id, versao: Number(r.rows[0].versao) } : { ultimoUsuarioId: null, versao: 0 }
  }
  async confirmar(e: EntradaHandoff, d: DecisaoHandoff): Promise<ResultadoConfirmacao> {
    const r = await this.db.query('select comercial_handoff_confirmar($1,$2,$3,$4,$5,$6,$7,$8) as r',
      [e.organizacaoId, e.leadId, e.eventoId, e.origem, d.responsavelId, d.motivo, d.primeiraAtribuicao, d.cursorVersaoEsperada])
    const j = r.rows[0].r as { resultado: ResultadoConfirmacao['resultado']; handoff?: Record<string, unknown> }
    return j.handoff ? { resultado: j.resultado as 'confirmado', handoff: mapear(j.handoff) } : { resultado: j.resultado as 'conflito_cursor' }
  }
  async buscarHandoff(org: string, handoffId: string): Promise<RegistroHandoff | null> {
    const r = await this.db.query('select * from comercial_handoffs where organizacao_id=$1 and id=$2', [org, handoffId])
    return r.rows[0] ? mapear(r.rows[0]) : null
  }
  async encerrar(org: string, handoffId: string, motivo: string): Promise<'encerrado' | 'ja_encerrado' | 'nao_encontrado'> {
    const r = await this.db.query('update comercial_handoffs set encerrado_em=now(), encerrado_motivo=$3 where organizacao_id=$1 and id=$2 and encerrado_em is null returning id', [org, handoffId, motivo])
    if (r.rows.length) return 'encerrado'
    return (await this.buscarHandoff(org, handoffId)) ? 'ja_encerrado' : 'nao_encontrado'
  }
  async listarAbertos(org: string, limite: number): Promise<RegistroHandoff[]> {
    const r = await this.db.query(
      `select * from comercial_handoffs where organizacao_id=$1 and status='em_contato_comercial' and encerrado_em is null
        and responsavel_id is not null order by atribuido_em asc limit $2`,
      [org, limite])
    return r.rows.map(mapear)
  }
  async definirParticipacao(org: string, usuarioId: string, participa: boolean) {
    const u = await this.db.query('select 1 from usuarios where organizacao_id=$1 and id=$2 and ativo=true', [org, usuarioId])
    if (!u.rows[0]) return 'usuario_nao_encontrado' as const
    await this.db.query(
      `insert into comercial_distribuicao_participantes (organizacao_id, usuario_id, participa) values ($1,$2,$3)
       on conflict (organizacao_id, usuario_id) do update set participa = excluded.participa`, [org, usuarioId, participa])
    return 'ok' as const
  }
}

// --- cenário -------------------------------------------------------------------
async function seed() {
  await pool.query(`truncate comercial_handoffs, comercial_distribuicao_cursor, comercial_distribuicao_participantes, leads, usuarios, organizacoes cascade`)
  const orgs = await pool.query(`insert into organizacoes (nome) values ('A'), ('B') returning id`)
  const [A, B] = orgs.rows.map((r) => r.id as string)
  const us = await pool.query(
    `insert into usuarios (nome, email, organizacao_id) values
     ('Bruno','bruno@a',$1), ('Silmara','silmara@a',$1), ('Guilherme','guilherme@a',$1), ('João','joao@a',$1), ('BOOM','boom@a',$1),
     ('Ana','ana@b',$2), ('Caio','caio@b',$2) returning id, nome, organizacao_id`, [A, B])
  const u = Object.fromEntries(us.rows.map((r) => [r.nome, r.id as string]))
  const leads = await pool.query(
    `insert into leads (organizacao_id, responsavel_id, responsavel_nome, estagio, empresa, contato_nome)
     select $1::uuid, $2::uuid, 'sdr', 'interessado', 'Empresa ' || g, 'Contato ' || g from generate_series(1, 10) g
     union all select $3::uuid, null::uuid, null::text, 'interessado', 'Org B ' || g, 'Caio ' || g from generate_series(1, 4) g returning id, organizacao_id`, [A, u.Bruno, B])
  const la = leads.rows.filter((r) => r.organizacao_id === A).map((r) => r.id as string)
  const lb = leads.rows.filter((r) => r.organizacao_id === B).map((r) => r.id as string)
  return { A, B, u, la, lb }
}

const mapN = (l: Record<string, unknown>): NotificacaoHandoff => ({
  id: l.id as string, organizacaoId: l.organizacao_id as string, handoffId: l.handoff_id as string,
  tipo: l.tipo as TipoNotificacaoHandoff, status: l.status as NotificacaoHandoff['status'], tentativas: Number(l.tentativas),
  ultimoErro: (l.ultimo_erro as string | null) ?? null, dados: l.dados as DadosAlertaHandoff, destino: (l.destino as string | null) ?? null,
  providerMessageId: (l.provider_message_id as string | null) ?? null, enviadoEm: (l.enviado_em as string | null) ?? null, criadoEm: String(l.criado_em),
  codigoRef: (l.codigo_ref as string | null) ?? null,
})
const q = (sql: string, params: unknown[]) => pool.query(sql, params)
function notifRepoDe(): NotificacaoHandoffRepository {
  return {
  async registrarIntencao(org, handoffId, tipo, dados, opcoes = {}) {
    await q('insert into comercial_handoff_notificacoes (organizacao_id, handoff_id, tipo, dados, codigo_ref) values ($1,$2,$3,$4,$5) on conflict (handoff_id, tipo) do nothing', [org, handoffId, tipo, dados, opcoes.codigoRef ?? null])
    const r = await q('select * from comercial_handoff_notificacoes where organizacao_id=$1 and handoff_id=$2 and tipo=$3', [org, handoffId, tipo])
    return mapN(r.rows[0])
  },
  async buscar(org, id) { const r = await q('select * from comercial_handoff_notificacoes where organizacao_id=$1 and id=$2', [org, id]); return r.rows[0] ? mapN(r.rows[0]) : null },
  async buscarPorCodigo(org, codigo) { const r = await q('select * from comercial_handoff_notificacoes where organizacao_id=$1 and codigo_ref=$2', [org, codigo]); return r.rows[0] ? mapN(r.rows[0]) : null },
  async reivindicarEnvio(org, id, t) {
    const r = await q("update comercial_handoff_notificacoes set status='enviando', tentativas=$3+1 where organizacao_id=$1 and id=$2 and status in ('pendente','falhou','configuracao_ausente') and tentativas=$3 returning id", [org, id, t])
    return r.rows.length === 1
  },
  async marcarEnviada(org, id, info) { await q("update comercial_handoff_notificacoes set status='enviada', destino=$3, provider_message_id=$4, enviado_em=now() where organizacao_id=$1 and id=$2", [org, id, info.destino, info.providerMessageId]) },
  async marcarFalha(org, id, erro) { await q("update comercial_handoff_notificacoes set status='falhou', ultimo_erro=$3 where organizacao_id=$1 and id=$2", [org, id, erro]) },
  async marcarConfiguracaoAusente(org, id, erro) { await q("update comercial_handoff_notificacoes set status='configuracao_ausente', ultimo_erro=$3 where organizacao_id=$1 and id=$2 and status in ('pendente','falhou','configuracao_ausente')", [org, id, erro]) },
  async listarReprocessaveis(org, teto, limite) { const r = await q("select * from comercial_handoff_notificacoes where organizacao_id=$1 and status in ('pendente','falhou','configuracao_ausente') and tentativas < $2 order by criado_em limit $3", [org, teto, limite]); return r.rows.map(mapN) },
  async listarPorHandoffs(org, tipo, ids) { if (!ids.length) return []; const r = await q('select * from comercial_handoff_notificacoes where organizacao_id=$1 and tipo=$2 and handoff_id = any($3)', [org, tipo, ids]); return r.rows.map(mapN) },
  }
}

// --- repository `pg` dos comandos do grupo (espelha SupabaseComandoGrupoRepository) ---
class PgComandoRepository implements ComandoGrupoRepository {
  antesDeReivindicar?: () => Promise<void>
  constructor(private db: pg.Pool | pg.PoolClient = pool) {}
  private map(l: Record<string, unknown>): ComandoGrupoRegistro {
    return {
      id: l.id as string, organizacaoId: l.organizacao_id as string, grupoId: l.grupo_id as string, providerMessageId: l.provider_message_id as string,
      remetente: (l.remetente as string | null) ?? null, remetenteNome: (l.remetente_nome as string | null) ?? null, texto: l.texto as string,
      codigoRef: (l.codigo_ref as string | null) ?? null, comando: (l.comando as ComandoGrupoRegistro['comando']) ?? null,
      handoffId: (l.handoff_id as string | null) ?? null, notificacaoId: (l.notificacao_id as string | null) ?? null,
      status: l.status as ComandoGrupoRegistro['status'], resultado: (l.resultado as string | null) ?? null, erro: (l.erro as string | null) ?? null,
      recebidoEm: String(l.recebido_em), processadoEm: l.processado_em ? String(l.processado_em) : null, atualizadoEm: String(l.atualizado_em),
    }
  }
  async resolverOrganizacoesDoGrupo(grupoId: string) {
    const r = await this.db.query("select id from organizacoes where configuracoes->'comercial'->>'grupoWhatsappId' = $1 limit 5", [grupoId])
    return r.rows.map((x) => x.id as string)
  }
  async registrar(org: string, n: NovoComandoGrupo) {
    const ins = await this.db.query(`insert into comercial_grupo_comandos (organizacao_id, grupo_id, provider_message_id, remetente, remetente_nome, texto, codigo_ref, comando, recebido_em)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (organizacao_id, provider_message_id) do nothing returning *`,
      [org, n.grupoId, n.providerMessageId, n.remetente, n.remetenteNome, n.texto, n.codigoRef, n.comando, n.recebidoEm])
    if (ins.rows[0]) return { comando: this.map(ins.rows[0]), novo: true }
    const r = await this.db.query('select * from comercial_grupo_comandos where organizacao_id=$1 and provider_message_id=$2', [org, n.providerMessageId])
    return { comando: this.map(r.rows[0]), novo: false }
  }
  async reivindicar(org: string, id: string, presoDesdeISO: string) {
    await this.antesDeReivindicar?.()
    const r = await this.db.query(`update comercial_grupo_comandos set status='processando' where organizacao_id=$1 and id=$2
      and (status in ('recebido','falhou') or (status='processando' and atualizado_em < $3)) returning id`, [org, id, presoDesdeISO])
    return r.rows.length === 1
  }
  async concluir(org: string, id: string, d: { status: 'concluido' | 'ignorado'; resultado: string; handoffId?: string | null; notificacaoId?: string | null }) {
    await this.db.query(`update comercial_grupo_comandos set status=$3, resultado=$4, erro=null, processado_em=now(), handoff_id=coalesce($5, handoff_id), notificacao_id=coalesce($6, notificacao_id) where organizacao_id=$1 and id=$2`, [org, id, d.status, d.resultado, d.handoffId ?? null, d.notificacaoId ?? null])
  }
  async falhar(org: string, id: string, resultado: string, erro: string, refs: { handoffId?: string | null; notificacaoId?: string | null } = {}) {
    await this.db.query(`update comercial_grupo_comandos set status='falhou', resultado=$3, erro=$4, handoff_id=coalesce($5, handoff_id), notificacao_id=coalesce($6, notificacao_id) where organizacao_id=$1 and id=$2`, [org, id, resultado, erro, refs.handoffId ?? null, refs.notificacaoId ?? null])
  }
  async listarReprocessaveis(org: string, presoDesdeISO: string, limite: number) {
    const r = await this.db.query(`select * from comercial_grupo_comandos where organizacao_id=$1 and (status in ('recebido','falhou') or (status='processando' and atualizado_em < $2)) order by recebido_em limit $3`, [org, presoDesdeISO, limite])
    return r.rows.map((l) => this.map(l))
  }
}

const entrada = (org: string, leadId: string, eventoId: string): EntradaHandoff => ({ organizacaoId: org, leadId, eventoId, origem: 'prospeccao' })

async function main() {
  console.log('bootstrap + migrations 0041/0042 (2x, idempotência)')
  await bootstrap()
  await aplicarMigration('0041_comercial_handoff.sql')
  await aplicarMigration('0041_comercial_handoff.sql')
  ok('migration 0041 aplica em banco limpo e reaplica sem erro', true)
  await aplicarMigration('0042_comercial_handoff_notificacoes.sql')
  await aplicarMigration('0042_comercial_handoff_notificacoes.sql')
  ok('migration 0042 aplica sobre a 0041 e reaplica sem erro', true)
  await aplicarMigration('0043_comercial_handoff_checkin.sql')
  await aplicarMigration('0043_comercial_handoff_checkin.sql')
  ok('migration 0043 aplica sobre a 0042 e reaplica sem erro', true)
  await aplicarMigration('0044_comercial_grupo_comandos.sql')
  await aplicarMigration('0044_comercial_grupo_comandos.sql')
  ok('migration 0044 aplica sobre a 0043 e reaplica sem erro', true)

  const { A, B, u, la, lb } = await seed()
  const repo = new PgHandoffRepository(pool)
  for (const n of ['Bruno', 'Silmara', 'Guilherme']) await repo.definirParticipacao(A, u[n], true)
  for (const n of ['Ana', 'Caio']) await repo.definirParticipacao(B, u[n], true)

  // 1) rodízio
  const nomes: string[] = []
  for (let i = 0; i < 4; i++) {
    const r = await atribuirResponsavelHandoff(repo, entrada(A, la[i], `ev-${i}`))
    nomes.push(r.tipo === 'atribuido' ? r.responsavel.nome : r.tipo)
  }
  ok('rodízio Bruno → Guilherme → Silmara → Bruno', JSON.stringify(nomes) === JSON.stringify(['Bruno', 'Guilherme', 'Silmara', 'Bruno']), nomes)
  const lead0 = await pool.query('select responsavel_id, responsavel_nome from leads where id=$1', [la[0]])
  ok('leads.responsavel_id/nome espelhados', lead0.rows[0].responsavel_id === u.Bruno && lead0.rows[0].responsavel_nome === 'Bruno', lead0.rows[0])
  const cursorA = await repo.lerCursor(A)
  ok('cursor A = Bruno / versão 4', cursorA.ultimoUsuarioId === u.Bruno && cursorA.versao === 4, cursorA)
  ok('cursor B intacto', (await repo.lerCursor(B)).versao === 0)

  // 2) idempotência por evento + lead já em contato
  const dup = await atribuirResponsavelHandoff(repo, entrada(A, la[0], 'ev-0'))
  const outro = await atribuirResponsavelHandoff(repo, entrada(A, la[0], 'ev-outro'))
  ok('mesmo evento → ja_processado; outro evento → ja_em_contato_comercial', dup.tipo === 'ja_processado' && outro.tipo === 'ja_em_contato_comercial', [dup.tipo, outro.tipo])
  ok('cursor não andou', (await repo.lerCursor(A)).versao === 4)
  ok('um único registro para o lead', (await pool.query('select count(*)::int c from comercial_handoffs where lead_id=$1', [la[0]])).rows[0].c === 1)

  // 3) reativação: encerra o handoff (fase futura), troca o responsável "por fora", responde de novo
  await pool.query(`update comercial_handoffs set encerrado_em = now() where lead_id=$1`, [la[0]])
  await pool.query(`update leads set responsavel_id=$2 where id=$1`, [la[0], u.Silmara])
  await repo.definirParticipacao(A, u.Bruno, false) // Bruno de férias
  const re = await atribuirResponsavelHandoff(repo, entrada(A, la[0], 'ev-reativacao'))
  ok('reativação preserva Bruno (fora do rodízio) sem avançar cursor',
    re.tipo === 'atribuido' && re.motivo === 'reativacao' && !re.primeiraAtribuicao && re.responsavel.id === u.Bruno && (await repo.lerCursor(A)).versao === 4, re)
  const prox = await atribuirResponsavelHandoff(repo, entrada(A, la[4], 'ev-4'))
  ok('próximo lead novo pula Bruno (férias): Guilherme', prox.tipo === 'atribuido' && prox.responsavel.nome === 'Guilherme', prox)
  await repo.definirParticipacao(A, u.Bruno, true)

  // 4) concorrência REAL: 3 conexões, barreira para decidirem sobre o MESMO cursor
  {
    const clientes = await Promise.all([pool.connect(), pool.connect(), pool.connect()])
    let chegaram = 0; let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    const repos = clientes.map((c) => { const r = new PgHandoffRepository(c); r.aoLerCursor = async () => { if (++chegaram === 3) liberar(); await barreira }; return r })
    const antes = (await repo.lerCursor(A)).versao
    const rs = await Promise.all([5, 6, 7].map((i, k) => atribuirResponsavelHandoff(repos[k], entrada(A, la[i], `ev-${i}`))))
    clientes.forEach((c) => c.release())
    const ids = rs.map((r) => (r.tipo === 'atribuido' ? r.responsavel.nome : r.tipo)).sort()
    ok('3 handoffs simultâneos sobre o mesmo cursor → 3 comerciais DIFERENTES', JSON.stringify(ids) === JSON.stringify(['Bruno', 'Guilherme', 'Silmara']), ids)
    ok('cursor avançou exatamente 3', (await repo.lerCursor(A)).versao === antes + 3)
  }

  // 5) evento duplicado em corrida real
  {
    const clientes = await Promise.all([pool.connect(), pool.connect()])
    let chegaram = 0; let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    const repos = clientes.map((c) => { const r = new PgHandoffRepository(c); r.aoLerCursor = async () => { if (++chegaram === 2) liberar(); await barreira }; return r })
    const antes = (await repo.lerCursor(A)).versao
    const rs = await Promise.all(repos.map((r) => atribuirResponsavelHandoff(r, entrada(A, la[8], 'ev-dup'))))
    clientes.forEach((c) => c.release())
    const tipos = rs.map((r) => r.tipo).sort()
    ok('evento duplicado em corrida → 1 atribuido + 1 ja_processado, 1 turno', JSON.stringify(tipos) === JSON.stringify(['atribuido', 'ja_processado']) && (await repo.lerCursor(A)).versao === antes + 1, tipos)
    ok('um único registro', (await pool.query('select count(*)::int c from comercial_handoffs where lead_id=$1', [la[8]])).rows[0].c === 1)
  }

  // 6) atomicidade: trigger de teste faz o ÚLTIMO passo (update leads) falhar
  {
    await pool.query(`create or replace function e2e_boom() returns trigger language plpgsql as $f$
      begin if new.responsavel_nome = 'BOOM' then raise exception 'boom'; end if; return new; end $f$;
      drop trigger if exists e2e_boom on leads; create trigger e2e_boom before update on leads for each row execute function e2e_boom();`)
    const antes = await repo.lerCursor(A)
    const nReg = (await pool.query('select count(*)::int c from comercial_handoffs')).rows[0].c
    let lancou = false
    try {
      await repo.confirmar(entrada(A, la[9], 'ev-boom'), { responsavelId: u.BOOM, motivo: 'reativacao', primeiraAtribuicao: false, cursorVersaoEsperada: null })
    } catch { lancou = true }
    let lancouRR = false
    await repo.definirParticipacao(A, u.BOOM, true)
    try {
      await repo.confirmar(entrada(A, la[9], 'ev-boom-rr'), { responsavelId: u.BOOM, motivo: 'round_robin', primeiraAtribuicao: true, cursorVersaoEsperada: antes.versao })
    } catch { lancouRR = true }
    await repo.definirParticipacao(A, u.BOOM, false)
    const depois = await repo.lerCursor(A)
    const nReg2 = (await pool.query('select count(*)::int c from comercial_handoffs')).rows[0].c
    const lead9 = (await pool.query('select responsavel_id from leads where id=$1', [la[9]])).rows[0]
    ok('falha no último passo → exceção e NADA gravado (cursor, registro, lead)',
      lancou && lancouRR && depois.versao === antes.versao && depois.ultimoUsuarioId === antes.ultimoUsuarioId && nReg2 === nReg && lead9.responsavel_id === u.Bruno,
      { lancou, lancouRR, antes, depois, nReg, nReg2, lead9 })
    await pool.query('drop trigger if exists e2e_boom on leads')
  }

  // 7) sem comercial → pendente recuperável
  {
    for (const n of ['Ana', 'Caio']) await repo.definirParticipacao(B, u[n], false)
    const p1 = await atribuirResponsavelHandoff(repo, entrada(B, lb[0], 'ev-b0'))
    const p2 = await atribuirResponsavelHandoff(repo, entrada(B, lb[0], 'ev-b0'))
    ok('sem participante → aguardando_distribuicao, sem duplicar', p1.tipo === 'aguardando_distribuicao' && p2.tipo === 'aguardando_distribuicao'
      && (await pool.query('select count(*)::int c from comercial_handoffs where lead_id=$1', [lb[0]])).rows[0].c === 1, [p1.tipo, p2.tipo])
    await repo.definirParticipacao(B, u.Caio, true)
    const p3 = await atribuirResponsavelHandoff(repo, entrada(B, lb[0], 'ev-b0'))
    ok('pendente concluído no MESMO registro quando alguém volta', p3.tipo === 'atribuido' && p3.responsavel.nome === 'Caio' && p3.primeiraAtribuicao === true
      && p1.tipo === 'aguardando_distribuicao' && p3.handoff.id === p1.handoff.id, p3)
  }

  // 8) isolamento
  {
    let fkBarrou = false
    try { await pool.query('insert into comercial_distribuicao_participantes (organizacao_id, usuario_id) values ($1, $2)', [A, u.Ana]) } catch { fkBarrou = true }
    ok('FK composta barra usuário da org B na distribuição da org A', fkBarrou)
    const cross = await atribuirResponsavelHandoff(repo, entrada(A, lb[1], 'ev-cross'))
    ok('lead da org B chamado como org A → lead_nao_encontrado', cross.tipo === 'lead_nao_encontrado')

    const c = await pool.connect()
    try {
      await c.query('set role authenticated')
      await c.query(`select set_config('app.org', $1, false)`, [A])
      const vistoA = (await c.query('select count(*)::int c from comercial_handoffs')).rows[0].c
      const totalA = (await pool.query('select count(*)::int c from comercial_handoffs where organizacao_id=$1', [A])).rows[0].c
      await c.query(`select set_config('app.org', $1, false)`, [B])
      const vistoB = (await c.query('select count(*)::int c from comercial_handoffs')).rows[0].c
      const totalB = (await pool.query('select count(*)::int c from comercial_handoffs where organizacao_id=$1', [B])).rows[0].c
      const partB = (await c.query('select count(*)::int c from comercial_distribuicao_participantes')).rows[0].c
      const totalPartB = (await pool.query('select count(*)::int c from comercial_distribuicao_participantes where organizacao_id=$1', [B])).rows[0].c
      ok('RLS: authenticated da org A vê só handoffs de A; da org B só de B (idem participantes)',
        vistoA === totalA && vistoB === totalB && totalA > 0 && totalB > 0 && partB === totalPartB, { vistoA, totalA, vistoB, totalB, partB, totalPartB })
      let negado = false
      try { await c.query('insert into comercial_distribuicao_cursor (organizacao_id) values ($1)', [B]) } catch { negado = true }
      ok('RLS: authenticated não escreve (sem policy de escrita)', negado)
      let fnNegada = false
      try { await c.query('select comercial_handoff_confirmar($1,$2,$3,$4,null,null,null,null)', [B, lb[2], 'x', 'manual']) } catch { fnNegada = true }
      ok('função não executável por authenticated', fnNegada)
      await c.query('reset role')
    } finally { c.release() }
  }

  // 9) outbox de notificações (0042): unique por handoff+tipo, CAS de
  //    reivindicação sob concorrência real, coerência de status e RLS.
  {
    const h = (await pool.query(`select id from comercial_handoffs where organizacao_id=$1 and status='em_contato_comercial' limit 1`, [A])).rows[0].id
    const dados = { empresa: 'ACME', contato: 'Ana', responsavelNome: 'Bruno', motivo: 'round_robin', etapaCadencia: 'follow-up 2' }
    const ins = `insert into comercial_handoff_notificacoes (organizacao_id, handoff_id, tipo, dados) values ($1,$2,'grupo_comercial',$3) on conflict (handoff_id, tipo) do nothing returning id`
    const r1 = await pool.query(ins, [A, h, dados])
    const r2 = await pool.query(ins, [A, h, dados])
    ok('uma intenção por handoff+tipo (2º insert é no-op)', r1.rows.length === 1 && r2.rows.length === 0)
    const nid = r1.rows[0].id as string

    // 3 processadores reivindicam ao mesmo tempo com o mesmo `tentativas` esperado.
    const claim = `update comercial_handoff_notificacoes set status='enviando', tentativas=tentativas+1
                   where organizacao_id=$1 and id=$2 and status in ('pendente','falhou','configuracao_ausente') and tentativas=$3 returning id`
    const rs = await Promise.all([0, 0, 0].map((t) => pool.query(claim, [A, nid, t])))
    ok('reivindicação concorrente: exatamente 1 vence o compare-and-swap', rs.filter((r) => r.rows.length === 1).length === 1)
    const depois = (await pool.query('select status, tentativas from comercial_handoff_notificacoes where id=$1', [nid])).rows[0]
    ok("status 'enviando' com tentativas=1", depois.status === 'enviando' && depois.tentativas === 1, depois)

    let checkBarrou = false
    try { await pool.query(`update comercial_handoff_notificacoes set status='enviada' where id=$1`, [nid]) } catch { checkBarrou = true }
    ok("CHECK: 'enviada' exige enviado_em", checkBarrou)
    await pool.query(`update comercial_handoff_notificacoes set status='enviada', enviado_em=now(), provider_message_id='z1' where id=$1`, [nid])

    const c = await pool.connect()
    try {
      await c.query('set role authenticated')
      await c.query(`select set_config('app.org', $1, false)`, [B])
      const vistoB = (await c.query('select count(*)::int c from comercial_handoff_notificacoes')).rows[0].c
      await c.query(`select set_config('app.org', $1, false)`, [A])
      const vistoA = (await c.query('select count(*)::int c from comercial_handoff_notificacoes')).rows[0].c
      ok('RLS: notificações visíveis só para a própria org', vistoB === 0 && vistoA === 1, { vistoA, vistoB })
      let negado = false
      try { await c.query(`update comercial_handoff_notificacoes set status='pendente' where id=$1`, [nid]) ; negado = (await c.query('select status from comercial_handoff_notificacoes where id=$1', [nid])).rows[0]?.status === 'enviada' } catch { negado = true }
      ok('RLS: authenticated não altera o outbox', negado)
      await c.query('reset role')
    } finally { c.release() }
  }

  // 10) Fase 3 — check-in de 7 dias sobre o outbox real (0043), relógio injetado.
  {
    const notifRepo = notifRepoDe()
    const mensagens: string[] = []
    const deps = {
      handoff: repo,
      notificacoes: { repo: notifRepo, enviar: async (_g: string, m: string) => { mensagens.push(m); return { ok: true as const, providerMessageId: 'z-checkin' } }, lerGrupoId: async () => '120363019502650977-group' },
      lerJanelaMinutos: async () => 5,
      // "6 minutos no futuro": tudo que foi atribuído neste teste venceu a janela de 5 min.
      agora: () => new Date(Date.now() + 6 * 60_000),
    }
    const abertos = (await q("select count(*)::int c from comercial_handoffs where organizacao_id=$1 and status='em_contato_comercial' and encerrado_em is null and responsavel_id is not null", [A])).rows[0].c
    const cursorAntes = await repo.lerCursor(A)
    const r1 = await processarAcompanhamentoHandoff(deps, A)
    ok('check-in: todos os handoffs abertos vencidos recebem UMA pergunta', r1.vencidos === abertos && r1.enviados === abertos && mensagens.length === abertos, { abertos, v: r1.vencidos, e: r1.enviados, p: r1.pendentes, i: r1.ignorados })
    ok('check-in: texto com @responsável e tempo', mensagens.every((m) => m.startsWith('ACOMPANHAMENTO COMERCIAL') && /@\S+, como ficou o lead/.test(m) && m.includes('Em contato comercial há ')), mensagens[0])
    const r2 = await processarAcompanhamentoHandoff(deps, A)
    ok('check-in: segundo ciclo não duplica (ja_enviados)', r2.enviados === 0 && r2.jaEnviados === abertos && mensagens.length === abertos, { e: r2.enviados, j: r2.jaEnviados })
    const tipos = (await q("select tipo, count(*)::int c from comercial_handoff_notificacoes where organizacao_id=$1 group by tipo", [A])).rows
    ok('outbox aceita o tipo handoff_checkin (0043) — uma linha por handoff', tipos.some((t) => t.tipo === 'handoff_checkin' && t.c === abertos), tipos)
    const encerradoNaoRecebe = (await q("select count(*)::int c from comercial_handoff_notificacoes n join comercial_handoffs h on h.id = n.handoff_id where n.tipo='handoff_checkin' and h.encerrado_em is not null", [])).rows[0].c
    ok('check-in: handoff encerrado não recebe pergunta', encerradoNaoRecebe === 0)
    const cursorDepois = await repo.lerCursor(A)
    ok('check-in: cursor do rodízio intocado', cursorDepois.versao === cursorAntes.versao && cursorDepois.ultimoUsuarioId === cursorAntes.ultimoUsuarioId)
    ok('check-in: nenhum handoff mudou de status/responsável', (await q("select count(*)::int c from comercial_handoffs where organizacao_id=$1 and status='em_contato_comercial' and encerrado_em is null and responsavel_id is not null", [A])).rows[0].c === abertos)
  }

  // 11) Fase 4 — 0044: comandos do grupo (unique/idempotência, claim concorrente),
  //     grupo único entre orgs, código único, transição para follow-up e reativação.
  {
    const cmdRepo = new PgComandoRepository()
    const notifRepoF4 = notifRepoDe()
    // Grupo configurado na org A; tentar configurar o MESMO grupo na B → índice único barra.
    await q(`update organizacoes set configuracoes = coalesce(configuracoes,'{}'::jsonb) || $2::jsonb where id=$1`, [A, JSON.stringify({ comercial: { grupoWhatsappId: '120363019502650977-group' } })])
    let grupoDuplicadoBarrado = false
    try { await q(`update organizacoes set configuracoes = coalesce(configuracoes,'{}'::jsonb) || $2::jsonb where id=$1`, [B, JSON.stringify({ comercial: { grupoWhatsappId: '120363019502650977-group' } })]) } catch { grupoDuplicadoBarrado = true }
    ok('0044: duas organizações não podem configurar o mesmo grupo (índice único)', grupoDuplicadoBarrado)
    ok('grupo → organização resolve exatamente A', JSON.stringify(await cmdRepo.resolverOrganizacoesDoGrupo('120363019502650977-group')) === JSON.stringify([A]))

    // Handoff aberto com check-in (código) na org A: pega um que já tem check-in enviado.
    const ck = (await q(`select n.id, n.handoff_id, n.codigo_ref from comercial_handoff_notificacoes n join comercial_handoffs h on h.id=n.handoff_id where n.tipo='handoff_checkin' and h.encerrado_em is null and h.organizacao_id=$1 limit 1`, [A])).rows[0]
    ok('check-in gravado com codigo_ref único (0044)', !!ck?.codigo_ref && /^[A-Z2-9]{6}$/.test(ck.codigo_ref), ck)
    let codigoDuplicadoBarrado = false
    try { await q(`insert into comercial_handoff_notificacoes (organizacao_id, handoff_id, tipo, dados, codigo_ref) values ($1, (select id from comercial_handoffs where organizacao_id=$1 and id<>$2 limit 1), 'grupo_comercial', '{}', $3)`, [A, ck.handoff_id, ck.codigo_ref]) } catch { codigoDuplicadoBarrado = true }
    ok('0044: codigo_ref não pode repetir na mesma organização', codigoDuplicadoBarrado)

    const retornoObs: string[] = []
    const depsCmd = {
      comandos: cmdRepo,
      notificacoes: notifRepoF4,
      handoff: repo,
      retorno: {
        resolverCampanhaRetorno: async () => ({ ok: true as const, campanhaId: 'camp-fup', workflowId: 'wf-fup' }),
        inscrever: async (_o: string, _w: string, leadId: string, _c: string, ciclo: string) => { retornoObs.push(`inscrever:${leadId}:${ciclo}`); return { execucaoId: 'ex-1', jaInscrito: retornoObs.filter((x) => x.startsWith('inscrever')).length > 1 } },
        moverLeadParaFollowup: async (o: string, leadId: string) => { retornoObs.push('mover'); await q(`update leads set estagio='follow_up' where organizacao_id=$1 and id=$2`, [o, leadId]) },
        agendarPrimeiroEnvio: async () => { retornoObs.push('agendar') },
      },
    }
    const cursorAntesCmd = await repo.lerCursor(A)
    const evento = (texto: string, id: string) => ({ grupoId: '120363019502650977-group', providerMessageId: id, remetente: '5511999998888', remetenteNome: 'Bruno', grupoNome: 'Comercial', texto, recebidoEm: new Date().toISOString() })

    // Comando 1: nada muda.
    const r1 = await processarComandoGrupo(depsCmd, evento(`#${ck.codigo_ref} 1`, 'MSG-CMD-1'))
    const h1 = await repo.buscarHandoff(A, ck.handoff_id)
    ok('comando 1 → concluído/continuar; handoff segue aberto, cursor intacto', r1.tipo === 'concluido' && r1.resultado === 'continuar' && h1?.encerradoEm === null && (await repo.lerCursor(A)).versao === cursorAntesCmd.versao, r1)
    const dup1 = await processarComandoGrupo(depsCmd, evento(`#${ck.codigo_ref} 1`, 'MSG-CMD-1'))
    ok('callback reenviado (mesmo messageId) → duplicado, não executa', dup1.tipo === 'duplicado')

    // Comando 2 concorrente (mesmo messageId em 3 conexões): 1 executa.
    const clientes = await Promise.all([pool.connect(), pool.connect(), pool.connect()])
    const repos = clientes.map((c) => new PgComandoRepository(c))
    let chegaram = 0; let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    for (const r of repos) r.antesDeReivindicar = async () => { if (++chegaram === 3) liberar(); await barreira }
    const rs = await Promise.all(repos.map((r) => processarComandoGrupo({ ...depsCmd, comandos: r }, evento(`#${ck.codigo_ref} 2`, 'MSG-CMD-2'))))
    clientes.forEach((c) => c.release())
    const tipos = rs.map((r) => r.tipo).sort()
    const h2 = await repo.buscarHandoff(A, ck.handoff_id)
    ok('comando 2 concorrente (3 workers) → 1 concluído, resto concorrente; handoff encerrado UMA vez (retorno_followup)',
      tipos.filter((t) => t === 'concluido').length === 1 && h2?.encerradoMotivo === 'retorno_followup' && retornoObs.filter((x) => x.startsWith('inscrever')).length === 1, { tipos, retornoObs })
    ok('lead voltou para follow_up e mantém o responsável (histórico preservado)',
      (await q('select estagio, responsavel_id from leads where id=$1', [h2!.leadId])).rows[0].estagio === 'follow_up' && (await q('select responsavel_id from leads where id=$1', [h2!.leadId])).rows[0].responsavel_id === h2!.responsavelId)
    const linhas = (await q(`select provider_message_id, status, resultado, comando, remetente from comercial_grupo_comandos where organizacao_id=$1 order by recebido_em`, [A])).rows
    ok('auditoria: 2 comandos gravados com remetente/comando/resultado; unique por messageId', linhas.length === 2 && linhas.every((l) => l.status === 'concluido' && l.remetente === '5511999998888'), linhas)

    // Reativação: o lead responde de novo durante o follow-up de retorno → mesmo comercial, cursor intacto.
    const cursorAntesRe = await repo.lerCursor(A)
    const re = await atribuirResponsavelHandoff(repo, { organizacaoId: A, leadId: h2!.leadId, eventoId: 'ev-reativacao-f4', origem: 'prospeccao' })
    ok('resposta positiva no follow-up de retorno → reativação para o MESMO comercial, cursor intacto',
      re.tipo === 'atribuido' && re.motivo === 'reativacao' && re.responsavel.id === h2!.responsavelId && (await repo.lerCursor(A)).versao === cursorAntesRe.versao, re)

    // RLS do outbox de comandos: authenticated lê só a própria org e não escreve.
    const c = await pool.connect()
    try {
      await c.query('set role authenticated')
      await c.query(`select set_config('app.org', $1, false)`, [B])
      const vistoB = (await c.query('select count(*)::int c from comercial_grupo_comandos')).rows[0].c
      await c.query(`select set_config('app.org', $1, false)`, [A])
      const vistoA = (await c.query('select count(*)::int c from comercial_grupo_comandos')).rows[0].c
      let negado = false
      try { await c.query(`update comercial_grupo_comandos set status='recebido'`); negado = (await c.query(`select count(*)::int c from comercial_grupo_comandos where status='recebido'`)).rows[0].c === 0 } catch { negado = true }
      ok('RLS: comandos visíveis só para a própria org; authenticated não escreve', vistoB === 0 && vistoA === 2 && negado, { vistoA, vistoB, negado })
      await c.query('reset role')
    } finally { c.release() }
  }

  const falhas = results.filter(([c]) => !c)
  console.log(`\n${results.length - falhas.length}/${results.length} asserções ok`)
  if (falhas.length) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => pool.end())
