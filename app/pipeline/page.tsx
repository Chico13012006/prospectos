'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/contexts/AppContext';
import {
  Settings, Plus, Search, X, Star, ExternalLink, Mail, Phone,
  MessageSquare, Bot, User, ArrowRight, CheckCircle,
  Zap, FileText, Bell, BarChart2, Loader2, Clock,
} from 'lucide-react';
import { getStatusLabel, getStatusBadgeClasses, getEstagioPipelineLabel, formatDate, formatDateTime } from '@/lib/utils';
import { SdrPill, SdrCircle } from '@/components/ui/SdrAvatar';
import type { Empresa, Contato, EstagioPipeline } from '@/lib/types';
import { getLeads, getInteracoesByLead, createInteracao } from '@/lib/api';
import type { Lead, Interacao } from '@/lib/supabase';

const TODAY = '2026-06-16';

const STAGES = [
  { id: 'novos_leads', label: 'Novos Leads', color: '#6366f1' },
  { id: 'primeiro_contato', label: 'Primeiro Contato Enviado', color: '#3b82f6' },
  { id: 'aguardando_resposta', label: 'Aguardando Resposta', color: '#f59e0b' },
  { id: 'follow_up', label: 'Follow-up', color: '#ef4444' },
  { id: 'interessado', label: 'Interessado', color: '#8b5cf6' },
  { id: 'reuniao_agendada', label: 'Reunião Agendada', color: '#22c55e' },
] as const;

const AI_ACTIONS: Record<string, { action: string; reason: string }> = {
  'emp-001': { action: 'Executar Follow-up 3 via E-mail', reason: 'Leads similares tiveram 22% mais respostas com envio de case técnico após D7.' },
  'emp-002': { action: 'Executar Follow-up 4 via Telefone', reason: 'Petróleo/Mineração responde melhor a contato humano nesta etapa. Taxa 3,4x maior.' },
  'emp-003': { action: 'Confirmar reunião e enviar proposta', reason: 'Lead com interesse confirmado. Proposta deve ser enviada em até 48h.' },
  'emp-004': { action: 'Iniciar cadência Agro via WhatsApp', reason: 'Leads do segmento Agro respondem 31% mais ao WhatsApp como primeiro contato.' },
  'emp-005': { action: 'Executar Follow-up 2 via LinkedIn', reason: 'Indústria responde bem ao segundo toque após 3 dias. Taxa de 12% no D3.' },
  'emp-006': { action: 'Aguardar Q4 — sem orçamento', reason: 'Lead informou que orçamento está congelado. Reativar em outubro.' },
  'emp-007': { action: 'Enviar case de operação médio porte', reason: 'Lead pediu cases de 50-200 colaboradores. Envio rápido aumenta 47% a chance de reunião.' },
  'emp-008': { action: 'Enviar case de rastreamento bovino', reason: 'Lead pediu material específico. Alta probabilidade de avanço após recebimento.' },
  'emp-009': { action: 'Aguardar até meados de julho', reason: 'Lead pediu recontato após parada programada. Ação prematura pode gerar opt-out.' },
  'emp-010': { action: 'Reativar em agosto 2026', reason: 'Cadência finalizada sem resposta. Programada para reativação em 90 dias.' },
};

const AI_SUMMARIES: Record<string, string> = {
  'emp-001': 'Empresa do setor logístico com operação de cross-docking em São Paulo. Decisor é Carlos Mendes, Diretor de Operações. Potencial para rastreamento de ativos em docas de distribuição com RFID.',
  'emp-002': 'Planta em Macaé com 200+ colaboradores no setor de Petróleo. Roberto Alves é o ponto de contato. Alto potencial para rastreamento de EPIs e equipamentos de campo.',
  'emp-003': 'Operação de mineração com nova planta em Itabira. Adriana Santos demonstrou interesse positivo e pediu proposta para projeto piloto de rastreamento de EPIs e ferramentas.',
  'emp-004': 'Lead gerado via automação. Paulo Ferreira, CEO, prefere WhatsApp. Empresa em fase de avaliação de soluções para rastreamento no campo agro.',
  'emp-005': 'Empresa metalúrgica em Santo André. Marcos Oliveira, Gerente Industrial, é o contato principal. Potencial para rastreamento de ferramentas e controle de estoque.',
  'emp-006': 'Gerente de TI informou que orçamento para TI está congelado até Q4. Candidata a reativação em outubro com nova proposta de valor.',
  'emp-007': 'Contato feito em evento do setor. Antônio Costa, Gerente de Manutenção, pediu cases de operações de 50-200 colaboradores. Alta probabilidade de avanço com material certo.',
  'emp-008': 'Granja com 12.000 cabeças bovinas em Uberlândia. Luciana Pereira pediu case de rastreamento de rebanho. Oportunidade no agronegócio de precisão.',
  'emp-009': 'Grande operação de minério de ferro no Pará. Daniel Almeida pediu recontato para julho após parada programada de manutenção.',
  'emp-010': 'Transportadora em Campinas sem resposta após cadência completa. Programada para reativação em agosto 2026.',
};

