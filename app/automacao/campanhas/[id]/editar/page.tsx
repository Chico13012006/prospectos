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
  return <CampanhaWizardPage campanha={campanha} />;
}
