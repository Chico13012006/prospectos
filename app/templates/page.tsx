'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/contexts/AppContext';
import { getCanalBadgeClasses } from '@/lib/utils';
import type { Canal } from '@/lib/types';
import { FileText, TrendingUp, Eye, X } from 'lucide-react';

const CANAIS: Canal[] = ['LinkedIn', 'Email', 'WhatsApp', 'Telefone'];

export default function TemplatesPage() {
  const { templates } = useApp();
  const [filterCanal, setFilterCanal] = useState<Canal | ''>('');
  const [filterTag, setFilterTag] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    templates.forEach(t => t.tags.forEach(tag => s.add(tag)));
    return Array.from(s).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    let list = [...templates];
    if (filterCanal) list = list.filter(t => t.canal === filterCanal);
    if (filterTag) list = list.filter(t => t.tags.includes(filterTag));
    return list.sort((a, b) => b.taxa_resposta - a.taxa_resposta);
  }, [templates, filterCanal, filterTag]);

  const previewTemplate = templates.find(t => t.id === preview);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Templates</h1>
          <p className="text-slate-400 text-sm mt-0.5">{filtered.length} de {templates.length} templates</p>
        </div>
        <button className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#1e3a5f' }}>
          <FileText size={15} /> Novo Template
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          <button
            onClick={() => setFilterCanal('')}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${!filterCanal ? 'border-blue-300 bg-blue-500/10 text-blue-400' : 'border-[#2a3147] text-slate-300 hover:bg-[#0f1117]'}`}
          >
            Todos canais
          </button>
          {CANAIS.map(c => (
            <button
              key={c}
              onClick={() => setFilterCanal(filterCanal === c ? '' : c)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterCanal === c ? 'border-blue-300 bg-blue-500/10 text-blue-400' : 'border-[#2a3147] text-slate-300 hover:bg-[#0f1117]'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-[#2a3147]" />
        <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
          className="text-sm border border-[#2a3147] rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none bg-[#1a1f2e]">
          <option value="">Todas as tags</option>
          {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        {(filterCanal || filterTag) && (
          <button onClick={() => { setFilterCanal(''); setFilterTag(''); }}
            className="text-xs text-slate-400 hover:text-slate-200 underline">
            Limpar
          </button>
        )}
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-2 gap-4">
        {filtered.map(t => (
          <div key={t.id} className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none overflow-hidden hover:shadow-none transition-shadow">
            <div className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-100 leading-tight">{t.nome}</h3>
                  {t.assunto && (
                    <div className="text-xs text-slate-400 mt-1">✉ {t.assunto}</div>
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${getCanalBadgeClasses(t.canal)}`}>
                  {t.canal}
                </span>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {t.tags.map(tag => (
                  <span key={tag} className="text-xs bg-[#252b3b] text-slate-400 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Body preview */}
              <div className="text-xs text-slate-400 bg-[#0f1117] rounded-lg p-3 line-clamp-3 leading-relaxed border border-[#2a3147]">
                {t.corpo}
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-[#2a3147] flex items-center justify-between bg-[#0f1117]/50">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-green-500" />
                  <div>
                    <div className="flex items-center gap-1">
                      <div className="w-16 bg-[#2a3147] rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${t.taxa_resposta}%` }} />
                      </div>
                      <span className="text-xs font-bold text-green-400">{t.taxa_resposta}%</span>
                    </div>
                    <div className="text-xs text-slate-500">{t.total_usos} usos</div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPreview(t.id)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
              >
                <Eye size={13} /> Preview
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPreview(null)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg text-slate-100">{previewTemplate.nome}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(previewTemplate.canal)}`}>
                    {previewTemplate.canal}
                  </span>
                  <span className="text-xs text-green-400 font-medium">Taxa de resposta: {previewTemplate.taxa_resposta}%</span>
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="text-slate-500 hover:text-slate-300">
                <X size={20} />
              </button>
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

            <div className="mt-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <div className="text-xs font-semibold text-blue-400 mb-1.5">Variáveis disponíveis:</div>
              <div className="flex flex-wrap gap-2">
                {['{{nome}}', '{{empresa}}', '{{cargo}}', '{{segmento}}'].map(v => (
                  <code key={v} className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">{v}</code>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {previewTemplate.tags.map(tag => (
                <span key={tag} className="text-xs bg-[#252b3b] text-slate-400 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
