'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Kanban,
  BrainCircuit,
  Users,
  FileText,
  Settings,
  Zap,
  Bot,
  ArrowRight,
  LogOut,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const BRAND_NAVY = '#1e3a5f';
const BRAND_NAVY_ACTIVE = '#2d5a8e';

const mainNav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/pipeline', icon: Kanban, label: 'Pipeline de Contato' },
  { href: '/inteligencia-comercial', icon: BrainCircuit, label: 'Inteligência Comercial' },
  { href: '/equipe', icon: Users, label: 'Equipe' },
  { href: '/templates', icon: FileText, label: 'Templates' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside
      className="flex flex-col w-60 min-h-screen shrink-0"
      style={{ backgroundColor: BRAND_NAVY }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-500">
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <div className="text-white font-bold text-sm leading-tight">ProspectOS</div>
          <div className="text-blue-200 text-xs leading-tight">InovaCode</div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {mainNav.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: active ? BRAND_NAVY_ACTIVE : 'transparent',
                color: active ? '#ffffff' : 'rgba(186,210,255,0.75)',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.07)';
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
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
          <p className="text-[11px] leading-snug text-blue-200/70 mb-2">
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

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/10">
        <Link
          href="/configuracoes"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{
            backgroundColor: isActive('/configuracoes') ? BRAND_NAVY_ACTIVE : 'transparent',
            color: isActive('/configuracoes') ? '#ffffff' : 'rgba(186,210,255,0.75)',
          }}
          onMouseEnter={e => {
            if (!isActive('/configuracoes')) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.07)';
          }}
          onMouseLeave={e => {
            if (!isActive('/configuracoes')) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          }}
        >
          <Settings size={18} strokeWidth={1.8} />
          Configurações
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full mt-0.5"
          style={{ color: 'rgba(186,210,255,0.75)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.07)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        >
          <LogOut size={18} strokeWidth={1.8} />
          Sair
        </button>
      </div>
    </aside>
  );
}
