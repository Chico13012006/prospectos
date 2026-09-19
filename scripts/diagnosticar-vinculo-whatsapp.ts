/**
 * Diagnóstico (SOMENTE LEITURA) do vínculo de mensagens WhatsApp com leads.
 *
 * Investiga o caso: telefone que passou por dois leads (organizações
 * diferentes) num mesmo período, deixando mensagens vinculadas ao lead
 * "errado" (o que tinha o telefone no momento da inserção) e pelo menos uma
 * mensagem sem vínculo nenhum (ambiguidade — ver `resolverVinculoPorTelefone`
 * em lib/whatsapp/inbound.ts).
 *
 * Uso:
 *   npx tsx scripts/diagnosticar-vinculo-whatsapp.ts --telefone 5511999999999
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main() {
  const telefoneArg = arg('--telefone')?.replace(/\D/g, '')
  if (!telefoneArg) {
    console.error('Uso: npx tsx scripts/diagnosticar-vinculo-whatsapp.ts --telefone <dígitos>')
    process.exit(1)
  }
  // Variantes com/sem DDI 55, igual telefonesEquivalentes (lib/whatsapp/telefone.ts).
  const semDDI = telefoneArg.startsWith('55') ? telefoneArg.slice(2) : telefoneArg
  const comDDI = telefoneArg.startsWith('55') ? telefoneArg : `55${telefoneArg}`
  const variantes = [...new Set([telefoneArg, semDDI, comDDI])]

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    console.log(`\nVariantes de telefone buscadas: ${variantes.join(', ')}\n`)

    const leads = await c.query(
      `select l.id, l.organizacao_id, o.nome as organizacao_nome, l.nome, l.contato_telefone, l.hubspot_id
         from leads l join organizacoes o on o.id = l.organizacao_id
        where regexp_replace(coalesce(l.contato_telefone,''), '\\D', '', 'g') = any($1::text[])`,
      [variantes],
    )
    console.log('Leads com telefone atual batendo (qualquer variante):')
    console.table(leads.rows.map((r) => ({
      lead_id: r.id, organizacao: r.organizacao_nome, nome: r.nome, telefone: r.contato_telefone,
    })))

    const msgs = await c.query(
      `select m.id, m.direcao, m.remetente, m.conteudo, m.mensagem_em, m.lead_id, m.organizacao_id,
              l.nome as lead_nome, o.nome as organizacao_nome
         from whatsapp_mensagens m
         left join leads l on l.id = m.lead_id
         left join organizacoes o on o.id = m.organizacao_id
        where regexp_replace(coalesce(m.remetente,''), '\\D', '', 'g') = any($1::text[])
        order by m.mensagem_em asc`,
      [variantes],
    )
    console.log(`\nMensagens WhatsApp deste telefone: ${msgs.rowCount}\n`)
    console.table(msgs.rows.map((r) => ({
      quando: r.mensagem_em, direcao: r.direcao, lead: r.lead_nome ?? '(sem vínculo)',
      organizacao: r.organizacao_nome ?? '—', conteudo: (r.conteudo ?? '').slice(0, 40),
    })))

    const semVinculo = msgs.rows.filter((r) => !r.lead_id)
    if (semVinculo.length) {
      console.log(`\n${semVinculo.length} mensagem(ns) SEM vínculo (ambiguidade ou lead inexistente no momento):`)
      console.table(semVinculo.map((r) => ({ id: r.id, quando: r.mensagem_em, conteudo: r.conteudo })))
    }

    const porLead = new Map<string, number>()
    for (const r of msgs.rows) {
      if (!r.lead_id) continue
      porLead.set(r.lead_id, (porLead.get(r.lead_id) ?? 0) + 1)
    }
    console.log('\nContagem por lead vinculado:')
    for (const [leadId, qtd] of porLead) {
      const l = leads.rows.find((r) => r.id === leadId)
      console.log(`  ${leadId} (${l?.organizacao_nome ?? '?'} / ${l?.nome ?? '?'}): ${qtd}`)
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