// Adapta um Lead do Supabase para o shape Empresa usado pelo layout
function leadToEmpresa(lead: Lead): Empresa {
  return {
    id: lead.id,
    nome: lead.empresa,
    segmento: lead.segmento as Empresa['segmento'],
    origem: (lead.origem || 'Automação') as Empresa['origem'],
    cidade: lead.cidade,
    estado: lead.estado,
    website: lead.site ?? undefined,
    responsavel: lead.usuarios?.nome ?? lead.responsavel_id ?? '',
    status: 'em_prospeccao',
    estagio_pipeline: lead.estagio as Empresa['estagio_pipeline'],
    em_cadencia: false,
    data_entrada: lead.created_at,
    ultimo_contato: lead.ultimo_contato ?? undefined,
    blacklist: false,
    score_engajamento: lead.score,
    observacoes: lead.proxima_acao ?? undefined,
    funcionarios_faixa: lead.faixa_funcionarios ?? undefined,
  };
}

// Cria um Contato sintético a partir dos campos de contato embutidos no Lead
function leadToContato(lead: Lead): Contato {
  const canalMap: Record<Lead['canal_preferencial'], Contato['canal_preferencial']> = {
    email: 'Email',
    whatsapp: 'WhatsApp',
    linkedin: 'LinkedIn',
    telefone: 'Telefone',
  };
  return {
    id: `${lead.id}-contato`,
    empresa_id: lead.id,
    nome: lead.contato_nome,
    cargo: lead.contato_cargo,
    canal_preferencial: canalMap[lead.canal_preferencial],
    email: lead.contato_email || undefined,
    telefone: lead.contato_telefone ?? undefined,
    linkedin_url: lead.linkedin ?? undefined,
    principal: true,
    blacklist: false,
  };
}

