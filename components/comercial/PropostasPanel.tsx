'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import PropostasLista from '@/components/comercial/propostas/PropostasLista';

// Aba "Propostas" do módulo Comercial: todas as propostas salvas que o usuário
// enxerga (admin: a organização; comercial: a própria carteira), com busca por
// empresa. Baixar o PDF e enviar ao cliente ficam em cada card.
export default function PropostasPanel() {
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');

  // Debounce: a busca vai ao banco só quando a digitação para.
  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-200">Propostas salvas</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Baixe o PDF de novo ou envie ao cliente por e-mail ou WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-1.5 border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] w-full sm:w-72">
          <Search size={14} className="text-slate-500" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por empresa..."
            className="flex-1 bg-transparent text-sm text-slate-100 focus:outline-none"
          />
        </div>
      </div>
      <PropostasLista busca={busca} mostrarEmpresa grade />
    </div>
  );
}
