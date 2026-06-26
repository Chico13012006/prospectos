// Backup da tabela `leads` para JSON (lossless) + CSV (revisão). Read-only no banco.
const dns = require('node:dns'); dns.setDefaultResultOrder('ipv4first');
const fs = require('node:fs');
const path = require('node:path');

const env = {};
fs.readFileSync('.env.local', 'utf-8').split(/\r?\n/).forEach((l) => {
  const i = l.indexOf('=');
  if (i > 0) {
    const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    env[l.slice(0, i).trim()] = v;
  }
});
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

(async () => {
  const res = await fetch(BASE + '/rest/v1/leads?select=*&limit=5000', { headers: H });
  const leads = await res.json();
  if (!Array.isArray(leads)) { console.log('ERRO', JSON.stringify(leads)); process.exit(1); }

  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

  const jsonPath = path.join(dir, `leads_backup_${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(leads, null, 2), 'utf-8');

  const cols = Object.keys(leads[0] || {});
  const csv = [cols.join(';')]
    .concat(leads.map((r) => cols.map((c) => csvCell(r[c])).join(';')))
    .join('\n');
  const csvPath = path.join(dir, `leads_backup_${ts}.csv`);
  fs.writeFileSync(csvPath, csv, 'utf-8');

  console.log('BACKUP OK:', leads.length, 'leads');
  console.log('  JSON (lossless, p/ restaurar):', jsonPath);
  console.log('  CSV  (revisão):', csvPath);
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
