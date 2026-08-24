'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import CampanhaWizardPage from '@/components/automacao/CampanhaWizardPage';
import type { Campanha } from '@/components/automacao/tiposCampanha';

// Editar campanha (reabre o wizard pré-preenchido). Carrega a campanha por id
// via GET /api/campanhas/[id] (org-scoped) — deep-link seguro.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/campanhas/${id}`);
        if (!r.ok) { setEstado('erro'); return; }
        const d = await r.json();
        setCampanha(d.campanha); setEstado('ok');
      } catch { setEstado('erro'); }
    })();
  }, [id]);

  if (estado === 'carregando') return <div className="flex items-center justify-center gap-2 py-24 text-slate-500"><Loader2 size={18} className="animate-spin" /> Carregando campanha…</div>;
  if (estado === 'erro' || !campanha) return (
    <div className="p-6">
      <Link href="/automacao?tab=campanhas" className="text-sm text-indigo-300 hover:text-indigo-200">← Campanhas</Link>
      <div className="text-center py-20 text-slate-400 text-sm">Campanha não encontrada.</div>
    </div>
  );
  if (campanha.status !== 'rascunho') return (
    <div className="mx-auto max-w-2xl p-6">
      <Link href="/automacao?tab=campanhas" className="text-sm text-indigo-300 hover:text-indigo-200">← Campanhas</Link>
      <div className="mt-5 rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-6">
        <h1 className="text-lg font-bold text-slate-100">Campanha já publicada</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Público, mensagens e a versão publicada não são reabertos para evitar alterar execuções em andamento. Você pode editar os próximos dias de execução na tela da campanha.
        </p>
        <Link
          href={`/automacao/campanhas/${campanha.id}`}
          className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Abrir campanha e editar agenda
        </Link>
      </div>
    </div>
  );
  return <CampanhaWizardPage campanha={campanha} />;
}
