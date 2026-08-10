// Camada de compatibilidade de LEITURA (Fase 2c) — lógica pura de merge.
//
// FONTE DA VERDADE DURANTE A TRANSIÇÃO (enquanto a escrita for só em `leads`):
//   - Campos MUTÁVEIS pelas telas/motor atuais (nome da empresa, cidade, estado,
//     segmento, site, domínio; nome/cargo/email/telefone do contato):
//       => LEADS é autoritativo. O view SEMPRE prefere o valor do lead quando o
//          lead existe, e só cai na projeção como fallback. Assim, alterar um
//          lead reflete na leitura na hora, sem depender do backfill — não há
//          divergência de leitura antes do write-sync (Fase 2d).
//   - Campos que SÓ existem na entidade (empresa: cnpj, revisao_pendente,
//     motivo_revisao, arquivado, origem; contato: email_validado, whatsapp,
//     linkedin, senioridade, arquivado, origem):
//       => EMPRESAS/CONTATOS é a fonte (leads não tem esses campos).
//   - Relacionamento (uma empresa, VÁRIOS contatos/decisores):
//       => EMPRESAS/CONTATOS é a única fonte (leads é 1:1).
//
// FALLBACK SEGURO PARA LEGADO: lead sem empresa/contato ligados (não backfillado
// ou criado depois) => o view é derivado inteiramente do próprio lead
// (fonte='legado'), sem quebrar. Contato/empresa sem lead (futuro) => da entidade.
//
// Isto NÃO altera nenhuma tela nem o motor: é uma camada opt-in que só será
// ligada nas telas DEPOIS do write-sync transacional (Fase 2d).

// Subconjunto de `leads` que alimenta o view (campos relevantes de empresa/contato).
export interface LeadCompat {
  id: string
  empresa: string | null
  cidade: string | null
  estado: string | null
  segmento: string | null
  site: string | null
  dominio: string | null
  origem: string | null
  contato_nome: string | null
  contato_cargo: string | null
  contato_email: string | null
  contato_telefone: string | null
}

export interface EmpresaRow {
  id: string
  nome: string | null
  cnpj: string | null
  dominio: string | null
  segmento: string | null
  cidade: string | null
  estado: string | null
  site: string | null
  origem: string | null
  revisao_pendente: boolean | null
  motivo_revisao: string | null
  arquivado: boolean | null
}

export interface ContatoRow {
  id: string
  nome: string | null
  cargo: string | null
  email: string | null
  telefone: string | null
  email_validado: boolean | null
  whatsapp: string | null
  linkedin: string | null
  senioridade: string | null
  origem: string | null
  arquivado: boolean | null
}

export type Fonte = 'entidade' | 'legado'

export interface EmpresaView {
  id: string | null
  nome: string | null
  cnpj: string | null
  dominio: string | null
  segmento: string | null
  cidade: string | null
  estado: string | null
  site: string | null
  revisaoPendente: boolean
  motivoRevisao: string | null
  arquivado: boolean
  origem: string | null
  fonte: Fonte
}

export interface ContatoView {
  id: string | null
  nome: string | null
  cargo: string | null
  email: string | null
  telefone: string | null
  emailValidado: boolean
  whatsapp: string | null
  linkedin: string | null
  senioridade: string | null
  arquivado: boolean
  origem: string | null
  fonte: Fonte
}

// `??` só cai no fallback em null/undefined — string vazia do lead ainda é
// "valor do lead" (autoritativo). Preserva a regra: leads manda quando existe.
const pref = <T>(a: T | null | undefined, b: T | null | undefined): T | null =>
  a ?? b ?? null

export function montarEmpresaView(lead: LeadCompat | null, empresa: EmpresaRow | null): EmpresaView {
  return {
    id: empresa?.id ?? null,
    // core mutável: LEADS autoritativo, projeção como fallback
    nome: pref(lead?.empresa, empresa?.nome),
    dominio: pref(lead?.dominio, empresa?.dominio),
    segmento: pref(lead?.segmento, empresa?.segmento),
    cidade: pref(lead?.cidade, empresa?.cidade),
    estado: pref(lead?.estado, empresa?.estado),
    site: pref(lead?.site, empresa?.site),
    // só-entidade: EMPRESA é a fonte
    cnpj: empresa?.cnpj ?? null,
    revisaoPendente: empresa?.revisao_pendente ?? false,
    motivoRevisao: empresa?.motivo_revisao ?? null,
    arquivado: empresa?.arquivado ?? false,
    origem: empresa?.origem ?? lead?.origem ?? null,
    fonte: empresa ? 'entidade' : 'legado',
  }
}

export function montarContatoView(lead: LeadCompat | null, contato: ContatoRow | null): ContatoView {
  return {
    id: contato?.id ?? null,
    // core mutável: LEADS autoritativo, projeção como fallback
    nome: pref(lead?.contato_nome, contato?.nome),
    cargo: pref(lead?.contato_cargo, contato?.cargo),
    email: pref(lead?.contato_email, contato?.email),
    telefone: pref(lead?.contato_telefone, contato?.telefone),
    // só-entidade: CONTATO é a fonte
    emailValidado: contato?.email_validado ?? false,
    whatsapp: contato?.whatsapp ?? null,
    linkedin: contato?.linkedin ?? null,
    senioridade: contato?.senioridade ?? null,
    arquivado: contato?.arquivado ?? false,
    origem: contato?.origem ?? null,
    fonte: contato ? 'entidade' : 'legado',
  }
}
