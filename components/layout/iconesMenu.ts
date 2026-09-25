import {
  Bot, BrainCircuit, Briefcase, Calendar, Database, Kanban, LayoutDashboard, Radar, Users, type LucideIcon,
} from 'lucide-react'

// Ícone de cada item do menu lateral (ids de lib/navegacao/menu.ts).
export const ICONE_MENU: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  pipeline: Kanban,
  base_leads: Database,
  prospeccao: Radar,
  reunioes: Calendar,
  inteligencia_comercial: BrainCircuit,
  comercial: Briefcase,
  equipe: Users,
  automacao: Bot,
}
