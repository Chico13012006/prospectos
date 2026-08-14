'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Columns3, SlidersHorizontal, Kanban, Type,
  Save, Check, ToggleLeft, ToggleRight, Lock,
  Info, Plus,
} from 'lucide-react';
import { CAMPOS_UI_PADRAO, camposUIEfetivos, type CampoUI } from '@/lib/config/workspaceConfig';

// Personalização por workspace: 4 abas (Campos / Filtros e visualizações /
// Pipeline / Terminologia). A aba Campos é funcional e reflete em Base de Leads
// e Pipeline. As demais abas expõem os mesmos dados do ProcessoComercialPanel
// para que o usuário tenha tudo num lugar só.

type Aba = 'campos' | 'filtros' | 'pipeline' | 'terminologia';

interface PipelineEstagio { id: string; chave: string; nome: string; papel: string; cor: string | null }
interface Pipeline { id: string; nome: string; tipo: string; ativo: boolean; estagios: PipelineEstagio[] }

const TIPO_CAMPO: Record<string, string> = {
  contato_nome: 'Texto',
  empresa: 'Texto',
  contato_email: 'E-mail',
  contato_telefone: 'Telefone',
  origem: 'Texto',
  responsavel_id: 'Usuário',
  estagio: 'Status',
  data_validade: 'Data',
  proxima_acao_data: 'Data',
  score: 'Número',
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      className={`transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      aria-label={on ? 'Desativar' : 'Ativar'}
    >
      {on
        ? <ToggleRight size={22} className="text-indigo-400" />
        : <ToggleLeft size={22} className="text-slate-600" />
      }
    </button>
  );
}

export default function PersonalizacaoPanel() {
  const [aba, setAba] = useState<Aba>('campos');
  const [campos, setCampos] = useState<CampoUI[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [nomeLead, setNomeLead] = useState('');
  const [podeEditar, setPodeEditar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [wRes, pRes] = await Promise.all([
      fetch('/api/configuracoes/workspace').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/pipelines').then((r) => (r.ok ? r.json() : { pipelines: [] })),
    ]);
    if (wRes) {
      setPodeEditar(!!wRes.podeEditar);
      setCampos(camposUIEfetivos(wRes.config?.camposUI));
      setNomeLead(wRes.config?.nomenclaturas?.lead ?? '');
    } else {
      setCampos(camposUIEfetivos([]));
    }
    setPipelines(pRes.pipelines ?? []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  function setCampo(chave: string, patch: Partial<CampoUI>) {
    setCampos((prev) => prev.map((c) => (c.chave === chave ? { ...c, ...patch } : c)));
  }

  async function salvarCampos() {
    if (salvando) return;
    setSalvando(true); setErro(null); setSalvo(false);
    try {
      const body: Record<string, unknown> = { camposUI: campos };
      if (nomeLead.trim()) body.nomenclaturas = { lead: nomeLead.trim() };
      const r = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json())?.erro || 'Falha ao salvar');
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const TABS: { id: Aba; label: string; Icon: typeof Columns3 }[] = [
    { id: 'campos', label: 'Campos', Icon: Columns3 },
    { id: 'filtros', label: 'Filtros e visualizações', Icon: SlidersHorizontal },
    { id: 'pipeline', label: 'Pipeline', Icon: Kanban },
    { id: 'terminologia', label: 'Terminologia', Icon: Type },
  ];

  const input = 'w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50';

  return (
    <div className="space-y-5">
      {/* Sub-abas */}
      <div className="flex items-center gap-1 border-b border-[#2a3147]">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 -mb-px transition-colors ${
              aba === id ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* --- Aba Campos --- */}
      {aba === 'campos' && (
        <div className="space-y-4">
          {!podeEditar && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-2.5">
              <Lock size={13} /> Somente leitura — requer a permissão <code>workspace.configure</code> para editar.
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">Configure quais campos aparecem nas listas e nos filtros, por workspace.</p>
            <div className="flex items-center gap-2">
              <button
                disabled
                title="Campos customizados entram numa iteração seguinte"
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-[#2a3147] text-slate-500 opacity-50 cursor-not-allowed">
                <Plus size={13} /> Novo campo
              </button>
              {podeEditar && (
                <button onClick={salvarCampos} disabled={salvando}
                  className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40">
                  {salvo ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar alterações</>}
                </button>
              )}
            </div>
          </div>

          {erro && <p className="text-sm text-red-400">{erro}</p>}

          <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a3147] text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="text-left font-medium px-5 py-3">Campo</th>
                  <th className="text-left font-medium px-4 py-3">Tipo</th>
                  <th className="text-center font-medium px-4 py-3">Obrigatório</th>
                  <th className="text-center font-medium px-4 py-3">Visível</th>
                  <th className="text-center font-medium px-4 py-3">Usar como filtro</th>
                </tr>
              </thead>
              <tbody>
                {campos.map((c) => {
                  const obrigatorioFixo = CAMPOS_UI_PADRAO.find((p) => p.chave === c.chave)?.obrigatorio;
                  return (
                    <tr key={c.chave} className="border-b border-[#2a3147]/60 last:border-0 hover:bg-[#0f1117]/60 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-100">{c.label}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{TIPO_CAMPO[c.chave] ?? 'Texto'}</td>
                      <td className="px-4 py-3 text-center">
                        <Toggle on={c.obrigatorio} onChange={(v) => setCampo(c.chave, { obrigatorio: v })}
                          disabled={!podeEditar || !!obrigatorioFixo} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Toggle on={c.visivel} onChange={(v) => setCampo(c.chave, { visivel: v })}
                          disabled={!podeEditar} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Toggle on={c.filtro} onChange={(v) => setCampo(c.chave, { filtro: v })}
                          disabled={!podeEditar} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-2 text-xs text-slate-500 bg-[#0f1117] border border-[#2a3147]/60 rounded-lg px-4 py-3">
            <Info size={13} className="text-indigo-400 shrink-0 mt-0.5" />
            A personalização altera campos e visualizações <strong className="text-slate-300">sem misturar conceitos do CRM</strong>. Campos obrigatórios do sistema não podem ser ocultados.
          </div>
        </div>
      )}

      {/* --- Aba Filtros e visualizações --- */}
      {aba === 'filtros' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Os filtros disponíveis em Base de Leads e Pipeline são definidos pelo toggle <strong className="text-slate-300">Usar como filtro</strong> na aba Campos.</p>
          <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5">
            <h3 className="font-semibold text-slate-200 text-sm mb-3">Filtros ativos neste workspace</h3>
            <div className="flex flex-wrap gap-2">
              {campos.filter((c) => c.filtro).map((c) => (
                <span key={c.chave} className="text-xs px-3 py-1.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {c.label}
                </span>
              ))}
              {campos.filter((c) => c.filtro).length === 0 && (
                <p className="text-xs text-slate-500">Nenhum filtro adicional habilitado. Ative o toggle "Usar como filtro" na aba Campos.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Aba Pipeline --- */}
      {aba === 'pipeline' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Etapas do pipeline de contato — mudança aqui reflete na tela de Pipeline de Contato.</p>
          {pipelines.length === 0 ? (
            <div className="text-sm text-slate-500">Nenhum pipeline encontrado.</div>
          ) : pipelines.map((p) => (
            <div key={p.id} className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5">
              <div className="font-semibold text-slate-100 mb-1">
                {p.nome} <span className="text-xs text-slate-500">({p.tipo})</span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {p.estagios.map((e) => (
                  <span key={e.id} className="text-xs px-2.5 py-1 rounded-full border"
                    style={{ borderColor: (e.cor ?? '#2a3147') + '66', color: e.cor ?? '#cbd5e1' }}>
                    {e.nome} <span className="opacity-60">· {e.papel}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-600">Edição de etapas entrará em iteração seguinte — tabelas reais da migration 0014.</p>
        </div>
      )}

      {/* --- Aba Terminologia --- */}
      {aba === 'terminologia' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Renomeie termos comerciais do seu workspace. Termos estruturais (Campanha, Workflow, Empresa, Contato, Tarefa, Configurações) não podem ser renomeados.
          </p>
          {!podeEditar && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-2.5">
              <Lock size={13} /> Somente leitura — requer <code>workspace.configure</code>.
            </div>
          )}
          <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-6 max-w-2xl space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Como chamar &quot;Lead&quot; neste workspace</label>
              <input className={input} value={nomeLead} onChange={(e) => setNomeLead(e.target.value)}
                disabled={!podeEditar} placeholder="Lead" />
              <p className="text-xs text-slate-600 mt-1">Exemplo: Prospecto, Contato, Cliente potencial</p>
            </div>
            {podeEditar && (
              <button onClick={salvarCampos} disabled={salvando}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40">
                {salvo ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
