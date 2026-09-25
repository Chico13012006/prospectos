'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Save, SlidersHorizontal, X } from 'lucide-react';
import CamposPerfilBusca from './CamposPerfilBusca';
import type { ProspeccaoConfig } from '@/lib/config/workspaceConfig';
import s from './Prospeccao.module.css';

// Perfil de busca editado na própria tela de Prospecção (painel lateral). Grava
// o mesmo organizacoes.configuracoes.prospeccao da aba de Configurações, pelo
// mesmo PUT (exige workspace.configure). O objeto é SUBSTITUÍDO no servidor,
// então o painel manda o perfil inteiro, como veio mais o que foi editado.

export default function PerfilBuscaPainel({
  catalogoCnaes, onFechar, onSalvo,
}: {
  /** CNAEs já carregados no catálogo; os demais entram na próxima carga. */
  catalogoCnaes: string[] | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [perfil, setPerfil] = useState<ProspeccaoConfig>({});
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/configuracoes/workspace')
      .then(async (res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o perfil de busca.');
        return res.json();
      })
      .then(({ config, podeEditar: permitido }) => {
        setPerfil(config?.prospeccao ?? {});
        setPodeEditar(!!permitido);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    // Esc já tratado por um campo (ex.: menu de estados aberto) não fecha o painel.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !salvando) onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar, salvando]);

  const cnaes = perfil.cnaes ?? [];

  async function salvar() {
    if (!podeEditar || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospeccao: cnaes.length ? perfil : null }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corpo?.erro || 'Falha ao salvar o perfil');
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  return (
    <div className={s.drawerBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) onFechar(); }}>
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-labelledby="perfil-busca-titulo">
        <header className={s.drawerHeader}>
          <div className={s.sectionHeading}>
            <span className={s.sectionIcon}><SlidersHorizontal size={17} aria-hidden="true" /></span>
            <div>
              <h2 id="perfil-busca-titulo">Perfil de busca</h2>
              <p>O ponto de partida da Prospecção: o que o catálogo da Receita busca para a sua equipe.</p>
            </div>
          </div>
          <button type="button" onClick={onFechar} disabled={salvando} aria-label="Fechar" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-100 focus-ring">
            <X size={18} />
          </button>
        </header>

        {carregando ? (
          <div className={s.drawerBody}><p className="text-sm text-slate-400">Carregando…</p></div>
        ) : (
          <div className={s.drawerBody}>
            <CamposPerfilBusca
              perfil={perfil}
              onChange={setPerfil}
              podeEditar={podeEditar}
              catalogoCnaes={catalogoCnaes}
            />
            {erro && (
              <p className="flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> {erro}</p>
            )}
          </div>
        )}

        <footer className={s.drawerFooter}>
          <button type="button" onClick={onFechar} disabled={salvando} className="h-10 rounded-lg px-4 text-sm text-slate-300 hover:bg-white/5 focus-ring">
            {podeEditar ? 'Cancelar' : 'Fechar'}
          </button>
          {podeEditar && (
            <button type="button" onClick={salvar} disabled={salvando || carregando} className={`${s.primaryButton} disabled:opacity-60 focus-ring`}>
              <Save size={15} /> {salvando ? 'Salvando…' : 'Salvar e buscar'}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
