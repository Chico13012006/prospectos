'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Eye, X, Loader2, Bot } from 'lucide-react';
import { getTemplates } from '@/lib/api';
import type { Template } from '@/lib/supabase';

// Canais (valor cru no banco → rótulo + cor do badge).
const CANAIS: { value: string; label: string; classes: string }[] = [
  { value: 'email', label: 'E-mail', classes: 'bg-blue-500/20 text-blue-300' },
  { value: 'linkedin', label: 'LinkedIn', classes: 'bg-sky-500/20 text-sky-300' },
  { value: 'whatsapp', label: 'WhatsApp', classes: 'bg-green-500/20 text-green-300' },
  { value: 'telefone', label: 'Telefone', classes: 'bg-purple-500/20 text-purple-300' },
];
const canalInfo = (c: string) => CANAIS.find(x => x.value === c) ?? { value: c, label: c, classes: 'bg-[#252b3b] text-slate-300' };

// Segmento = coluna `nicho` (null = genérico).
const NICHO_LABEL: Record<string, string> = {
  oticas: 'Óticas', hotelaria: 'Hotelaria', varejo: 'Varejo',
  hospital: 'Hospital', industria: 'Indústria', alimentos: 'Alimentos',
};
const labelNicho = (n?: string | null) => (n ? NICHO_LABEL[n] ?? n : 'Genérico');

// Estágio = coluna `tipo`.
const TIPO_LABEL: Record<string, string> = {
  primeiro_contato: '1º contato',
  follow_up_1: 'Follow-up 1', follow_up_2: 'Follow-up 2', follow_up_3: 'Follow-up 3',
  abertura_geral: 'Abertura geral', gancho_reuniao: 'Gancho p/ reunião',
  pedir_material: 'Pedir material', nao_e_a_pessoa: 'Não é a pessoa',
};
const labelTipo = (t: string) => TIPO_LABEL[t] ?? t;

