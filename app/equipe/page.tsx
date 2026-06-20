'use client';

import { useState, useEffect } from 'react';
import { UserPlus, Users, Shield, Briefcase, BarChart2, Search, CheckCircle, Clock, Pencil, MoreVertical } from 'lucide-react';

interface Membro {
  id: string;
  email: string;
  nome: string | null;
  role: 'admin' | 'usuario';
  nicho: string | null;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  total_leads: number;
}

const NICHOS = [
  'Hotelaria',
  'Óticas',
  'Agronegócio',
  'Indústria',
  'Logística',
  'Saúde',
  'Varejo',
  'Tecnologia',
  'Construção Civil',
  'Educação',
  'Todos os nichos',
];

const NICHO_CORES: Record<string, string> = {
  'Hotelaria': 'bg-blue-100 text-blue-700',
  'Óticas': 'bg-purple-100 text-purple-700',
  'Agronegócio': 'bg-yellow-100 text-yellow-700',
  'Indústria': 'bg-green-100 text-green-700',
  'Logística': 'bg-pink-100 text-pink-700',
  'Saúde': 'bg-red-100 text-red-700',
  'Varejo': 'bg-orange-100 text-orange-700',
  'Tecnologia': 'bg-cyan-100 text-cyan-700',
  'Construção Civil': 'bg-amber-100 text-amber-700',
  'Educação': 'bg-indigo-100 text-indigo-700',
  'Todos os nichos': 'bg-indigo-100 text-indigo-700',
};

const BARRA_CORES: Record<string, string> = {
  'Hotelaria': 'bg-blue-500',
  'Óticas': 'bg-purple-500',
  'Agronegócio': 'bg-yellow-500',
  'Indústria': 'bg-green-500',
  'Logística': 'bg-pink-500',
  'Saúde': 'bg-red-500',
  'Varejo': 'bg-orange-500',
  'Tecnologia': 'bg-cyan-500',
  'Construção Civil': 'bg-amber-500',
  'Educação': 'bg-indigo-500',
  'Todos os nichos': 'bg-indigo-500',
};

