// Itens do menu lateral e a visibilidade escolhida pela organização
// (Configurações > Personalização > Menu). A escolha vive em
// organizacoes.configuracoes.modulos: `false` esconde o item; ausência ou
// `true` mostra (padrão do produto). Esconder é só visual — a rota continua
// acessível e as permissões seguem impostas no servidor.
// Puro: usado pelo Sidebar, pela tela de personalização e pelos testes.

export interface ItemMenu {
  id: string // chave em configuracoes.modulos
  href: string
  label: string
  descricao: string
}

export const ITENS_MENU: readonly ItemMenu[] = [
  { id: 'dashboard', href: '/dashboard', label: 'Dashboard', descricao: 'Visão geral e indicadores.' },
  { id: 'pipeline', href: '/pipeline', label: 'Pipeline de Contato', descricao: 'Kanban, lista e cadência dos leads.' },
  { id: 'base_leads', href: '/base-leads', label: 'Base de Leads', descricao: 'Banco geral de leads, com filtros.' },
  { id: 'prospeccao', href: '/prospeccao', label: 'Prospecção', descricao: 'Busca de empresas no catálogo da Receita.' },
  { id: 'reunioes', href: '/reunioes', label: 'Reuniões', descricao: 'Agenda e reuniões marcadas.' },
  { id: 'inteligencia_comercial', href: '/inteligencia-comercial', label: 'Inteligência Comercial', descricao: 'Análises da prospecção.' },
  { id: 'comercial', href: '/comercial', label: 'Comercial', descricao: 'Simulador, propostas, copiloto e templates.' },
  { id: 'equipe', href: '/equipe', label: 'Equipe', descricao: 'Membros, papéis e desempenho.' },
  { id: 'automacao', href: '/automacao', label: 'Automação', descricao: 'Campanhas, workflows e modelos.' },
]

/** Evento de janela disparado ao salvar, para o Sidebar refletir na hora. */
export const EVENTO_MENU_ATUALIZADO = 'prospectos:menu-atualizado'

export function itemVisivel(modulos: Record<string, boolean> | undefined | null, id: string): boolean {
  return modulos?.[id] !== false
}

export function itensVisiveis(modulos: Record<string, boolean> | undefined | null): ItemMenu[] {
  return ITENS_MENU.filter((i) => itemVisivel(modulos, i.id))
}

/**
 * Mapa a gravar: mantém chaves que não são do menu (o PUT substitui o objeto
 * inteiro) e grava só `false` para os escondidos — mostrar é o padrão.
 */
export function modulosComMenu(atuais: Record<string, boolean> | undefined | null, ocultos: readonly string[]): Record<string, boolean> {
  const ids = new Set(ITENS_MENU.map((i) => i.id))
  const resto = Object.fromEntries(Object.entries(atuais ?? {}).filter(([k]) => !ids.has(k)))
  return { ...resto, ...Object.fromEntries(ocultos.filter((id) => ids.has(id)).map((id) => [id, false])) }
}
