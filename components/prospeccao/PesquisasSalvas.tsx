'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Pencil, Save, Trash2, X } from 'lucide-react';
import { PESQUISAS_LIMITES, type PesquisaSalva } from '@/lib/config/workspaceConfig';
import { resumoPesquisa } from '@/lib/prospeccao/pesquisas';
import s from './Prospeccao.module.css';

// Atalhos das pesquisas salvas (acima dos filtros) e o formulário de salvar a
// pesquisa atual. Quem não tem workspace.configure só aplica.

function CampoNome({ inicial, salvando, erro, onSalvar, onCancelar, rotuloSalvar }: {
  inicial: string; salvando: boolean; erro: string | null;
  onSalvar: (nome: string) => void; onCancelar: () => void; rotuloSalvar: string;
}) {
  const [nome, setNome] = useState(inicial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <form
      className={s.inlineForm}
      onSubmit={(e) => { e.preventDefault(); if (nome.trim()) onSalvar(nome); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancelar(); } }}
    >
      <input
        ref={ref}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        maxLength={PESQUISAS_LIMITES.nome}
        aria-label="Nome da pesquisa"
        className={`${s.field} px-3 focus-ring`}
      />
      <button type="submit" disabled={salvando || !nome.trim()} className={`${s.primaryButton} disabled:opacity-60 focus-ring`}>
        <Save size={14} /> {salvando ? 'Salvando…' : rotuloSalvar}
      </button>
      <button type="button" onClick={onCancelar} disabled={salvando} className="h-9 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/5 focus-ring">
        Cancelar
      </button>
      {erro && <span className="basis-full text-xs text-red-300">{erro}</span>}
    </form>
  );
}

export function SalvarPesquisa({ sugestao, onSalvar, onFechar }: {
  sugestao: string;
  onSalvar: (nome: string) => Promise<string | null>; // devolve erro, se houver
  onFechar: () => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <CampoNome
      inicial={sugestao}
      salvando={salvando}
      erro={erro}
      rotuloSalvar="Salvar pesquisa"
      onCancelar={onFechar}
      onSalvar={async (nome) => {
        setSalvando(true);
        const e = await onSalvar(nome);
        setSalvando(false);
        if (e) setErro(e); else onFechar();
      }}
    />
  );
}

export default function PesquisasSalvas({ pesquisas, ativa, podeEditar, onAplicar, onRenomear, onExcluir }: {
  pesquisas: PesquisaSalva[];
  ativa: string | null;
  podeEditar: boolean;
  onAplicar: (p: PesquisaSalva) => void;
  onRenomear: (id: string, nome: string) => Promise<string | null>;
  onExcluir: (id: string) => Promise<string | null>;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (pesquisas.length === 0) return null;

  return (
    <div className={s.savedRow}>
      <span className={s.savedLabel}><Bookmark size={13} aria-hidden="true" /> Pesquisas salvas</span>
      {pesquisas.map((p) => {
        if (editando === p.id) {
          return (
            <CampoNome
              key={p.id}
              inicial={p.nome}
              salvando={salvando}
              erro={erro}
              rotuloSalvar="Renomear"
              onCancelar={() => { setEditando(null); setErro(null); }}
              onSalvar={async (nome) => {
                setSalvando(true);
                const e = await onRenomear(p.id, nome);
                setSalvando(false);
                if (e) setErro(e); else { setEditando(null); setErro(null); }
              }}
            />
          );
        }
        const confirmando = confirmandoExclusao === p.id;
        return (
          <div key={p.id} className={`${s.savedChip} ${ativa === p.id ? s.savedChipAtivo : ''}`}>
            <button type="button" onClick={() => onAplicar(p)} title={resumoPesquisa(p)} aria-pressed={ativa === p.id} className={`${s.savedChipMain} focus-ring`}>
              {ativa === p.id && <Check size={13} aria-hidden="true" />}
              <span className="truncate">{p.nome}</span>
            </button>
            {podeEditar && (
              <span className={s.savedActions}>
                {confirmando ? (
                  <>
                    <button
                      type="button"
                      onClick={async () => { setConfirmandoExclusao(null); const e = await onExcluir(p.id); if (e) setErro(e); }}
                      className="rounded px-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/15 focus-ring"
                    >
                      Excluir
                    </button>
                    <button type="button" onClick={() => setConfirmandoExclusao(null)} aria-label="Cancelar exclusão" className="rounded p-1 text-slate-400 hover:text-slate-100 focus-ring">
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => { setEditando(p.id); setErro(null); }} aria-label={`Renomear ${p.nome}`} className="rounded p-1 text-slate-400 hover:text-slate-100 focus-ring">
                      <Pencil size={12} />
                    </button>
                    <button type="button" onClick={() => setConfirmandoExclusao(p.id)} aria-label={`Excluir ${p.nome}`} className="rounded p-1 text-slate-400 hover:text-red-300 focus-ring">
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
        );
      })}
      {erro && !editando && <span className="text-xs text-red-300">{erro}</span>}
    </div>
  );
}
