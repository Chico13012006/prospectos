/**
 * Transfere a carteira de um responsável para outro, dentro da MESMA organização.
 *
 * Trata os dois vínculos que convivem na base:
 *   • `responsavel_id` apontando para a linha de `usuarios` (caminho atual);
 *   • `responsavel_nome` como texto solto, com `responsavel_id` nulo (legado).
 * Ignorar o segundo deixaria a maior parte da carteira para trás — na carteira
 * da Silmara eram 155 de 167.
 *
 * A transferência preenche o `responsavel_id` do destino nos dois casos, então
 * ela também corrige o legado em vez de perpetuá-lo.
 *
 * Segurança: a organização é derivada das linhas de `usuarios`, nunca de
 * argumento solto, e a atualização exige que origem e destino estejam na mesma.
 * Grava backup JSON em backups/ antes do UPDATE e roda em transação.
 *
 * ENSAIO por padrão.
 *
 * Uso:
 *   npx tsx scripts/transferir-leads.ts --de <email> --para <email>
 *   npx tsx scripts/transferir-leads.ts --de <email> --para <email> --confirmar
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { anunciarModo, limiteSeguranca } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const LIMITE = 1000 // acima disto revise antes: não é mais uma carteira, é a base

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

interface Usuario { id: string; nome: string | null; email: string; organizacao_id: string }

async function main() {
  const emailDe = arg('--de')?.trim().toLowerCase()
  const emailPara = arg('--para')?.trim().toLowerCase()
  if (!emailDe || !emailPara) {
    console.error('Uso: npx tsx scripts/transferir-leads.ts --de <email> --para <email> [--confirmar]')
    process.exit(1)
  }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  try {
    const achar = async (email: string): Promise<Usuario> => {
      const r = await c.query<Usuario>(
        `select id, nome, email, organizacao_id from usuarios where lower(email) = $1`, [email])
      if (r.rowCount === 0) throw new Error(`Nenhum usuário com e-mail ${email}.`)
      if (r.rowCount > 1) throw new Error(`Mais de um usuário com e-mail ${email} — resolva a duplicidade antes.`)
      return r.rows[0]
    }

    const de = await achar(emailDe)
    const para = await achar(emailPara)
    if (de.id === para.id) throw new Error('Origem e destino são a mesma pessoa.')
    if (de.organizacao_id !== para.organizacao_id) {
      throw new Error('Origem e destino estão em organizações diferentes — transferência entre workspaces não é permitida.')
    }
    const org = de.organizacao_id

    // Legado: nome exatamente como está gravado no lead. Não uso "like" para não
    // arrastar homônimo parcial de outra pessoa.
    const nomesLegado = [...new Set([de.nome, `${de.nome ?? ''} `.trim()].filter(Boolean) as string[])]
    const { rows: variantes } = await c.query<{ responsavel_nome: string; qtd: number }>(
      `select responsavel_nome, count(*)::int as qtd from leads
        where organizacao_id = $1 and responsavel_id is null and responsavel_nome is not null
        group by 1 order by 2 desc`, [org])

    const alvosLegado = variantes
      .filter((v) => {
        const n = v.responsavel_nome.trim().toLowerCase()
        const base = (de.nome ?? '').trim().toLowerCase()
        return !!base && (n === base || n.startsWith(`${base} `))
      })
      .map((v) => v.responsavel_nome)

    const { rows: porId } = await c.query(
      `select id, responsavel_id, responsavel_nome from leads where organizacao_id=$1 and responsavel_id=$2`,
      [org, de.id])
    const { rows: porNome } = alvosLegado.length
      ? await c.query(
          `select id, responsavel_id, responsavel_nome from leads
            where organizacao_id=$1 and responsavel_id is null and responsavel_nome = any($2::text[])`,
          [org, alvosLegado])
      : { rows: [] as { id: string; responsavel_id: string | null; responsavel_nome: string | null }[] }

    const total = porId.length + porNome.length

    const real = anunciarModo({
      nome: `TRANSFERIR CARTEIRA — ${de.nome ?? emailDe} → ${para.nome ?? emailPara}`,
      alvo: `org ${org}`,
      efeitos: [
        `${porId.length} lead(s) ligados por responsavel_id`,
        `${porNome.length} lead(s) do legado, por nome: ${alvosLegado.join(' / ') || '(nenhum)'}`,
        `total ${total} lead(s) passam a ter responsavel_id = ${para.id}`,
        'o legado transferido deixa de ser texto solto e passa a ter FK real',
      ],
    })

    limiteSeguranca(total, LIMITE, 'leads')

    if (!real) {
      console.log(`\nENSAIO — nada alterado. Acrescente --confirmar para executar.`)
      return
    }
    if (total === 0) {
      console.log('\n  Nada a transferir.')
      return
    }

    const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
    const destino = path.join(process.cwd(), 'backups', `transferencia-leads-${carimbo}.json`)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(destino, JSON.stringify(
      { em: new Date().toISOString(), org, de, para, anterior: [...porId, ...porNome] }, null, 2), 'utf-8')
    console.log(`\n  ✔ backup: ${path.relative(process.cwd(), destino)}`)

    await c.query('begin')
    const ids = [...porId, ...porNome].map((l) => l.id)
    const r = await c.query(
      `update leads set responsavel_id = $1, responsavel_nome = $2, updated_at = now()
        where organizacao_id = $3 and id = any($4::uuid[])`,
      [para.id, para.nome, org, ids])
    await c.query('commit')
    console.log(`\n  ✔ ${r.rowCount} lead(s) transferido(s).`)

    const conferencia = await c.query(
      `select u.nome, u.email, count(*)::int as leads
         from leads l join usuarios u on u.id = l.responsavel_id
        where l.organizacao_id = $1 group by 1,2 order by 3 desc`, [org])
    console.log('\n  Carteiras depois:')
    console.table(conferencia.rows)
    const sobra = await c.query(
      `select responsavel_nome, count(*)::int as leads from leads
        where organizacao_id=$1 and responsavel_id is null group by 1 order by 2 desc`, [org])
    if (sobra.rowCount) {
      console.log('\n  Ainda sem responsavel_id (legado não relacionado a esta transferência):')
      console.table(sobra.rows)
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
