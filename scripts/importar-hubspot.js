const fs = require('fs');
const path = require('path');

// Ler .env.local manualmente
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) env[key.trim()] = rest.join('=').trim();
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
// Service key só se estiver realmente configurada (não o placeholder); senão anon key.
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_KEY = serviceKey && !serviceKey.includes('sua_')
  ? serviceKey
  : env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL ou chave do Supabase não encontrada no .env.local');
  process.exit(1);
}

// O CSV exportado do HubSpot BR vem em Latin-1 (Windows-1252), NÃO UTF-8.
// Ler como utf-8 corromperia acentos (Gonçalves, Assaí, etc).
const CSV_ENCODING = 'latin1';

// Parser CSV (formato HubSpot BR: separador ';'). Respeita aspas: um campo entre
// aspas pode conter ';', quebras de linha e aspas escapadas (""). Isso evita o
// desalinhamento de colunas que o split(';') ingênuo causava.
function parseCSV(content) {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n'); // sem BOM, fim de linha normalizado
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" → aspas literal
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ';') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const headers = (rows.shift() || []).map(h => h.trim());
  return rows
    .filter(r => r.some(v => v && v.trim()))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
      return obj;
    });
}

// Provedores de e-mail PESSOAL: o prefixo do domínio NÃO é nome de empresa.
const PROVEDORES_PESSOAIS = new Set([
  'gmail', 'hotmail', 'outlook', 'yahoo', 'icloud', 'live', 'bol', 'uol', 'terra', 'msn', 'aol',
]);

// "tribecaeventos" -> "Tribeca Eventos" (só para domínios corporativos).
function tituloCase(s) {
  return s
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// Mapeamento para as colunas REAIS da tabela `leads` no Supabase.
// (coluna é `linkedin`, não `linkedin_url`; existe `hubspot_id`)
function mapearLead(row) {
  const email = (row['E-mail'] || row['Email'] || '').trim().toLowerCase();
  // Sem e-mail válido (regex real) → fora da importação.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

  const nome = row['Nome'] || '';
  const sobrenome = row['Sobrenome'] || '';
  const fullName = [nome, sobrenome].filter(Boolean).join(' ').trim() || null;

  const prefixoDominio = (email.split('@')[1] || '').split('.')[0] || '';
  const associada = (row['Associated Company'] || '').trim();
  const ehPessoal = PROVEDORES_PESSOAIS.has(prefixoDominio);

  // Empresa: NUNCA fabricar a partir de domínio pessoal.
  //  - Associated Company presente  -> usa o nome real do HubSpot
  //  - domínio corporativo sem nome -> deriva do prefixo, já formatado
  //  - e-mail pessoal sem empresa   -> empresa=null e marca como descartado (perdido)
  let empresa = null;
  let perdido = false;
  let perdidoMotivo = null;
  if (associada) {
    empresa = associada;
  } else if (!ehPessoal) {
    empresa = tituloCase(prefixoDominio);
  } else {
    // Coluna empresa é NOT NULL: usa um marcador claro (não é nome fabricado) e
    // sinaliza o descarte. Assim não inventamos "gmail"/"hotmail" como empresa.
    empresa = '(sem empresa)';
    perdido = true;
    perdidoMotivo = 'import: e-mail pessoal, sem empresa';
  }

  // Telefone: remover prefixos estranhos (ex: "?+5515..."), manter dígitos e +
  const telefone = (row['Número de telefone'] || '').trim().replace(/[^\d+]/g, '') || null;

  const hubspotId = (row['ID do registro.'] || row['ID do registro'] || '').trim() || null;

  return {
    empresa:            empresa,
    cidade:             null,
    estado:             null,
    segmento:           null,
    site:               null,
    linkedin:           null,
    contato_nome:       fullName,
    contato_cargo:      null,
    contato_email:      email,
    contato_telefone:   telefone,
    canal_preferencial: 'email',
    origem:             'hubspot',
    hubspot_id:         hubspotId,
    estagio:            perdido ? 'perdido' : 'novos_leads',
    perdido:            perdido,
    perdido_motivo:     perdidoMotivo,
    score:              50,
  };
}

async function buscarEmailsExistentes() {
  // Pagina por todos os leads e devolve um Set de contato_email (lowercase).
  const existentes = new Set();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=contato_email`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Range-Unit': 'items',
        'Range': `${from}-${from + PAGE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Erro ao ler emails existentes ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    rows.forEach(r => { if (r.contato_email) existentes.add(r.contato_email.toLowerCase()); });
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return existentes;
}

async function inserirLote(leads) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(leads),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase erro ${res.status}: ${err}`);
  }
}

async function main() {
  const csvPath = path.join(__dirname, '..', 'hubspot_leads.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('❌ Arquivo hubspot_leads.csv não encontrado na raiz do projeto.');
    process.exit(1);
  }

  console.log('📂 Lendo CSV (Latin-1)...');
  const content = fs.readFileSync(csvPath, CSV_ENCODING);
  const rows = parseCSV(content);
  console.log(`📊 ${rows.length} linhas encontradas no CSV`);

  const leads = rows.map(mapearLead).filter(Boolean);
  console.log(`✅ ${leads.length} leads com email válido`);
  console.log(`⚠️  ${rows.length - leads.length} linhas ignoradas (sem email)`);

  // Deduplicar por email dentro do CSV
  const emailsVistos = new Set();
  let leadsUnicos = leads.filter(l => {
    const e = l.contato_email.toLowerCase();
    if (emailsVistos.has(e)) return false;
    emailsVistos.add(e);
    return true;
  });
  console.log(`🔍 ${leadsUnicos.length} leads únicos após deduplicação interna`);

  // Deduplicar contra o que já existe no banco (importação idempotente)
  console.log('🔗 Buscando emails já existentes no banco...');
  const existentes = await buscarEmailsExistentes();
  const antes = leadsUnicos.length;
  leadsUnicos = leadsUnicos.filter(l => !existentes.has(l.contato_email));
  console.log(`🚫 ${antes - leadsUnicos.length} já existiam no banco e foram pulados`);
  console.log(`📥 ${leadsUnicos.length} leads novos para inserir`);

  if (leadsUnicos.length === 0) {
    console.log('\n✅ Nada a importar — banco já está em dia.');
    return;
  }

  // Inserir em lotes de 50
  const LOTE = 50;
  let importados = 0;
  for (let i = 0; i < leadsUnicos.length; i += LOTE) {
    const lote = leadsUnicos.slice(i, i + LOTE);
    process.stdout.write(`⬆️  Inserindo leads ${i + 1}–${Math.min(i + LOTE, leadsUnicos.length)}...`);
    try {
      await inserirLote(lote);
      importados += lote.length;
      console.log(' ✓');
    } catch (err) {
      console.log(' ✗');
      console.error(`   Erro no lote ${i / LOTE + 1}:`, err.message);
    }
  }

  console.log(`\n🎉 Importação concluída: ${importados} leads inseridos no Supabase`);
  console.log('   Estágio: novos_leads | Origem: hubspot');
}

// Exporta as funções puras para preview/teste sem executar a importação.
module.exports = { parseCSV, mapearLead };

// Só roda a importação quando chamado diretamente (node scripts/importar-hubspot.js).
if (require.main === module) {
  main().catch(console.error);
}
