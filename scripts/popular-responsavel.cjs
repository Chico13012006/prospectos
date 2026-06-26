// Popula leads.responsavel_nome a partir do CSV do HubSpot ("Proprietário do
// contato"), casando por contato_email. Rode DEPOIS de aplicar a migration 0002.
//   node scripts/popular-responsavel.cjs
const dns = require('node:dns'); dns.setDefaultResultOrder('ipv4first');
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, mapearLead } = require('./importar-hubspot.js');

const env = {};
fs.readFileSync('.env.local', 'utf-8').split(/\r?\n/).forEach((l) => {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
});
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

(async () => {
  const csv = fs.readFileSync(path.join(process.cwd(), 'hubspot_leads.csv'), 'latin1');
  const rows = parseCSV(csv);

  // email -> responsavel_nome (a partir do mapeamento oficial do import)
  const map = new Map();
  for (const r of rows) {
    const m = mapearLead(r);
    if (m && m.contato_email && m.responsavel_nome) map.set(m.contato_email, m.responsavel_nome);
  }
  console.log(`CSV: ${map.size} e-mails com responsável.`);

  let atualizados = 0, semMatch = 0, erros = 0;
  for (const [email, nome] of map) {
    const url = `${BASE}/rest/v1/leads?contato_email=eq.${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ responsavel_nome: nome }),
    });
    const txt = await res.text();
    if (!res.ok) {
      if (erros === 0) console.error('Erro (1ª ocorrência):', res.status, txt);
      erros++;
      continue;
    }
    const arr = JSON.parse(txt || '[]');
    if (arr.length === 0) semMatch++; else atualizados += arr.length;
  }
  console.log(`✅ responsavel_nome populado: ${atualizados} leads | sem match no banco: ${semMatch} | erros: ${erros}`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
