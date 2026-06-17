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
          <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} de {templates.length} templates</p>
        </div>
        <button className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#1e3a5f' }}>
          <FileText size={15} /> Novo Template
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          <button
            onClick={() => setFilterCanal('')}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${!filterCanal ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Todos canais
          </button>
          {CANAIS.map(c => (
            <button
              key={c}
              onClick={() => setFilterCanal(filterCanal === c ? '' : c)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterCanal === c ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-gray-200" />
        <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none bg-white">
          <option value="">Todas as tags</option>
          {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        {(filterCanal || filterTag) && (
          <button onClick={() => { setFilterCanal(''); setFilterTag(''); }}
            className="text-xs text-gray-500 hover:text-gray-800 underline">
            Limpar
          </button>
        )}
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-2 gap-4">
        {filtered.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 leading-tight">{t.nome}</h3>
                  {t.assunto && (
                    <div className="text-xs text-gray-500 mt-1">✉ {t.assunto}</div>
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${getCanalBadgeClasses(t.canal)}`}>
                  {t.canal}
                </span>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {t.tags.map(tag => (
                  <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Body preview */}
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 line-clamp-3 leading-relaxed border border-gray-100">
                {t.corpo}
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-green-500" />
                  <div>
                    <div className="flex items-center gap-1">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${t.taxa_resposta}%` }} />
                      </div>
                      <span className="text-xs font-bold text-green-600">{t.taxa_resposta}%</span>
                    </div>
                    <div className="text-xs text-gray-400">{t.total_usos} usos</div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPreview(t.id)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg text-gray-900">{previewTemplate.nome}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(previewTemplate.canal)}`}>
                    {previewTemplate.canal}
                  </span>
                  <span className="text-xs text-green-600 font-medium">Taxa de resposta: {previewTemplate.taxa_resposta}%</span>
                </div>
              </div>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            {previewTemplate.assunto && (
              <div className="mb-3 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-500 font-medium">Assunto: </span>
                <span className="text-gray-800">{previewTemplate.assunto}</span>
              </div>
            )}

            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed border border-gray-100">
              {previewTemplate.corpo}
            </div>

            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <div className="text-xs font-semibold text-blue-700 mb-1.5">Variáveis disponíveis:</div>
              <div className="flex flex-wrap gap-2">
                {['{{nome}}', '{{empresa}}', '{{cargo}}', '{{segmento}}'].map(v => (
                  <code key={v} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{v}</code>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {previewTemplate.tags.map(tag => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