const VARIAVEIS = ['{nome}', '{empresa}', '{segmento}', '{cidade}', '{responsavel_comercial}'];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [filterCanal, setFilterCanal] = useState('');
  const [filterNicho, setFilterNicho] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    getTemplates()
      .then(t => { setTemplates(t); setLoading(false); })
      .catch(err => { console.error('Erro ao carregar templates:', err); setErro(true); setLoading(false); });
  }, []);

  // Opções dos selects, derivadas do que existe no banco.
  const nichosDisponiveis = useMemo(() => {
    const s = new Set(templates.map(t => t.nicho ?? '__generico__'));
    return Array.from(s);
  }, [templates]);
  const tiposDisponiveis = useMemo(() => {
    const s = new Set(templates.map(t => t.tipo));
    return Array.from(s);
  }, [templates]);

  const filtered = useMemo(() => {
    const ordemCanal = ['email', 'linkedin', 'whatsapp', 'telefone'];
    return templates
      .filter(t => !filterCanal || t.canal === filterCanal)
      .filter(t => !filterNicho || (filterNicho === '__generico__' ? !t.nicho : t.nicho === filterNicho))
      .filter(t => !filterTipo || t.tipo === filterTipo)
      .sort((a, b) =>
        (ordemCanal.indexOf(a.canal) - ordemCanal.indexOf(b.canal)) ||
        (a.nicho ?? '').localeCompare(b.nicho ?? '') ||
        a.tipo.localeCompare(b.tipo));
  }, [templates, filterCanal, filterNicho, filterTipo]);

  const previewTemplate = templates.find(t => t.id === preview);
  const temFiltro = filterCanal || filterNicho || filterTipo;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Templates</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {loading ? 'Carregando...' : `${filtered.length} de ${templates.length} templates`}
            <span className="text-slate-600"> · o motor envia só por e-mail (segmento + estágio); os demais canais são referência.</span>
          </p>
        </div>
        <button className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#1e3a5f' }}>
          <FileText size={15} /> Novo Template
        </button>
      </div>

      {/* Filtros: Canal · Segmento · Estágio */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] p-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterCanal('')}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${!filterCanal ? 'border-blue-300 bg-blue-500/10 text-blue-400' : 'border-[#2a3147] text-slate-300 hover:bg-[#0f1117]'}`}
          >
            Todos canais
          </button>
          {CANAIS.map(c => (
            <button
              key={c.value}
              onClick={() => setFilterCanal(filterCanal === c.value ? '' : c.value)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterCanal === c.value ? 'border-blue-300 bg-blue-500/10 text-blue-400' : 'border-[#2a3147] text-slate-300 hover:bg-[#0f1117]'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#2a3147]" />
        <select value={filterNicho} onChange={e => setFilterNicho(e.target.value)}
          className="text-sm border border-[#2a3147] rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none bg-[#1a1f2e]">
          <option value="">Todos os segmentos</option>
          {nichosDisponiveis.map(n => <option key={n} value={n}>{n === '__generico__' ? 'Genérico' : labelNicho(n)}</option>)}
        </select>
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
          className="text-sm border border-[#2a3147] rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none bg-[#1a1f2e]">
          <option value="">Todos os estágios</option>
          {tiposDisponiveis.map(t => <option key={t} value={t}>{labelTipo(t)}</option>)}
        </select>
        {temFiltro && (
          <button onClick={() => { setFilterCanal(''); setFilterNicho(''); setFilterTipo(''); }}
            className="text-xs text-slate-400 hover:text-slate-200 underline">
            Limpar
          </button>
        )}
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Carregando templates...</span>
        </div>
      ) : erro ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
          <span className="text-sm font-medium text-slate-400">Sem conexão com os dados.</span>
          <span className="text-xs">Verifique a conexão com o Supabase.</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-500 text-sm">Nenhum template com esses filtros.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filtered.map(t => {
            const ci = canalInfo(t.canal);
            return (
              <div key={t.id} className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-100 leading-tight">{t.nome}</h3>
                      {t.assunto && <div className="text-xs text-slate-400 mt-1">✉ {t.assunto}</div>}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${ci.classes}`}>{ci.label}</span>
                  </div>

                  {/* Badges: segmento + estágio */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="text-xs bg-[#252b3b] text-slate-300 px-2 py-0.5 rounded-full">{labelNicho(t.nicho)}</span>
                    <span className="text-xs bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full">{labelTipo(t.tipo)}</span>
                  </div>

                  <div className="text-xs text-slate-400 bg-[#0f1117] rounded-lg p-3 line-clamp-3 leading-relaxed border border-[#2a3147] whitespace-pre-wrap">
                    {t.corpo}
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-[#2a3147] flex items-center justify-between bg-[#0f1117]/50">
                  <span className="text-xs text-slate-500">{t.canal === 'email' ? 'Enviado pelo motor' : 'Referência (manual)'}</span>
                  <button
                    onClick={() => setPreview(t.id)}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                  >
                    <Eye size={13} /> Preview
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPreview(null)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg text-slate-100">{previewTemplate.nome}</h3>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${canalInfo(previewTemplate.canal).classes}`}>{canalInfo(previewTemplate.canal).label}</span>
                  <span className="text-xs bg-[#252b3b] text-slate-300 px-2 py-0.5 rounded-full">{labelNicho(previewTemplate.nicho)}</span>
                  <span className="text-xs bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full">{labelTipo(previewTemplate.tipo)}</span>
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>

            {previewTemplate.assunto && (
              <div className="mb-3 bg-[#0f1117] rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-400 font-medium">Assunto: </span>
                <span className="text-slate-200">{previewTemplate.assunto}</span>
              </div>
            )}

            <div className="bg-[#0f1117] rounded-xl p-4 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed border border-[#2a3147]">
              {previewTemplate.corpo}
            </div>

            {previewTemplate.canal === 'email' && previewTemplate.tipo.startsWith('follow_up') && (
              <div className="mt-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 text-xs text-amber-300 flex items-start gap-1.5">
                <Bot size={13} className="mt-0.5 shrink-0" />
                <span>No envio, o motor usa o assunto do 1º contato deste lead com “Re:” para manter a mesma thread.</span>
              </div>
            )}

            <div className="mt-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <div className="text-xs font-semibold text-blue-400 mb-1.5">Variáveis disponíveis:</div>
              <div className="flex flex-wrap gap-2">
                {VARIAVEIS.map(v => (
                  <code key={v} className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">{v}</code>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
