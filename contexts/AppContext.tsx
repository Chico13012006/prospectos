'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import type {
  Empresa, Contato, Cadencia, Template, Abordagem, Resposta, FollowUp, BlacklistEntry, WebhookLog, TimelineEntry,
} from '@/lib/types';
import {
  empresas as mockEmpresas,
  contatos as mockContatos,
  cadencias as mockCadencias,
  templates as mockTemplates,
  abordagens as mockAbordagens,
  respostas as mockRespostas,
  followUps as mockFollowUps,
  blacklist as mockBlacklist,
  webhookLogs as mockWebhooks,
} from '@/lib/mock-data';

interface AppState {
  empresas: Empresa[];
  contatos: Contato[];
  cadencias: Cadencia[];
  templates: Template[];
  abordagens: Abordagem[];
  respostas: Resposta[];
  followUps: FollowUp[];
  blacklist: BlacklistEntry[];
  webhookLogs: WebhookLog[];
}

interface AppActions {
  updateEmpresa: (id: string, data: Partial<Empresa>) => void;
  addAbordagem: (a: Abordagem) => void;
  addResposta: (r: Resposta) => void;
  addFollowUp: (f: FollowUp) => void;
  updateFollowUp: (id: string, data: Partial<FollowUp>) => void;
  addToBlacklist: (entry: BlacklistEntry) => void;
  addWebhookLog: (log: WebhookLog) => void;
  getTimelineForEmpresa: (empresaId: string) => TimelineEntry[];
  getContatosByEmpresa: (empresaId: string) => Contato[];
  getFollowUpsByEmpresa: (empresaId: string) => FollowUp[];
  getCadenciaById: (id: string) => Cadencia | undefined;
  getTemplateById: (id: string) => Template | undefined;
  getEmpresaById: (id: string) => Empresa | undefined;
}

type AppContextType = AppState & AppActions;

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [empresas, setEmpresas] = useState<Empresa[]>(mockEmpresas);
  const [contatos] = useState<Contato[]>(mockContatos);
  const [cadencias] = useState<Cadencia[]>(mockCadencias);
  const [templates] = useState<Template[]>(mockTemplates);
  const [abordagens, setAbordagens] = useState<Abordagem[]>(mockAbordagens);
  const [respostas, setRespostas] = useState<Resposta[]>(mockRespostas);
  const [followUps, setFollowUps] = useState<FollowUp[]>(mockFollowUps);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>(mockBlacklist);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>(mockWebhooks);

  const updateEmpresa = useCallback((id: string, data: Partial<Empresa>) => {
    setEmpresas(prev => prev.map(e => e.id === id ? { ...e, ...data } : e));
  }, []);

  const addAbordagem = useCallback((a: Abordagem) => {
    setAbordagens(prev => [...prev, a]);
  }, []);

  const addResposta = useCallback((r: Resposta) => {
    setRespostas(prev => [...prev, r]);
  }, []);

  const addFollowUp = useCallback((f: FollowUp) => {
    setFollowUps(prev => [...prev, f]);
  }, []);

  const updateFollowUp = useCallback((id: string, data: Partial<FollowUp>) => {
    setFollowUps(prev => prev.map(f => f.id === id ? { ...f, ...data } : f));
  }, []);

  const addToBlacklist = useCallback((entry: BlacklistEntry) => {
    setBlacklist(prev => [...prev, entry]);
  }, []);

  const addWebhookLog = useCallback((log: WebhookLog) => {
    setWebhookLogs(prev => [log, ...prev]);
  }, []);

  const getContatosByEmpresa = useCallback((empresaId: string) => {
    return contatos.filter(c => c.empresa_id === empresaId);
  }, [contatos]);

  const getFollowUpsByEmpresa = useCallback((empresaId: string) => {
    return followUps.filter(f => f.empresa_id === empresaId);
  }, [followUps]);

  const getCadenciaById = useCallback((id: string) => {
    return cadencias.find(c => c.id === id);
  }, [cadencias]);

  const getTemplateById = useCallback((id: string) => {
    return templates.find(t => t.id === id);
  }, [templates]);

  const getEmpresaById = useCallback((id: string) => {
    return empresas.find(e => e.id === id);
  }, [empresas]);

  const getTimelineForEmpresa = useCallback((empresaId: string): TimelineEntry[] => {
    const items: TimelineEntry[] = [];

    abordagens
      .filter(a => a.empresa_id === empresaId)
      .forEach(a => items.push({ kind: 'abordagem', item: a, date: a.data }));

    respostas
      .filter(r => r.empresa_id === empresaId)
      .forEach(r => items.push({ kind: 'resposta', item: r, date: r.data }));

    followUps
      .filter(f => f.empresa_id === empresaId && f.status === 'realizado')
      .forEach(f => items.push({ kind: 'followup', item: f, date: f.data_prevista + 'T12:00:00Z' }));

    webhookLogs
      .filter(w => w.empresa_id === empresaId)
      .forEach(w => items.push({ kind: 'webhook', item: w, date: w.timestamp }));

    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [abordagens, respostas, followUps, webhookLogs]);

  const value: AppContextType = {
    empresas, contatos, cadencias, templates, abordagens, respostas, followUps, blacklist, webhookLogs,
    updateEmpresa, addAbordagem, addResposta, addFollowUp, updateFollowUp, addToBlacklist, addWebhookLog,
    getTimelineForEmpresa, getContatosByEmpresa, getFollowUpsByEmpresa, getCadenciaById, getTemplateById, getEmpresaById,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
