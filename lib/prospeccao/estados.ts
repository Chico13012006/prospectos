// Estados para os seletores da prospecção (filtro da tela e perfil de busca).
// Puro — usado no cliente e nos testes.

import { UFS_BRASIL } from '@/lib/config/workspaceConfig'

type Uf = (typeof UFS_BRASIL)[number]

export const NOME_UF: Record<Uf, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco',
  PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia',
  RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
  TO: 'Tocantins',
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Estados que casam com o texto digitado, pela sigla ou pelo nome, sem
 * diferenciar acento/maiúscula. Sigla exata vem primeiro; depois os nomes que
 * começam com o texto; depois os que o contêm. Texto vazio = todos, por nome.
 */
export function filtrarEstados(texto: string): Uf[] {
  const q = normalizar(texto)
  const porNome = [...UFS_BRASIL].sort((a, b) => NOME_UF[a].localeCompare(NOME_UF[b], 'pt-BR'))
  if (!q) return porNome
  const sigla = porNome.filter((uf) => uf.toLowerCase() === q)
  const comeca = porNome.filter((uf) => !sigla.includes(uf) && normalizar(NOME_UF[uf]).startsWith(q))
  const contem = porNome.filter(
    (uf) => !sigla.includes(uf) && !comeca.includes(uf) && normalizar(NOME_UF[uf]).includes(q),
  )
  return [...sigla, ...comeca, ...contem]
}