function iniciais(nome: string | null, email: string) {
  if (nome) return nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function formatarAcesso(data: string | null) {
  if (!data) return '—';
  const d = new Date(data);
  const agora = new Date();
  const diff = Math.floor((agora.getTime() - d.getTime()) / 1000);
  if (diff < 120) return 'Agora há pouco';
  if (diff < 3600) return `Há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hoje às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (diff < 172800) return `Ontem às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('pt-BR');
}

export default function EquipePage() {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [buscando, setBuscando] = useState(true);
  const [filtroNicho, setFiltroNicho] = useState('Todos os nichos');
  const [busca, setBusca] = useState('');
  const [mostrarConvite, setMostrarConvite] = useState(false);

  // Form
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [role, setRole] = useState<'admin' | 'usuario'>('usuario');
  const [nicho, setNicho] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; msg: string } | null>(null);

  async function carregarMembros() {
    setBuscando(true);
    try {
      const res = await fetch('/api/equipe/listar');
      const data = await res.json();
      setMembros(data.membros || []);
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => { carregarMembros(); }, []);

  async function handleConvidar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/equipe/convidar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nome, role, nicho }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ tipo: 'erro', msg: data.erro || 'Erro ao enviar convite' });
      } else {
        setFeedback({ tipo: 'sucesso', msg: `Convite enviado para ${email}` });
        setEmail(''); setNome(''); setNicho(''); setRole('usuario');
        setMostrarConvite(false);
        await carregarMembros();
      }
    } catch {
      setFeedback({ tipo: 'erro', msg: 'Erro ao enviar convite' });
    } finally {
      setCarregando(false);
    }
  }

  const admins = membros.filter(m => m.role === 'admin');
  const usuarios = membros.filter(m => m.role === 'usuario');
  const nichosAtivos = [...new Set(membros.map(m => m.nicho).filter(Boolean))].length;
  const totalLeads = membros.reduce((acc, m) => acc + m.total_leads, 0);
  const maxLeads = Math.max(...membros.map(m => m.total_leads), 1);

  const membrosFiltrados = membros.filter(m => {
    const matchNicho = filtroNicho === 'Todos os nichos' || m.nicho === filtroNicho;
    const matchBusca = !busca || (m.nome?.toLowerCase().includes(busca.toLowerCase()) || m.email.toLowerCase().includes(busca.toLowerCase()));
    return matchNicho && matchBusca;
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-50 rounded-lg flex items-center justify-center">
            <Users size={18} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Equipe</h1>
            <p className="text-gray-500 text-xs">Gerencie sua equipe, nichos e permissões de acesso.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar membro"
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
            />
          </div>
          <button
            onClick={() => setMostrarConvite(!mostrarConvite)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UserPlus size={16} />
            Convidar membro
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Administradores', value: admins.length, sub: 'Acesso total à plataforma', icon: <Shield size={20} className="text-indigo-500" />, bg: 'bg-indigo-50' },
          { label: 'Usuários', value: usuarios.length, sub: 'Acesso ao nicho definido', icon: <Users size={20} className="text-green-500" />, bg: 'bg-green-50' },
          { label: 'Nichos ativos', value: nichosAtivos, sub: 'Segmentos de atuação', icon: <Briefcase size={20} className="text-orange-500" />, bg: 'bg-orange-50' },
          { label: 'Leads distribuídos', value: totalLeads.toLocaleString('pt-BR'), sub: 'Entre toda a equipe', icon: <BarChart2 size={20} className="text-purple-500" />, bg: 'bg-purple-50' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center flex-shrink-0`}>
              {s.icon}
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs font-medium text-gray-700">{s.label}</p>
              <p className="text-xs text-gray-400">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Formulário de convite (colapsável) */}
      {mostrarConvite && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <UserPlus size={17} />
            Convidar novo membro
          </h2>
          <p className="text-xs text-gray-500 mb-4">Convide pessoas para sua equipe e defina o nicho que cada uma irá cuidar.</p>
          <form onSubmit={handleConvidar}>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="email@empresa.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome (opcional)</label>
                <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de acesso</label>
                <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'usuario')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  <option value="usuario">Usuário — Acesso limitado ao nicho</option>
                  <option value="admin">Administrador — Acesso total</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nicho / Segmento</label>
                <select value={nicho} onChange={e => setNicho(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  <option value="">Selecione o nicho</option>
                  {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg">
                👑 <strong>Administradores</strong> têm acesso total à plataforma e podem gerenciar leads de todos os nichos.
              </p>
              <button type="submit" disabled={carregando}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
                <UserPlus size={15} />
                {carregando ? 'Enviando...' : 'Enviar convite'}
              </button>
            </div>
            {feedback && (
              <p className={`text-sm mt-2 ${feedback.tipo === 'sucesso' ? 'text-green-600' : 'text-red-500'}`}>
                {feedback.tipo === 'sucesso' ? '✓' : '✗'} {feedback.msg}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Tabela de membros */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Membros da equipe</h2>
            <p className="text-xs text-gray-500">Visualize e gerencie todos os membros da sua equipe.</p>
          </div>
          <select value={filtroNicho} onChange={e => setFiltroNicho(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option>Todos os nichos</option>
            {NICHOS.filter(n => n !== 'Todos os nichos').map(n => <option key={n}>{n}</option>)}
          </select>
        </div>

        {buscando ? (
          <div className="p-10 text-center text-gray-400 text-sm">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Pessoa</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Função na plataforma</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Nicho / Segmento</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Leads atribuídos</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Último acesso</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {membrosFiltrados.map(m => {
                const barraLargura = maxLeads > 0 ? Math.round((m.total_leads / maxLeads) * 100) : 0;
                const corBarra = BARRA_CORES[m.nicho || ''] || 'bg-indigo-500';
                const corNicho = NICHO_CORES[m.nicho || ''] || 'bg-gray-100 text-gray-600';
                return (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    {/* Pessoa */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-xs flex-shrink-0">
                          {iniciais(m.nome, m.email)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{m.nome || '—'}</p>
                          <p className="text-xs text-gray-500">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    {/* Função */}
                    <td className="px-5 py-3">
                      {m.role === 'admin' ? (
                        <div>
                          <div className="flex items-center gap-1.5 text-indigo-700 font-medium text-xs">
                            <Shield size={13} />
                            Administrador
                          </div>
                          <p className="text-xs text-gray-400">Acesso total</p>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1.5 text-gray-600 font-medium text-xs">
                            <Users size={13} />
                            Usuário
                          </div>
                          <p className="text-xs text-gray-400">Acesso ao nicho</p>
                        </div>
                      )}
                    </td>
                    {/* Nicho */}
                    <td className="px-5 py-3">
                      {m.nicho ? (
                        <div>
                          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${corNicho}`}>
                            {m.nicho}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">não definido</span>
                      )}
                    </td>
                    {/* Leads */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800 w-10 text-right">{m.total_leads}</span>
                        <span className="text-xs text-gray-400">leads</span>
                      </div>
                      <div className="mt-1 w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${corBarra}`} style={{ width: `${barraLargura}%` }} />
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-5 py-3">
                      {m.confirmed_at ? (
                        <span className="flex items-center gap-1.5 text-xs text-green-700">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                          Ativo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-yellow-600">
                          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                          Pendente
                        </span>
                      )}
                    </td>
                    {/* Último acesso */}
                    <td className="px-5 py-3 text-xs text-gray-500">
                      <p>{formatarAcesso(m.last_sign_in_at)}</p>
                      {m.last_sign_in_at && (
                        <p className="text-gray-400">{new Date(m.last_sign_in_at).toLocaleDateString('pt-BR')}</p>
                      )}
                    </td>
                    {/* Ações */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
                          <Pencil size={14} />
                        </button>
                        <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
                          <MoreVertical size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!buscando && membrosFiltrados.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhum membro encontrado.</div>
        )}

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">Clique em um membro para editar informações, alterar nicho ou permissões de acesso.</p>
        </div>
      </div>
    </div>
  );
}
