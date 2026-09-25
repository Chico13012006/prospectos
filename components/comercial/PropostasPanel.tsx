'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Search, X } from 'lucide-react';
import PropostasLista from '@/components/comercial/propostas/PropostasLista';
import { estilosModulo as m, TituloSecao } from '@/components/tema/Modulo';
import s from './Comercial.module.css';

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
    <section className={m.painel}>
      <div className={`${m.painelBarra} flex-wrap`}>
        <TituloSecao
          icone={FolderOpen}
          titulo="Propostas salvas"
          subtitulo="Baixe o PDF de novo ou envie ao cliente por e-mail ou WhatsApp."
        />
        <div className="relative w-full sm:w-80">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-300" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por empresa"
            aria-label="Buscar proposta por empresa"
            className={`${s.campo} ${s.comIcone} ${s.comAcao} focus-ring`}
          />
          {texto && (
            <button
              type="button"
              onClick={() => setTexto('')}
              aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="p-4">
        <PropostasLista busca={busca} mostrarEmpresa grade />
      </div>
    </section>
  );
}
