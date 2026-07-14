'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Kanban,
  Database,
  BrainCircuit,
  Calendar,
  Users,
  FileText,
  Settings,
  Zap,
  Bot,
  ArrowRight,
  LogOut,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const mainNav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/pipeline', icon: Kanban, label: 'Pipeline de Contato' },
  { href: '/base-leads', icon: Database, label: 'Base de Leads' },
  { href: '/reunioes', icon: Calendar, label: 'Reuniões' },
  { href: '/inteligencia-comercial', icon: BrainCircuit, label: 'Inteligência Comercial' },
  { href: '/equipe', icon: Users, label: 'Equipe' },
  { href: '/templates', icon: FileText, label: 'Templates' },
];

interface PerfilSidebar {
  nome: string | null;
  email: string | null;
  avatar_url: string | null;
}

function avatarFallback(nome: string | null, email: string | null) {
  const seed = nome || email || 'Usuário';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed)}&background=4F46E5&color=fff&size=64&bold=true`;
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilSidebar | null>(null);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  useEffect(() => {
    let ativo = true;
    fetch('/api/perfil')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!ativo || !data) return;
        setPerfil({
          nome: data.perfil?.nome ?? null,
          email: data.email ?? null,
          avatar_url: data.perfil?.avatar_url ?? null,
        });
      })
      .catch(() => {});
    return () => { ativo = false; };
  }, []);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const navItemClasses = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-l-[3px] ${
      active
        ? 'bg-white/10 text-white border-indigo-400'
        : 'text-indigo-200 border-transparent hover:bg-white/5 hover:text-white'
    }`;

  return (
    <aside className="flex flex-col w-60 min-h-screen shrink-0 bg-indigo-950">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-500 shadow-sm">
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <div className="text-white font-bold text-sm leading-tight">ProspectOS</div>
          <div className="text-indigo-300 text-xs leading-tight">InovaCode</div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {mainNav.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} className={navItemClasses(active)}>
              <Icon size={18} strokeWidth={1.8} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* IA trabalhando 24/7 */}
      <div className="px-3 pb-3">
        <div className="rounded-xl p-3.5 bg-white/5 border border-white/10">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-green-500/20">
              <Bot size={13} className="text-green-400" />
            </div>
            <span className="text-xs font-semibold text-white">IA trabalhando 24/7</span>
          </div>
          <p className="text-[11px] leading-snug text-indigo-200/70 mb-2">
            Prospectando, qualificando e gerando oportunidades para seu time.
          </p>
          <Link
            href="/configuracoes"
            className="flex items-center gap-1 text-[11px] font-medium text-green-400 hover:text-green-300 transition-colors"
          >
            Ver automações
            <ArrowRight size={11} />
          </Link>
        </div>
      </div>

      {/* Configurações */}
      <div className="px-3 pb-2 border-t border-white/10 pt-3">
        <Link href="/configuracoes" className={navItemClasses(isActive('/configuracoes'))}>
          <Settings size={18} strokeWidth={1.8} />
          Configurações
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-l-[3px] border-transparent w-full text-[#FC8181] hover:bg-red-500/10 mt-0.5"
        >
          <LogOut size={18} strokeWidth={1.8} />
          Sair
        </button>
      </div>

      {/* Usuário logado */}
      <Link
        href="/perfil"
        className="flex items-center gap-3 px-4 py-3 border-t border-white/10 hover:bg-white/5 transition-colors"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={perfil?.avatar_url || avatarFallback(perfil?.nome ?? null, perfil?.email ?? null)}
          alt={perfil?.nome || 'Usuário'}
          className="w-8 h-8 rounded-full object-cover shrink-0"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {perfil?.nome || 'Meu perfil'}
          </p>
          <p className="text-xs text-indigo-300 truncate">
            {perfil?.email || 'Ver conta'}
          </p>
        </div>
      </Link>
    </aside>
  );
}