function daysBetween(a: string, b: string) {
  return Math.floor(
    (new Date(b.substring(0, 10)).getTime() - new Date(a.substring(0, 10)).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

// Rótulo e ícone por tipo de interação vinda do Supabase
const INTERACAO_TIPO: Record<string, { label: string; Icon: typeof Bot; color: string }> = {
  abordagem: { label: 'Abordagem', Icon: User, color: 'text-green-500' },
  resposta: { label: 'Resposta recebida', Icon: MessageSquare, color: 'text-green-600' },
  follow_up: { label: 'Follow-up registrado', Icon: CheckCircle, color: 'text-green-600' },
  nota: { label: 'Nota', Icon: FileText, color: 'text-gray-500' },
  reuniao: { label: 'Reunião', Icon: Bell, color: 'text-purple-500' },
};

// Badge de tipo na Central do Lead (cobre variações de follow_up: follow_up_1/2/3/4)
function getTipoInteracaoBadge(tipo: string): { label: string; classes: string } {
  if (tipo === 'abordagem') return { label: 'Primeiro contato enviado', classes: 'bg-blue-100 text-blue-700' };
  if (tipo.startsWith('follow_up')) return { label: 'Follow-up enviado', classes: 'bg-purple-100 text-purple-700' };
  if (tipo === 'resposta') return { label: 'Resposta recebida', classes: 'bg-green-100 text-green-700' };
  if (tipo === 'nota') return { label: 'Nota', classes: 'bg-gray-100 text-gray-600' };
  if (tipo === 'reuniao') return { label: 'Reunião', classes: 'bg-amber-100 text-amber-700' };
  return { label: tipo, classes: 'bg-gray-100 text-gray-600' };
}

// Badge de status (lado direito) derivado do tipo
function getStatusInteracao(tipo: string): { label: string; classes: string } | null {
  if (tipo === 'abordagem' || tipo.startsWith('follow_up')) return { label: 'Enviado', classes: 'bg-blue-50 text-blue-600' };
  if (tipo === 'resposta') return { label: 'Respondido', classes: 'bg-green-50 text-green-600' };
  if (tipo === 'reuniao') return { label: 'Agendado', classes: 'bg-amber-50 text-amber-600' };
  return null;
}

// Rótulo, ícone e cor do canal (valores em minúsculo no Supabase)
const CANAL_INFO: Record<string, { label: string; Icon: typeof Bot; classes: string }> = {
  email: { label: 'Email', Icon: Mail, classes: 'bg-gray-100 text-gray-700' },
  whatsapp: { label: 'WhatsApp', Icon: MessageSquare, classes: 'bg-green-100 text-green-700' },
  linkedin: { label: 'LinkedIn', Icon: ExternalLink, classes: 'bg-blue-100 text-blue-700' },
  telefone: { label: 'Telefone', Icon: Phone, classes: 'bg-purple-100 text-purple-700' },
};

function scoreColor(score: number): string {
  if (score >= 70) return '#16a34a';
  if (score < 50) return '#f97316';
  return '#6b7280';
}

function LeadCard({ empresa, onClick }: { empresa: Empresa; onClick: () => void }) {
  const timeSince = empresa.ultimo_contato
    ? daysBetween(empresa.ultimo_contato, TODAY)
    : daysBetween(empresa.data_entrada, TODAY);

  const isDelayed = timeSince > 5 && empresa.estagio_pipeline === 'aguardando_resposta';

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 cursor-pointer hover:shadow-md hover:border-indigo-200 transition-all"
    >
      <div className="font-medium text-sm text-gray-900 leading-tight mb-2">{empresa.nome}</div>
      <div className="text-xs text-gray-500 mb-2">{empresa.cidade}, {empresa.estado}</div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
          {empresa.segmento}
        </span>
        <span className={`text-xs ${isDelayed ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
          {empresa.estagio_pipeline === 'novos_leads'
            ? `Adicionado há ${timeSince}d`
            : empresa.estagio_pipeline === 'aguardando_resposta'
            ? `${timeSince}d sem resposta`
            : empresa.estagio_pipeline === 'primeiro_contato'
            ? `Enviado há ${timeSince}d`
            : `${timeSince}d atrás`}
        </span>
      </div>
      <div className="flex gap-1.5 mb-3">
        {empresa.em_cadencia && <span title="LinkedIn"><ExternalLink size={11} className="text-indigo-400" /></span>}
        <span title="Email"><Mail size={11} className="text-gray-300" /></span>
        {empresa.segmento === 'Agro' && <span title="WhatsApp"><MessageSquare size={11} className="text-green-400" /></span>}
        {(empresa.segmento === 'Petróleo' || empresa.segmento === 'Mineração') ? <span title="Telefone"><Phone size={11} className="text-purple-400" /></span> : null}
      </div>
      <div style={{ borderTop: '0.5px solid #EBEBEB', paddingTop: 8 }}>
        <SdrPill name={empresa.responsavel} />
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { empresas: mockEmpresas, contatos: mockContatos, getTimelineForEmpresa } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [supabaseLeads, setSupabaseLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [interacoes, setInteracoes] = useState<Interacao[]>([]);
  const [loadingInteracoes, setLoadingInteracoes] = useState(false);
  const [interacoesError, setInteracoesError] = useState(false);
  const [showAllInteracoes, setShowAllInteracoes] = useState(false);
  // Central do Lead (modal completo)
  const [centralTab, setCentralTab] = useState<'timeline' | 'dados'>('timeline');
  const [showRegistrar, setShowRegistrar] = useState(false);
  const [novaInteracao, setNovaInteracao] = useState({ tipo: 'abordagem', canal: 'email', descricao: '' });
  const [salvandoInteracao, setSalvandoInteracao] = useState(false);

  useEffect(() => {
    async function carregar() {
      try {
        const data = await getLeads();
        setSupabaseLeads(data);
      } catch (err) {
        console.error('Erro ao carregar leads:', err);
        setUseFallback(true);
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, []);

  // Supabase é fonte ativa quando carregou sem erro (mesmo que vazio)
  const usingSupabase = !useFallback && !loading;

  // Carrega (ou recarrega) as interações reais do lead selecionado
  const carregarInteracoes = useCallback(async () => {
    if (!selectedId || !usingSupabase) {
      setInteracoes([]);
      setInteracoesError(false);
      return;
    }
    setLoadingInteracoes(true);
    setInteracoesError(false);
    try {
      const data = await getInteracoesByLead(selectedId);
      setInteracoes(data);
    } catch (err) {
      console.error('Erro ao carregar interações:', err);
      setInteracoesError(true);
    } finally {
      setLoadingInteracoes(false);
    }
  }, [selectedId, usingSupabase]);

  // Busca as interações quando o painel abre / troca de lead e reseta a Central
  useEffect(() => {
    setShowAllInteracoes(false);
    setCentralTab('timeline');
    setShowRegistrar(false);
    setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' });
    carregarInteracoes();
  }, [selectedId, usingSupabase, carregarInteracoes]);

  // Lista de empresas para o Kanban
  const activeLeads: Empresa[] = usingSupabase
    ? supabaseLeads.map(leadToEmpresa)
    : mockEmpresas.filter(e => !e.blacklist && e.status !== 'descartado');

  const filtered = activeLeads.filter(e =>
    !search ||
    e.nome.toLowerCase().includes(search.toLowerCase()) ||
    e.segmento.toLowerCase().includes(search.toLowerCase())
  );

  // Dados do painel lateral
  const selectedEmpresa: Empresa | null = selectedId
    ? (usingSupabase
        ? (() => { const l = supabaseLeads.find(l => l.id === selectedId); return l ? leadToEmpresa(l) : null; })()
        : mockEmpresas.find(e => e.id === selectedId) ?? null)
    : null;

  const selectedContato: Contato | null = selectedId
    ? (usingSupabase
        ? (() => { const l = supabaseLeads.find(l => l.id === selectedId); return l ? leadToContato(l) : null; })()
        : mockContatos.find(c => c.empresa_id === selectedId && c.principal) ?? null)
    : null;

  // Lead bruto do Supabase para a Central do Lead (dados 100% reais)
  const selectedLead: Lead | null = usingSupabase && selectedId
    ? supabaseLeads.find(l => l.id === selectedId) ?? null
    : null;

  // Salva uma nova interação manual e recarrega a timeline
  async function handleRegistrarInteracao() {
    if (!selectedId || !novaInteracao.descricao.trim()) return;
    setSalvandoInteracao(true);
    try {
      await createInteracao({
        lead_id: selectedId,
        tipo: novaInteracao.tipo as Interacao['tipo'],
        canal: novaInteracao.canal,
        descricao: novaInteracao.descricao.trim(),
        origem_acao: 'humano',
      });
      setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' });
      setShowRegistrar(false);
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao registrar interação:', err);
    } finally {
      setSalvandoInteracao(false);
    }
  }

  // Timeline mock — usada quando o Supabase não é a fonte ativa ou como fallback de erro
  const fullMockTimeline = selectedId
    ? [...getTimelineForEmpresa(selectedId)].reverse()
    : [];
  const mockTimeline = fullMockTimeline.slice(0, 6);
  // Renderiza o histórico mock quando não há Supabase ativo ou quando a busca falhou
  const showMockTimeline = !usingSupabase || interacoesError;

  const panelTimeSince = selectedEmpresa
    ? (selectedEmpresa.ultimo_contato
        ? daysBetween(selectedEmpresa.ultimo_contato, TODAY)
        : daysBetween(selectedEmpresa.data_entrada, TODAY))
    : 0;
  const isActionDelayed = !!selectedEmpresa && panelTimeSince > 5 &&
    (selectedEmpresa.estagio_pipeline === 'aguardando_resposta' ||
     selectedEmpresa.estagio_pipeline === 'follow_up');

  return (
    <div className="flex flex-col" style={{ minHeight: '100vh' }}>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline de Contato</h1>
          <p className="text-sm text-gray-500 mt-0.5">Visão Kanban com execução automática de ações</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50">
            <Settings size={14} /> Configurar automações
          </button>
          <button
            className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            <Plus size={14} /> Novo lead
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 pb-4 flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar empresa ou contato..."
            className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white w-52 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        {['Todos os canais', 'Todos os responsáveis', 'Todos os nichos', 'Todos os status'].map(f => (
          <select key={f} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-600 focus:outline-none">
            <option>{f}</option>
          </select>
        ))}
        <span className="text-xs text-gray-400 ml-auto">Ordenar: Mais recentes</span>
      </div>

      {/* Kanban */}
      <div className="overflow-x-auto px-6 pb-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Carregando leads...</span>
          </div>
        ) : usingSupabase && supabaseLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <span className="text-sm font-medium text-gray-500">Nenhum lead encontrado.</span>
            <span className="text-xs">Importe seus contatos para começar.</span>
          </div>
        ) : (
          <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
            {STAGES.map(stage => {
              const stageLeads = filtered.filter(e => e.estagio_pipeline === stage.id);
              return (
                <div key={stage.id} style={{ width: 240 }} className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-sm font-semibold text-gray-700 leading-tight">{stage.label}</span>
                    </div>
                    <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {stageLeads.length}
                    </span>
                  </div>

                  <div className="space-y-2.5 flex-1" style={{ minHeight: 120 }}>
                    {stageLeads.map(empresa => (
                      <LeadCard
                        key={empresa.id}
                        empresa={empresa}
                        onClick={() => setSelectedId(empresa.id)}
                      />
                    ))}
                  </div>

                  <button className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-xl py-2.5 hover:border-gray-300 transition-colors">
                    <Plus size={12} /> Adicionar lead
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Como funciona */}
      <div className="px-6 pb-5">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-5 flex items-center gap-2">
            <Zap size={16} className="text-amber-500" />
            Como funciona o processo
          </h2>
          <div className="flex items-start">
            {[
              { n: '1', title: 'Lead no Kanban', desc: 'Lead está no estágio aguardando a próxima ação.' },
              { n: '2', title: 'Abrir lead', desc: 'Clique no card para abrir o painel com todas as informações.' },
              { n: '3', title: 'Executar ação', desc: "Clique em 'Executar ação' para disparar o follow-up recomendado pela IA." },
              { n: '4', title: 'Ação é executada', desc: 'O sistema dispara a automação via n8n e registra no histórico.' },
              { n: '5', title: 'Kanban é atualizado', desc: 'O lead é movido automaticamente para o próximo estágio.' },
            ].map((step, i) => (
              <div key={step.n} className="flex items-start flex-1">
                <div className="flex flex-col items-center flex-1 pr-2">
                  <div className="flex items-center w-full">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold flex items-center justify-center shrink-0">
                      {step.n}
                    </div>
                    {i < 4 && <div className="flex-1 h-0.5 bg-indigo-100 mx-1.5" />}
                  </div>
                  <div className="mt-2 w-full">
                    <div className="text-sm font-semibold text-gray-800">{step.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5 leading-snug">{step.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Automações + Benefícios + Ações */}
      <div className="px-6 pb-8 grid grid-cols-3 gap-5">
        <div className="col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4">
            Automações que acontecem ao executar uma ação
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { Icon: MessageSquare, color: '#6366f1', title: 'Dispara mensagem', desc: 'A IA gera a mensagem e dispara no canal selecionado.' },
              { Icon: FileText, color: '#3b82f6', title: 'Registra interação', desc: 'A interação é registrada no histórico com data e hora.' },
              { Icon: Zap, color: '#f59e0b', title: 'Atualiza próxima ação', desc: 'A próxima ação e a data são recalculadas automaticamente.' },
              { Icon: BarChart2, color: '#22c55e', title: 'Move no Kanban', desc: 'O lead é movido automaticamente para o próximo estágio.' },
              { Icon: Bell, color: '#8b5cf6', title: 'Notifica responsável', desc: 'O responsável recebe notificação da ação executada.' },
              { Icon: BarChart2, color: '#ef4444', title: 'Atualiza métricas', desc: 'As métricas e relatórios são atualizados em tempo real.' },
            ].map(item => (
              <div key={item.title} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2"
                  style={{ backgroundColor: `${item.color}18` }}>
                  <item.Icon size={15} style={{ color: item.color }} />
                </div>
                <div className="text-sm font-semibold text-gray-800 mb-0.5">{item.title}</div>
                <div className="text-xs text-gray-500 leading-snug">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-3 text-sm">Benefícios deste fluxo</h2>
            <ul className="space-y-2">
              {[
                'Execução de ações em 1 clique',
                'Kanban sempre atualizado automaticamente',
                'Histórico completo de todas as interações',
                'Próximas ações recomendadas pela IA',
                'Automação 100% integrada com n8n',
              ].map(b => (
                <li key={b} className="flex items-start gap-2 text-xs text-gray-600">
                  <CheckCircle size={12} className="text-green-500 mt-0.5 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-3 text-sm">Ações disponíveis no lead</h2>
            <ul className="space-y-2">
              {[
                'Executar próxima ação',
                'Gerar nova mensagem com IA',
                'Mover para outro estágio',
                'Atribuir responsável',
                'Marcar como perdido',
                'Ver histórico completo',
              ].map(a => (
                <li key={a} className="flex items-start gap-2 text-xs text-gray-600">
                  <ArrowRight size={11} className="text-indigo-400 mt-0.5 shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Right panel */}
      {selectedEmpresa && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedId(null)}
          />
          <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col">
            {/* Panel header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-3 flex-1 min-w-0 pr-3">
                  <SdrCircle name={selectedEmpresa.responsavel} />
                  <div className="min-w-0">
                    <h2 className="font-bold text-gray-900 text-lg leading-tight">{selectedEmpresa.nome}</h2>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {selectedEmpresa.cidade}, {selectedEmpresa.estado}
                      {' · '}{selectedEmpresa.segmento}
                      {selectedEmpresa.funcionarios_faixa && ` · ${selectedEmpresa.funcionarios_faixa} func.`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="text-gray-300 hover:text-amber-400 transition-colors"><Star size={16} /></button>
                  <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-700 transition-colors"><X size={18} /></button>
                </div>
              </div>
              {selectedContato ? (
                <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                  <span className="text-sm font-semibold text-gray-800 truncate shrink-0">{selectedContato.nome}</span>
                  <span className="text-gray-300 text-xs shrink-0">|</span>
                  <span className="text-xs text-gray-500 truncate shrink-0">{selectedContato.cargo}</span>
                  <span className="text-gray-300 text-xs shrink-0">|</span>
                  <span className="text-xs text-gray-600 shrink-0">{selectedContato.canal_preferencial}</span>
                  <div className="flex items-center gap-2 ml-auto shrink-0 text-gray-400">
                    {selectedContato.email && (
                      <a href={`mailto:${selectedContato.email}`} className="hover:text-blue-600 transition-colors" title={selectedContato.email}><Mail size={13} /></a>
                    )}
                    {selectedContato.telefone && (
                      <a href={`tel:${selectedContato.telefone}`} className="hover:text-green-600 transition-colors" title={selectedContato.telefone}><Phone size={13} /></a>
                    )}
                    {selectedContato.canal_preferencial === 'WhatsApp' && selectedContato.telefone && (
                      <a href={`https://wa.me/${selectedContato.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                        className="hover:text-green-500 transition-colors" title="WhatsApp"><MessageSquare size={13} /></a>
                    )}
                    {selectedContato.linkedin_url && (
                      <a href={`https://${selectedContato.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                        className="hover:text-blue-600 transition-colors" title="LinkedIn"><ExternalLink size={13} /></a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-gray-400">
                  {selectedEmpresa.website && (
                    <a href={selectedEmpresa.website} target="_blank" rel="noopener noreferrer"
                      className="hover:text-blue-600 transition-colors" title="Site"><ExternalLink size={13} /></a>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Status */}
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusBadgeClasses(selectedEmpresa.status)}`}>
                  {getStatusLabel(selectedEmpresa.status)}
                </span>
                {selectedEmpresa.em_cadencia && (
                  <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
                    Cadência ativa
                  </span>
                )}
                <div className="ml-auto">
                  <SdrPill name={selectedEmpresa.responsavel} />
                </div>
              </div>

              {/* 4 KPI cards */}
              <div className="px-4 py-3 border-b border-gray-100 grid grid-cols-2 gap-2">
                {[
                  {
                    label: 'Último contato',
                    value: `${panelTimeSince}d`,
                    sub: panelTimeSince === 0 ? 'hoje' : 'atrás',
                    color: panelTimeSince > 7 ? '#ef4444' : '#374151',
                  },
                  {
                    label: 'Score',
                    value: String(selectedEmpresa.score_engajamento),
                    sub: '/ 100',
                    color: selectedEmpresa.score_engajamento >= 70 ? '#16a34a' : selectedEmpresa.score_engajamento >= 40 ? '#d97706' : '#ef4444',
                  },
                  {
                    label: 'Estágio',
                    value: STAGES.find(s => s.id === selectedEmpresa.estagio_pipeline)?.label ?? selectedEmpresa.estagio_pipeline,
                    sub: '',
                    color: STAGES.find(s => s.id === selectedEmpresa.estagio_pipeline)?.color ?? '#374151',
                  },
                  {
                    label: 'Canal preferencial',
                    value: selectedContato?.canal_preferencial ?? '—',
                    sub: '',
                    color: '#374151',
                  },
                ].map(card => (
                  <div key={card.label} className="bg-gray-50 rounded-xl px-3 py-2" style={{ maxHeight: 80 }}>
                    <div className="text-xs text-gray-400 mb-1 leading-none">{card.label}</div>
                    <div className="font-bold text-sm leading-tight truncate" style={{ color: card.color }}>{card.value}</div>
                    {card.sub && <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Próxima ação IA */}
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="flex items-center gap-1.5 mb-2">
                  <Bot size={12} className="text-indigo-500" />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Próxima ação · IA</span>
                  {isActionDelayed && (
                    <span className="ml-auto text-xs font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Atrasada</span>
                  )}
                </div>
                <div className={`rounded-xl px-3 py-2 mb-2 ${isActionDelayed ? 'bg-red-50' : 'bg-indigo-50'}`}>
                  <p className={`text-sm font-semibold leading-snug ${isActionDelayed ? 'text-red-900' : 'text-indigo-900'}`}>
                    {selectedEmpresa.observacoes ?? AI_ACTIONS[selectedEmpresa.id]?.action ?? 'Executar próxima etapa da cadência'}
                  </p>
                </div>
                <button className="w-full text-xs font-medium text-gray-600 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors mb-2">
                  Registrar ação
                </button>
                <div className="flex gap-2">
                  <button className="flex-1 text-xs font-semibold text-white py-1.5 rounded-lg transition-opacity hover:opacity-90" style={{ backgroundColor: '#6366f1' }}>
                    Executar ação
                  </button>
                  <button className="flex-1 text-xs font-medium text-gray-600 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                    Gerar mensagem
                  </button>
                </div>
              </div>

              {/* Resumo IA */}
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Bot size={12} className="text-green-500" />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Resumo · IA</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                  {AI_SUMMARIES[selectedEmpresa.id] ?? (selectedEmpresa.observacoes ?? 'Sem resumo disponível.')}
                </p>
              </div>

              {/* Registrar interação */}
              <div className="px-5 py-3 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-2">Registrar interação</span>
                <div className="flex gap-2">
                  {(['Abordagem', 'Resposta', 'Follow-up'] as const).map(tipo => (
                    <button
                      key={tipo}
                      className="flex-1 text-xs font-medium text-gray-600 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      {tipo}
                    </button>
                  ))}
                </div>
              </div>

              {/* Histórico */}
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de interações</span>
                  <button
                    type="button"
                    onClick={() => setShowAllInteracoes(true)}
                    className="text-xs text-indigo-600 hover:underline flex items-center gap-0.5"
                  >
                    Ver tudo <ArrowRight size={10} />
                  </button>
                </div>
                {showMockTimeline ? (
                  mockTimeline.length === 0 ? (
                    <p className="text-xs text-gray-400">Nenhuma interação registrada.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {mockTimeline.map((entry, i) => (
                        <div key={i} className="flex items-start gap-2.5">
                          <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                            {entry.kind === 'abordagem' && (
                              entry.item.origem_acao === 'automatico'
                                ? <Bot size={10} className="text-blue-500" />
                                : <User size={10} className="text-green-500" />
                            )}
                            {entry.kind === 'resposta' && <MessageSquare size={10} className="text-green-600" />}
                            {entry.kind === 'followup' && <CheckCircle size={10} className="text-green-600" />}
                            {entry.kind === 'webhook' && <Zap size={10} className="text-purple-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-700">
                              {entry.kind === 'abordagem' && `Abordagem via ${entry.item.canal}`}
                              {entry.kind === 'resposta' && 'Resposta recebida'}
                              {entry.kind === 'followup' && 'Follow-up registrado'}
                              {entry.kind === 'webhook' && entry.item.evento.replace(/\s*--\s*etapa\s*\d+/gi, '')}
                            </div>
                            <div className="text-xs text-gray-400">
                              {new Date(entry.date).toLocaleDateString('pt-BR')}
                              {entry.kind === 'abordagem' && (
                                <span className="ml-1.5">
                                  {entry.item.origem_acao === 'automatico' ? '· IA' : '· Manual'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : loadingInteracoes ? (
                  <div className="flex items-center gap-2 text-gray-400 py-2">
                    <Loader2 size={13} className="animate-spin" />
                    <span className="text-xs">Carregando interações...</span>
                  </div>
                ) : interacoes.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhuma interação registrada ainda.</p>
                ) : (
                  <div className="space-y-2.5">
                    {interacoes.map(interacao => {
                      const cfg = INTERACAO_TIPO[interacao.tipo] ?? INTERACAO_TIPO.nota;
                      const isIA = interacao.origem_acao === 'ia';
                      const Icon = isIA ? Bot : cfg.Icon;
                      return (
                        <div key={interacao.id} className="flex items-start gap-2.5">
                          <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon size={10} className={isIA ? 'text-blue-500' : cfg.color} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-700">
                              {interacao.descricao || cfg.label}
                              {interacao.canal && (
                                <span className="text-gray-400"> · {interacao.canal}</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400">
                              {new Date(interacao.created_at).toLocaleDateString('pt-BR')}
                              <span className="ml-1.5">{isIA ? '· IA' : '· Manual'}</span>
                              {interacao.usuarios?.nome && (
                                <span className="ml-1.5">· {interacao.usuarios.nome}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Informações */}
              <div className="px-5 py-4">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-3">Informações da empresa</span>
                <div className="space-y-1.5 text-sm">
                  {selectedEmpresa.website && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Site</span>
                      <a href={selectedEmpresa.website} target="_blank" rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline text-xs truncate max-w-44">{selectedEmpresa.website}</a>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Segmento</span>
                    <span className="font-medium text-gray-700">{selectedEmpresa.segmento}</span>
                  </div>
                  {selectedEmpresa.funcionarios_faixa && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Funcionários</span>
                      <span className="font-medium text-gray-700">{selectedEmpresa.funcionarios_faixa}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cidade</span>
                    <span className="font-medium text-gray-700">{selectedEmpresa.cidade}, {selectedEmpresa.estado}</span>
                  </div>
                  {selectedEmpresa.faturamento_estimado && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Faturamento est.</span>
                      <span className="font-medium text-gray-700 text-xs">{selectedEmpresa.faturamento_estimado}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Origem do lead</span>
                    <span className="font-medium text-gray-700">{selectedEmpresa.origem}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-2.5 bg-gray-50">
              <select className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-600 focus:outline-none">
                <option value="">Mover para outro estágio</option>
                {STAGES.filter(s => s.id !== selectedEmpresa.estagio_pipeline).map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <button className="text-sm font-medium text-red-600 border border-red-200 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors whitespace-nowrap">
                Marcar como perdido
              </button>
            </div>
          </div>

          {/* Central do Lead — modal completo */}
          {showAllInteracoes && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
              onClick={() => setShowAllInteracoes(false)}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                {/* HEADER */}
                <div className="px-6 py-5 border-b border-gray-100">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold text-gray-900 leading-tight">{selectedEmpresa.nome}</h2>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {selectedEmpresa.cidade}, {selectedEmpresa.estado} · {selectedEmpresa.segmento}
                      </div>
                      {selectedContato && (
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 mt-1">
                          <span className="font-semibold text-gray-800">{selectedContato.nome}</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-gray-500">{selectedContato.cargo}</span>
                          <span className="text-gray-300">·</span>
                          {(() => {
                            const ci = selectedLead ? CANAL_INFO[selectedLead.canal_preferencial] : null;
                            const Icon = ci?.Icon ?? Mail;
                            return (
                              <span className="inline-flex items-center gap-1 text-gray-600">
                                <Icon size={13} /> {selectedContato.canal_preferencial}
                              </span>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setShowAllInteracoes(false)}
                      className="text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  {/* Row de badges informativos */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <div className="flex flex-col bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Responsável</span>
                      <span className="text-sm font-medium text-gray-700">{selectedEmpresa.responsavel || '—'}</span>
                    </div>
                    <div className="flex flex-col bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Status</span>
                      <span className="text-sm font-medium text-gray-700">{getEstagioPipelineLabel(selectedEmpresa.estagio_pipeline as EstagioPipeline)}</span>
                    </div>
                    <div className="flex flex-col bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Último contato</span>
                      <span className="text-sm font-medium text-gray-700">{selectedLead?.ultimo_contato ? formatDate(selectedLead.ultimo_contato) : '—'}</span>
                    </div>
                    <div className="flex flex-col bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100 max-w-xs">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Próxima ação</span>
                      <span className="text-sm font-medium text-gray-700 truncate">{selectedLead?.proxima_acao || '—'}</span>
                    </div>
                    <div className="flex flex-col bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Canal preferencial</span>
                      <span className="text-sm font-medium text-gray-700 capitalize">{selectedLead?.canal_preferencial ?? selectedContato?.canal_preferencial ?? '—'}</span>
                    </div>
                    <div className="flex flex-col bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-100">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Score</span>
                      <span className="text-sm font-bold" style={{ color: scoreColor(selectedLead?.score ?? selectedEmpresa.score_engajamento) }}>
                        {selectedLead?.score ?? selectedEmpresa.score_engajamento} <span className="text-gray-400 font-normal">/ 100</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* TABS */}
                <div className="px-6 border-b border-gray-100 flex gap-1">
                  {([
                    { id: 'timeline', label: 'Linha do tempo' },
                    { id: 'dados', label: 'Dados do lead' },
                  ] as const).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setCentralTab(tab.id)}
                      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                        centralTab === tab.id
                          ? 'border-indigo-500 text-indigo-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* CONTEÚDO */}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  {centralTab === 'timeline' ? (
                    <div>
                      {/* Botão registrar */}
                      <div className="mb-4">
                        <button
                          onClick={() => setShowRegistrar(v => !v)}
                          className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Plus size={14} /> Registrar interação
                        </button>

                        {showRegistrar && (
                          <div className="mt-3 p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-medium text-gray-500 block mb-1">Tipo</label>
                                <select
                                  value={novaInteracao.tipo}
                                  onChange={e => setNovaInteracao(s => ({ ...s, tipo: e.target.value }))}
                                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                                >
                                  <option value="abordagem">Abordagem</option>
                                  <option value="follow_up">Follow-up</option>
                                  <option value="resposta">Resposta</option>
                                  <option value="nota">Nota</option>
                                  <option value="reuniao">Reunião</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-xs font-medium text-gray-500 block mb-1">Canal</label>
                                <select
                                  value={novaInteracao.canal}
                                  onChange={e => setNovaInteracao(s => ({ ...s, canal: e.target.value }))}
                                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                                >
                                  <option value="email">Email</option>
                                  <option value="whatsapp">WhatsApp</option>
                                  <option value="linkedin">LinkedIn</option>
                                  <option value="telefone">Telefone</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-500 block mb-1">Descrição</label>
                              <textarea
                                value={novaInteracao.descricao}
                                onChange={e => setNovaInteracao(s => ({ ...s, descricao: e.target.value }))}
                                rows={3}
                                placeholder="Descreva a interação..."
                                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 resize-none"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => { setShowRegistrar(false); setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' }); }}
                                className="text-sm font-medium text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleRegistrarInteracao}
                                disabled={salvandoInteracao || !novaInteracao.descricao.trim()}
                                className="flex items-center gap-1.5 text-sm font-semibold text-white px-4 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                                style={{ backgroundColor: '#6366f1' }}
                              >
                                {salvandoInteracao && <Loader2 size={13} className="animate-spin" />}
                                Salvar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Lista da timeline */}
                      {loadingInteracoes ? (
                        <div className="flex items-center gap-2 text-gray-400 py-6">
                          <Loader2 size={16} className="animate-spin" />
                          <span className="text-sm">Carregando interações...</span>
                        </div>
                      ) : interacoes.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4">Nenhuma interação registrada ainda.</p>
                      ) : (
                        <div className="space-y-3">
                          {interacoes.map(interacao => {
                            const tipoBadge = getTipoInteracaoBadge(interacao.tipo);
                            const statusBadge = getStatusInteracao(interacao.tipo);
                            const canal = interacao.canal ? CANAL_INFO[interacao.canal.toLowerCase()] : null;
                            const isIA = interacao.origem_acao === 'ia';
                            return (
                              <div key={interacao.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                      <Clock size={11} /> {formatDateTime(interacao.created_at)}
                                    </span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tipoBadge.classes}`}>
                                      {tipoBadge.label}
                                    </span>
                                    {canal && (
                                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${canal.classes}`}>
                                        <canal.Icon size={11} /> {canal.label}
                                      </span>
                                    )}
                                    {isIA && (
                                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">IA</span>
                                    )}
                                  </div>
                                  {statusBadge && (
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${statusBadge.classes}`}>
                                      {statusBadge.label}
                                    </span>
                                  )}
                                </div>
                                {interacao.descricao && (
                                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{interacao.descricao}</p>
                                )}
                                {interacao.usuarios?.nome && (
                                  <p className="text-xs text-gray-400 mt-1.5">por {interacao.usuarios.nome}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ABA DADOS DO LEAD */
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                      {[
                        { label: 'Empresa', value: selectedLead?.empresa ?? selectedEmpresa.nome },
                        { label: 'Cidade', value: selectedLead?.cidade ?? selectedEmpresa.cidade },
                        { label: 'Estado', value: selectedLead?.estado ?? selectedEmpresa.estado },
                        { label: 'Segmento', value: selectedLead?.segmento ?? selectedEmpresa.segmento },
                        { label: 'Site', value: selectedLead?.site, isLink: true },
                        { label: 'LinkedIn', value: selectedLead?.linkedin, isLink: true },
                        { label: 'Contato Nome', value: selectedLead?.contato_nome ?? selectedContato?.nome },
                        { label: 'Contato Cargo', value: selectedLead?.contato_cargo ?? selectedContato?.cargo },
                        { label: 'Contato Email', value: selectedLead?.contato_email ?? selectedContato?.email },
                        { label: 'Contato Telefone', value: selectedLead?.contato_telefone ?? selectedContato?.telefone },
                        { label: 'Canal Preferencial', value: selectedLead?.canal_preferencial, capitalize: true },
                        { label: 'Origem', value: selectedLead?.origem ?? selectedEmpresa.origem },
                        { label: 'Score', value: selectedLead ? `${selectedLead.score} / 100` : `${selectedEmpresa.score_engajamento} / 100` },
                        { label: 'Criado em', value: selectedLead?.created_at ? formatDate(selectedLead.created_at) : formatDate(selectedEmpresa.data_entrada) },
                      ].map(field => (
                        <div key={field.label} className="border-b border-gray-100 pb-2">
                          <span className="text-xs text-gray-400 uppercase tracking-wide block mb-0.5">{field.label}</span>
                          {field.value ? (
                            field.isLink ? (
                              <a
                                href={field.value.startsWith('http') ? field.value : `https://${field.value}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-indigo-600 hover:underline break-all"
                              >
                                {field.value}
                              </a>
                            ) : (
                              <span className={`text-sm font-medium text-gray-700 ${field.capitalize ? 'capitalize' : ''}`}>{field.value}</span>
                            )
                          ) : (
                            <span className="text-sm text-gray-300">—</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
