import type {
  Empresa,
  Contato,
  Cadencia,
  Template,
  Abordagem,
  Resposta,
  FollowUp,
  BlacklistEntry,
  WebhookLog,
} from './types';

// ─── CADÊNCIAS ───────────────────────────────────────────────
export const cadencias: Cadencia[] = [
  {
    id: 'cad-001',
    nome: 'RFID Logística D0-D14',
    descricao: 'Cadência para empresas do segmento Logística — 4 touchpoints em 14 dias',
    ativa: true,
    etapas: [
      { numero: 1, dia_offset: 0, canal: 'LinkedIn', template_id: 'tpl-001', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 2, dia_offset: 3, canal: 'LinkedIn', template_id: 'tpl-002', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 3, dia_offset: 7, canal: 'Email', template_id: 'tpl-003', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 4, dia_offset: 14, canal: 'LinkedIn', template_id: 'tpl-004', acao: 'enviar_mensagem', executado_por: 'humano' },
    ],
  },
  {
    id: 'cad-002',
    nome: 'RFID Petróleo/Mineração D0-D21',
    descricao: 'Cadência para Petróleo e Mineração — 5 touchpoints em 21 dias com ligação no D14',
    ativa: true,
    etapas: [
      { numero: 1, dia_offset: 0, canal: 'LinkedIn', template_id: 'tpl-005', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 2, dia_offset: 4, canal: 'Email', template_id: 'tpl-006', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 3, dia_offset: 9, canal: 'LinkedIn', template_id: 'tpl-007', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 4, dia_offset: 14, canal: 'Telefone', template_id: 'tpl-008', acao: 'ligar', executado_por: 'humano' },
      { numero: 5, dia_offset: 21, canal: 'Email', template_id: 'tpl-009', acao: 'enviar_mensagem', executado_por: 'automatico' },
    ],
  },
  {
    id: 'cad-003',
    nome: 'RFID Agro D0-D10',
    descricao: 'Cadência curta para o segmento Agro — 3 touchpoints em 10 dias',
    ativa: true,
    etapas: [
      { numero: 1, dia_offset: 0, canal: 'WhatsApp', template_id: 'tpl-010', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 2, dia_offset: 3, canal: 'LinkedIn', template_id: 'tpl-001', acao: 'enviar_mensagem', executado_por: 'automatico' },
      { numero: 3, dia_offset: 10, canal: 'Email', template_id: 'tpl-003', acao: 'enviar_mensagem', executado_por: 'humano' },
    ],
  },
];

// ─── TEMPLATES ────────────────────────────────────────────────
export const templates: Template[] = [
  {
    id: 'tpl-001',
    nome: 'Abordagem Inicial LinkedIn — Logística',
    canal: 'LinkedIn',
    corpo: `Olá {{nome}}, tudo bem?

Acompanho a {{empresa}} e vi que vocês atuam com operações logísticas relevantes no Brasil.

Na InovaCode, ajudamos empresas de logística a reduzir erros de inventário e aumentar a eficiência no rastreamento de ativos com tecnologia RFID. Já implementamos em operações similares à de vocês.

Faz sentido trocarmos uma ideia de 15 minutos?`,
    tags: ['first touch', 'linkedin', 'logística'],
    taxa_resposta: 18,
    total_usos: 47,
  },
  {
    id: 'tpl-002',
    nome: 'Follow-up D3 LinkedIn — Logística',
    canal: 'LinkedIn',
    corpo: `Olá {{nome}}, passei por aqui novamente!

Sei que a rotina de quem lidera logística é intensa, por isso fui direto ao ponto: nossa solução RFID elimina até 94% dos erros de conferência manual em docas de distribuição.

Posso compartilhar um case de 5 minutos de leitura que se encaixa bem com o que a {{empresa}} faz?`,
    tags: ['follow-up', 'linkedin', 'logística'],
    taxa_resposta: 12,
    total_usos: 38,
  },
  {
    id: 'tpl-003',
    nome: 'E-mail Técnico RFID — Logística',
    canal: 'Email',
    assunto: 'Como a {{empresa}} pode eliminar erros manuais no inventário com RFID',
    corpo: `Olá {{nome}},

Meu nome é [seu nome], sou da InovaCode — especialistas em RFID para operações industriais e logísticas.

Entrei em contato porque a {{empresa}} opera em um segmento onde o rastreamento de ativos por RFID gera ROI direto em:
• Redução de 90%+ em erros de inventário
• Agilidade na conferência de cargas (de horas para minutos)
• Visibilidade em tempo real do fluxo de materiais

Posso enviar um estudo de caso de 5 páginas com resultados reais de uma empresa similar à {{empresa}}?

Fico à disposição.`,
    tags: ['email', 'técnico', 'first touch', 'logística'],
    taxa_resposta: 22,
    total_usos: 31,
  },
  {
    id: 'tpl-004',
    nome: 'Último Contato LinkedIn — Cadência Final',
    canal: 'LinkedIn',
    corpo: `Olá {{nome}}, essa é minha última mensagem sobre este assunto por ora.

Caso a {{empresa}} venha a avaliar soluções de rastreamento e inventário por RFID nos próximos meses, ficaria feliz em retomar a conversa.

Se não for o momento, tudo bem também! Boa sorte nas operações.`,
    tags: ['last touch', 'linkedin', 'reativação'],
    taxa_resposta: 9,
    total_usos: 22,
  },
  {
    id: 'tpl-005',
    nome: 'Abordagem Inicial LinkedIn — Petróleo/Mineração',
    canal: 'LinkedIn',
    corpo: `Olá {{nome}}, tudo bem?

Acompanho o setor de {{segmento}} e percebi que a {{empresa}} opera com ativos críticos onde a rastreabilidade é essencial.

Na InovaCode, implementamos RFID em plantas industriais do setor de petróleo e mineração — aumentando o controle de ferramentas, EPIs e equipamentos de campo em ambientes hostis.

Vale uma conversa rápida de 15 minutos?`,
    tags: ['first touch', 'linkedin', 'petróleo', 'mineração'],
    taxa_resposta: 15,
    total_usos: 29,
  },
  {
    id: 'tpl-006',
    nome: 'E-mail Case RFID — Petróleo',
    canal: 'Email',
    assunto: 'Rastreamento de ativos críticos com RFID — caso real em {{segmento}}',
    corpo: `Olá {{nome}},

Seguindo nossa conversa no LinkedIn, segue um resumo de como aplicamos RFID na gestão de ativos críticos em operações de {{segmento}}:

✅ Rastreamento de ferramentas e EPIs em campo
✅ Controle de inventário em armazéns industriais
✅ Integração com sistemas SAP/ERP existentes
✅ Funcionamento em ambientes com interferência eletromagnética

Anexo um estudo de caso de 8 páginas com resultados reais.

Posso agendar 20 minutos para apresentar?`,
    tags: ['email', 'case', 'follow-up', 'petróleo'],
    taxa_resposta: 28,
    total_usos: 18,
  },
  {
    id: 'tpl-007',
    nome: 'Follow-up D9 LinkedIn — Petróleo/Mineração',
    canal: 'LinkedIn',
    corpo: `Olá {{nome}}, tentei contato por aqui e também por e-mail.

Sei que decisões de tecnologia para {{segmento}} têm ciclo mais longo — por isso estou sendo persistente mas respeitoso.

Se não for o momento certo, pode me dizer? Assim evito incomodar e posso retornar quando fizer mais sentido.`,
    tags: ['follow-up', 'linkedin', 'mineração', 'petróleo'],
    taxa_resposta: 19,
    total_usos: 24,
  },
  {
    id: 'tpl-008',
    nome: 'Script Ligação — Primeiro Contato',
    canal: 'Telefone',
    corpo: `Oi {{nome}}, aqui é [seu nome] da InovaCode.

Tentei contato por LinkedIn e e-mail sobre RFID para operações de {{segmento}}. Você recebeu alguma mensagem?

[Se sim] Ótimo! Posso tirar 10 minutos para explicar o contexto?
[Se não] Tudo bem, posso fazer um brevíssimo resumo agora ou preferir por e-mail?`,
    tags: ['telefone', 'script', 'first touch'],
    taxa_resposta: 35,
    total_usos: 14,
  },
  {
    id: 'tpl-009',
    nome: 'E-mail Final — Cadência Petróleo/Mineração',
    canal: 'Email',
    assunto: 'Encerrando contato — InovaCode RFID',
    corpo: `Olá {{nome}},

Esse é meu último contato nessa rodada.

Caso a {{empresa}} avalie soluções de rastreamento de ativos por RFID no futuro, nossa equipe estará disponível.

Fique à vontade para me acionar quando fizer sentido.

Sucesso nas operações!`,
    tags: ['last touch', 'email', 'mineração', 'petróleo'],
    taxa_resposta: 8,
    total_usos: 11,
  },
  {
    id: 'tpl-010',
    nome: 'WhatsApp Abordagem Inicial — Agro',
    canal: 'WhatsApp',
    corpo: `Olá {{nome}}! 👋

Sou da InovaCode, especialistas em RFID para agronegócio.

Vi que a {{empresa}} atua com {{segmento}} e queria entender se vocês têm desafios com rastreamento de insumos, equipamentos ou animais no campo.

Podemos conversar 10 minutos essa semana?`,
    tags: ['whatsapp', 'first touch', 'agro'],
    taxa_resposta: 31,
    total_usos: 16,
  },
];

// ─── EMPRESAS (LEADS) ─────────────────────────────────────────
export const empresas: Empresa[] = [
  {
    id: 'emp-001',
    nome: 'LogTech Brasil',
    segmento: 'Logística',
    origem: 'LinkedIn',
    cidade: 'São Paulo',
    estado: 'SP',
    website: 'https://logtech.com.br',
    responsavel: 'Francisco',
    status: 'em_prospeccao',
    estagio_pipeline: 'follow_up',
    em_cadencia: true,
    cadencia_id: 'cad-001',
    etapa_atual_cadencia: 3,
    data_entrada: '2026-06-01',
    ultimo_contato: '2026-06-04',
    ultimo_contato_origem: 'automatico',
    blacklist: false,
    score_engajamento: 45,
    observacoes: 'Empresa com operação de cross-docking. Decisor é o Diretor de Operações.',
    funcionarios_faixa: '100-250',
    faturamento_estimado: 'R$ 40-60M/ano',
  },
  {
    id: 'emp-002',
    nome: 'Petro Sul S.A.',
    segmento: 'Petróleo',
    origem: 'Pesquisa própria',
    cidade: 'Macaé',
    estado: 'RJ',
    website: 'https://petrosul.com.br',
    responsavel: 'Silmara',
    status: 'aguardando_resposta',
    estagio_pipeline: 'aguardando_resposta',
    em_cadencia: true,
    cadencia_id: 'cad-002',
    etapa_atual_cadencia: 4,
    data_entrada: '2026-05-20',
    ultimo_contato: '2026-06-03',
    ultimo_contato_origem: 'automatico',
    blacklist: false,
    score_engajamento: 40,
    observacoes: 'Planta em Macaé com 200+ colaboradores. Potencial para rastreamento de EPIs.',
    funcionarios_faixa: '200-500',
    faturamento_estimado: 'R$ 150-300M/ano',
  },
  {
    id: 'emp-003',
    nome: 'MineStar Mineração',
    segmento: 'Mineração',
    origem: 'Indicação',
    cidade: 'Belo Horizonte',
    estado: 'MG',
    website: 'https://minestar.com.br',
    responsavel: 'Francisco',
    status: 'respondeu_positivo',
    estagio_pipeline: 'reuniao_agendada',
    em_cadencia: false,
    data_entrada: '2026-05-15',
    ultimo_contato: '2026-05-28',
    ultimo_contato_origem: 'humano',
    blacklist: false,
    score_engajamento: 90,
    observacoes: 'Adriana pediu proposta de projeto piloto. URGENTE — aguarda retorno de Francisco.',
    funcionarios_faixa: '500-1.000',
    faturamento_estimado: 'R$ 300-500M/ano',
  },
  {
    id: 'emp-004',
    nome: 'AgroFast Soluções',
    segmento: 'Agro',
    origem: 'Automação',
    cidade: 'Ribeirão Preto',
    estado: 'SP',
    responsavel: 'Francisco',
    status: 'novo',
    estagio_pipeline: 'novos_leads',
    em_cadencia: false,
    data_entrada: '2026-06-14',
    blacklist: false,
    score_engajamento: 20,
    observacoes: 'Lead gerado via automação de prospecção LinkedIn.',
    funcionarios_faixa: '10-50',
    faturamento_estimado: 'R$ 5-15M/ano',
  },
  {
    id: 'emp-005',
    nome: 'Metalúrgica Alfa',
    segmento: 'Indústria',
    origem: 'Cold list',
    cidade: 'Santo André',
    estado: 'SP',
    responsavel: 'Silmara',
    status: 'em_prospeccao',
    estagio_pipeline: 'primeiro_contato',
    em_cadencia: true,
    cadencia_id: 'cad-001',
    etapa_atual_cadencia: 2,
    data_entrada: '2026-06-10',
    ultimo_contato: '2026-06-10',
    ultimo_contato_origem: 'automatico',
    blacklist: false,
    score_engajamento: 30,
    funcionarios_faixa: '50-100',
    faturamento_estimado: 'R$ 20-40M/ano',
  },
  {
    id: 'emp-006',
    nome: 'SuperVarejo Distribuidora',
    segmento: 'Varejo',
    origem: 'LinkedIn',
    cidade: 'Curitiba',
    estado: 'PR',
    responsavel: 'Silmara',
    status: 'sem_interesse_agora',
    estagio_pipeline: 'follow_up',
    em_cadencia: false,
    data_entrada: '2026-05-05',
    ultimo_contato: '2026-05-10',
    ultimo_contato_origem: 'humano',
    blacklist: false,
    score_engajamento: 15,
    observacoes: 'Gerente disse que orçamento está congelado até Q4. Reativar em outubro.',
    funcionarios_faixa: '100-250',
    faturamento_estimado: 'R$ 50-80M/ano',
  },
  {
    id: 'emp-007',
    nome: 'TransOil Logística',
    segmento: 'Petróleo',
    origem: 'Evento',
    cidade: 'Vitória',
    estado: 'ES',
    website: 'https://transoil.com.br',
    responsavel: 'Francisco',
    status: 'pediu_mais_info',
    estagio_pipeline: 'interessado',
    em_cadencia: true,
    cadencia_id: 'cad-002',
    etapa_atual_cadencia: 3,
    data_entrada: '2026-06-05',
    ultimo_contato: '2026-06-09',
    ultimo_contato_origem: 'automatico',
    blacklist: false,
    score_engajamento: 55,
    observacoes: 'Contato feito no evento ADIPEC Brasil. Pediu cases de empresas entre 50 e 200 colaboradores.',
    funcionarios_faixa: '50-200',
    faturamento_estimado: 'R$ 30-60M/ano',
  },
  {
    id: 'emp-008',
    nome: 'GranjaDigital Agro',
    segmento: 'Agro',
    origem: 'LinkedIn',
    cidade: 'Uberlândia',
    estado: 'MG',
    responsavel: 'Francisco',
    status: 'pediu_mais_info',
    estagio_pipeline: 'interessado',
    em_cadencia: false,
    data_entrada: '2026-06-01',
    ultimo_contato: '2026-06-05',
    ultimo_contato_origem: 'humano',
    blacklist: false,
    score_engajamento: 75,
    observacoes: 'Luciana pediu case de rastreamento de rebanho bovino. Aguarda material técnico.',
    funcionarios_faixa: '50-100',
    faturamento_estimado: 'R$ 15-30M/ano',
  },
  {
    id: 'emp-009',
    nome: 'Ferrous Mining Brasil',
    segmento: 'Mineração',
    origem: 'Pesquisa própria',
    cidade: 'Parauapebas',
    estado: 'PA',
    responsavel: 'Silmara',
    status: 'aguardando_resposta',
    estagio_pipeline: 'aguardando_resposta',
    em_cadencia: true,
    cadencia_id: 'cad-002',
    etapa_atual_cadencia: 4,
    data_entrada: '2026-05-28',
    ultimo_contato: '2026-06-07',
    ultimo_contato_origem: 'automatico',
    blacklist: false,
    score_engajamento: 35,
    observacoes: 'Grande operação de minério de ferro no Pará. Ciclo de compra longo.',
    funcionarios_faixa: '1.000+',
    faturamento_estimado: 'R$ 500M+/ano',
  },
  {
    id: 'emp-010',
    nome: 'FlexLog Transportes',
    segmento: 'Logística',
    origem: 'Cold list',
    cidade: 'Campinas',
    estado: 'SP',
    responsavel: 'Silmara',
    status: 'reativar_futuramente',
    estagio_pipeline: 'follow_up',
    em_cadencia: false,
    data_entrada: '2026-04-15',
    ultimo_contato: '2026-05-01',
    ultimo_contato_origem: 'automatico',
    blacklist: false,
    score_engajamento: 20,
    observacoes: 'Cadência finalizada sem resposta. Reativar em agosto 2026.',
    funcionarios_faixa: '50-100',
    faturamento_estimado: 'R$ 15-25M/ano',
  },
  {
    id: 'emp-011',
    nome: 'RetailMax Nacional',
    segmento: 'Varejo',
    origem: 'LinkedIn',
    cidade: 'Porto Alegre',
    estado: 'RS',
    responsavel: 'Francisco',
    status: 'blacklist',
    estagio_pipeline: 'follow_up',
    em_cadencia: false,
    data_entrada: '2026-05-01',
    ultimo_contato: '2026-05-03',
    ultimo_contato_origem: 'humano',
    blacklist: true,
    motivo_blacklist: 'Contato pediu explicitamente para não ser mais contatado (opt-out LGPD)',
    score_engajamento: 0,
    funcionarios_faixa: '250-500',
    faturamento_estimado: 'R$ 80-150M/ano',
  },
  {
    id: 'emp-012',
    nome: 'IndustrialPro Equipamentos',
    segmento: 'Indústria',
    origem: 'Cold list',
    cidade: 'São Bernardo do Campo',
    estado: 'SP',
    responsavel: 'Silmara',
    status: 'descartado',
    estagio_pipeline: 'follow_up',
    em_cadencia: false,
    data_entrada: '2026-05-10',
    ultimo_contato: '2026-05-15',
    ultimo_contato_origem: 'humano',
    blacklist: false,
    score_engajamento: 5,
    observacoes: 'Empresa utiliza solução RFID de concorrente com contrato vigente por 3 anos.',
    funcionarios_faixa: '100-250',
    faturamento_estimado: 'R$ 40-70M/ano',
  },
];

// ─── CONTATOS ─────────────────────────────────────────────────
export const contatos: Contato[] = [
  { id: 'con-001', empresa_id: 'emp-001', nome: 'Carlos Mendes', cargo: 'Diretor de Operações', canal_preferencial: 'LinkedIn', linkedin_url: 'linkedin.com/in/carlosmendes', email: 'carlos.mendes@logtech.com.br', telefone: '(11) 99001-0001', principal: true, blacklist: false },
  { id: 'con-002', empresa_id: 'emp-001', nome: 'Fernanda Lima', cargo: 'Coordenadora de TI', canal_preferencial: 'Email', email: 'fernanda.lima@logtech.com.br', principal: false, blacklist: false },
  { id: 'con-003', empresa_id: 'emp-002', nome: 'Roberto Alves', cargo: 'Gerente de Operações', canal_preferencial: 'LinkedIn', linkedin_url: 'linkedin.com/in/robertoalves', email: 'roberto@petrosul.com.br', telefone: '(22) 99002-0002', principal: true, blacklist: false },
  { id: 'con-004', empresa_id: 'emp-003', nome: 'Adriana Santos', cargo: 'Diretora de Operações', canal_preferencial: 'LinkedIn', linkedin_url: 'linkedin.com/in/adrianasantos', email: 'adriana@minestar.com.br', telefone: '(31) 99003-0003', principal: true, blacklist: false },
  { id: 'con-005', empresa_id: 'emp-004', nome: 'Paulo Ferreira', cargo: 'CEO / Fundador', canal_preferencial: 'WhatsApp', email: 'paulo@agrofast.com.br', telefone: '(16) 99004-0004', principal: true, blacklist: false },
  { id: 'con-006', empresa_id: 'emp-005', nome: 'Marcos Oliveira', cargo: 'Gerente Industrial', canal_preferencial: 'Email', email: 'marcos@alfa.com.br', telefone: '(11) 99005-0005', principal: true, blacklist: false },
  { id: 'con-007', empresa_id: 'emp-006', nome: 'Beatriz Ramos', cargo: 'Gerente de TI', canal_preferencial: 'LinkedIn', linkedin_url: 'linkedin.com/in/beatrizramos', email: 'beatriz@supervarejo.com.br', principal: true, blacklist: false },
  { id: 'con-008', empresa_id: 'emp-007', nome: 'Antônio Costa', cargo: 'Gerente de Manutenção', canal_preferencial: 'Email', email: 'antonio@transoil.com.br', telefone: '(27) 99007-0007', principal: true, blacklist: false },
  { id: 'con-009', empresa_id: 'emp-008', nome: 'Luciana Pereira', cargo: 'Coordenadora Agrícola', canal_preferencial: 'WhatsApp', telefone: '(34) 99008-0008', email: 'luciana@granjadigital.com.br', principal: true, blacklist: false },
  { id: 'con-010', empresa_id: 'emp-009', nome: 'Daniel Almeida', cargo: 'Superintendente de Operações', canal_preferencial: 'LinkedIn', linkedin_url: 'linkedin.com/in/danielalmeida', email: 'daniel@ferrous.com.br', principal: true, blacklist: false },
  { id: 'con-011', empresa_id: 'emp-010', nome: 'Fernanda Torres', cargo: 'Diretora de Logística', canal_preferencial: 'Email', email: 'ftorres@flexlog.com.br', principal: true, blacklist: false },
  { id: 'con-012', empresa_id: 'emp-011', nome: 'Ricardo Gomes', cargo: 'Gerente de TI', canal_preferencial: 'LinkedIn', email: 'ricardo@retailmax.com.br', principal: true, blacklist: true },
  { id: 'con-013', empresa_id: 'emp-012', nome: 'Simone Batista', cargo: 'Gerente Industrial', canal_preferencial: 'Email', email: 'simone@industrialpro.com.br', principal: true, blacklist: false },
];

// ─── ABORDAGENS ───────────────────────────────────────────────
export const abordagens: Abordagem[] = [
  // LogTech Brasil (emp-001)
  {
    id: 'abr-001', empresa_id: 'emp-001', contato_id: 'con-001', data: '2026-06-01T09:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-001',
    mensagem_enviada: 'Olá Carlos, tudo bem?\n\nAcompanho a LogTech Brasil e vi que vocês atuam com operações logísticas relevantes no Brasil.\n\nNa InovaCode, ajudamos empresas de logística a reduzir erros de inventário e aumentar a eficiência no rastreamento de ativos com tecnologia RFID. Já implementamos em operações similares à de vocês.\n\nFaz sentido trocarmos uma ideia de 15 minutos?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-logistica-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-001', resultado: 'enviado',
  },
  {
    id: 'abr-002', empresa_id: 'emp-001', contato_id: 'con-001', data: '2026-06-04T09:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-002',
    mensagem_enviada: 'Olá Carlos, passei por aqui novamente!\n\nSei que a rotina de quem lidera logística é intensa, por isso fui direto ao ponto: nossa solução RFID elimina até 94% dos erros de conferência manual em docas de distribuição.\n\nPosso compartilhar um case de 5 minutos de leitura que se encaixa bem com o que a LogTech Brasil faz?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-logistica-d3',
    etapa_cadencia: 2, cadencia_id: 'cad-001', resultado: 'enviado',
  },

  // Petro Sul (emp-002)
  {
    id: 'abr-003', empresa_id: 'emp-002', contato_id: 'con-003', data: '2026-05-20T10:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-005',
    mensagem_enviada: 'Olá Roberto, tudo bem?\n\nAcompanho o setor de Petróleo e percebi que a Petro Sul S.A. opera com ativos críticos onde a rastreabilidade é essencial.\n\nNa InovaCode, implementamos RFID em plantas industriais do setor de petróleo e mineração — aumentando o controle de ferramentas, EPIs e equipamentos de campo em ambientes hostis.\n\nVale uma conversa rápida de 15 minutos?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-petroleo-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-002', resultado: 'enviado',
  },
  {
    id: 'abr-004', empresa_id: 'emp-002', contato_id: 'con-003', data: '2026-05-24T10:00:00Z',
    canal: 'Email', template_id: 'tpl-006',
    mensagem_enviada: 'Olá Roberto,\n\nSeguindo nossa conversa no LinkedIn, segue um resumo de como aplicamos RFID na gestão de ativos críticos em operações de Petróleo...',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-petroleo-d4',
    etapa_cadencia: 2, cadencia_id: 'cad-002', resultado: 'enviado',
  },
  {
    id: 'abr-005', empresa_id: 'emp-002', contato_id: 'con-003', data: '2026-06-03T10:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-007',
    mensagem_enviada: 'Olá Roberto, tentei contato por aqui e também por e-mail.\n\nSei que decisões de tecnologia para Petróleo têm ciclo mais longo — por isso estou sendo persistente mas respeitoso.\n\nSe não for o momento certo, pode me dizer?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-petroleo-d9',
    etapa_cadencia: 3, cadencia_id: 'cad-002', resultado: 'enviado',
  },

  // MineStar (emp-003)
  {
    id: 'abr-006', empresa_id: 'emp-003', contato_id: 'con-004', data: '2026-05-15T09:30:00Z',
    canal: 'LinkedIn', template_id: 'tpl-005',
    mensagem_enviada: 'Olá Adriana, tudo bem?\n\nAcompanho o setor de Mineração e percebi que a MineStar Mineração opera com ativos críticos onde a rastreabilidade é essencial.\n\nNa InovaCode, implementamos RFID em plantas de mineração — aumentando o controle de equipamentos de campo em ambientes hostis.\n\nVale uma conversa rápida?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-mineracao-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-002', resultado: 'enviado',
  },
  {
    id: 'abr-007', empresa_id: 'emp-003', contato_id: 'con-004', data: '2026-05-19T10:00:00Z',
    canal: 'Email', template_id: 'tpl-006',
    mensagem_enviada: 'Olá Adriana,\n\nSegue o material técnico que mencionei sobre RFID para mineração. Case incluído com resultados de redução de 87% em perdas de ferramentas.',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-mineracao-d4',
    etapa_cadencia: 2, cadencia_id: 'cad-002', resultado: 'enviado',
  },
  {
    id: 'abr-008', empresa_id: 'emp-003', contato_id: 'con-004', data: '2026-05-28T14:30:00Z',
    canal: 'Telefone', template_id: 'tpl-008',
    mensagem_enviada: '[Ligação] Francisco entrou em contato com Adriana Santos para discutir projeto piloto após resposta positiva via LinkedIn.',
    responsavel: 'Francisco', origem_acao: 'humano',
    etapa_cadencia: 4, cadencia_id: 'cad-002', resultado: 'enviado',
  },

  // Metalúrgica Alfa (emp-005)
  {
    id: 'abr-009', empresa_id: 'emp-005', contato_id: 'con-006', data: '2026-06-10T09:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-001',
    mensagem_enviada: 'Olá Marcos, tudo bem?\n\nAcompanho a Metalúrgica Alfa e vi que vocês atuam com operações industriais relevantes no Brasil.\n\nNa InovaCode, ajudamos empresas de indústria a reduzir erros de inventário com RFID.\n\nFaz sentido trocarmos uma ideia de 15 minutos?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-industria-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-001', resultado: 'enviado',
  },

  // SuperVarejo (emp-006)
  {
    id: 'abr-010', empresa_id: 'emp-006', contato_id: 'con-007', data: '2026-05-05T09:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-001',
    mensagem_enviada: 'Olá Beatriz, tudo bem?\n\nAcompanho a SuperVarejo Distribuidora e vi que vocês atuam com operações relevantes no varejo.\n\nNa InovaCode, ajudamos distribuidoras a reduzir erros de inventário com RFID.\n\nFaz sentido trocarmos uma ideia?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-varejo-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-001', resultado: 'enviado',
  },
  {
    id: 'abr-011', empresa_id: 'emp-006', contato_id: 'con-007', data: '2026-05-08T09:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-002',
    mensagem_enviada: 'Olá Beatriz, passei por aqui novamente! Nossa solução RFID elimina até 94% dos erros de conferência manual.',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-varejo-d3',
    etapa_cadencia: 2, cadencia_id: 'cad-001', resultado: 'enviado',
  },
  {
    id: 'abr-012', empresa_id: 'emp-006', contato_id: 'con-007', data: '2026-05-10T11:00:00Z',
    canal: 'LinkedIn',
    mensagem_enviada: '[Mensagem humana] Silmara respondeu ao opt-out de Beatriz e esclareceu o contexto. Confirmou remoção da lista de contatos.',
    responsavel: 'Silmara', origem_acao: 'humano',
    resultado: 'enviado',
  },

  // TransOil (emp-007)
  {
    id: 'abr-013', empresa_id: 'emp-007', contato_id: 'con-008', data: '2026-06-05T10:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-005',
    mensagem_enviada: 'Olá Antônio, tudo bem?\n\nAcompanho o setor de Petróleo e percebi que a TransOil Logística opera com ativos críticos.\n\nNa InovaCode, implementamos RFID em plantas industriais do setor.\n\nVale uma conversa rápida?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-petroleo-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-002', resultado: 'enviado',
  },
  {
    id: 'abr-014', empresa_id: 'emp-007', contato_id: 'con-008', data: '2026-06-09T10:00:00Z',
    canal: 'Email', template_id: 'tpl-006',
    mensagem_enviada: 'Olá Antônio,\n\nSeguindo o contato no LinkedIn, segue material técnico sobre RFID para operações de Petróleo.',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-petroleo-d4',
    etapa_cadencia: 2, cadencia_id: 'cad-002', resultado: 'enviado',
  },

  // GranjaDigital (emp-008)
  {
    id: 'abr-015', empresa_id: 'emp-008', contato_id: 'con-009', data: '2026-06-01T08:00:00Z',
    canal: 'WhatsApp', template_id: 'tpl-010',
    mensagem_enviada: 'Olá Luciana! 👋\n\nSou da InovaCode, especialistas em RFID para agronegócio.\n\nVi que a GranjaDigital Agro atua com Agro e queria entender se vocês têm desafios com rastreamento de insumos, equipamentos ou animais no campo.\n\nPodemos conversar 10 minutos essa semana?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-agro-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-003', resultado: 'enviado',
  },
  {
    id: 'abr-016', empresa_id: 'emp-008', contato_id: 'con-009', data: '2026-06-04T09:00:00Z',
    canal: 'WhatsApp',
    mensagem_enviada: 'Oi Luciana! Francisco aqui da InovaCode. Vi sua resposta no WhatsApp e fiquei feliz que tenha interesse! Podemos marcar uma call rápida para entender melhor como podemos ajudar no rastreamento do rebanho?',
    responsavel: 'Francisco', origem_acao: 'humano',
    etapa_cadencia: 2, cadencia_id: 'cad-003', resultado: 'enviado',
  },

  // Ferrous Mining (emp-009)
  {
    id: 'abr-017', empresa_id: 'emp-009', contato_id: 'con-010', data: '2026-05-28T10:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-005',
    mensagem_enviada: 'Olá Daniel, tudo bem?\n\nAcompanho o setor de Mineração e percebi que a Ferrous Mining Brasil opera com ativos críticos.\n\nNa InovaCode, implementamos RFID em operações de mineração de grande porte.\n\nVale uma conversa?',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-mineracao-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-002', resultado: 'enviado',
  },
  {
    id: 'abr-018', empresa_id: 'emp-009', contato_id: 'con-010', data: '2026-06-01T10:00:00Z',
    canal: 'Email', template_id: 'tpl-006',
    mensagem_enviada: 'Olá Daniel,\n\nSeguindo o contato no LinkedIn, segue material sobre RFID para grandes operações de mineração.',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-mineracao-d4',
    etapa_cadencia: 2, cadencia_id: 'cad-002', resultado: 'enviado',
  },
  {
    id: 'abr-019', empresa_id: 'emp-009', contato_id: 'con-010', data: '2026-06-07T10:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-007',
    mensagem_enviada: 'Olá Daniel, tentei contato por aqui e também por e-mail. Sei que decisões de tecnologia para Mineração têm ciclo mais longo.',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-mineracao-d9',
    etapa_cadencia: 3, cadencia_id: 'cad-002', resultado: 'enviado',
  },

  // RetailMax (emp-011)
  {
    id: 'abr-020', empresa_id: 'emp-011', contato_id: 'con-012', data: '2026-05-01T09:00:00Z',
    canal: 'LinkedIn', template_id: 'tpl-001',
    mensagem_enviada: 'Olá Ricardo, tudo bem?\n\nNa InovaCode, ajudamos redes de varejo com rastreamento RFID...',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-varejo-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-001', resultado: 'enviado',
  },

  // IndustrialPro (emp-012)
  {
    id: 'abr-021', empresa_id: 'emp-012', contato_id: 'con-013', data: '2026-05-10T09:00:00Z',
    canal: 'Email', template_id: 'tpl-003',
    mensagem_enviada: 'Olá Simone,\n\nMeu nome é Mariana, sou da InovaCode. Gostaria de apresentar nossa solução RFID para operações industriais...',
    responsavel: 'n8n / Automação', origem_acao: 'automatico', fluxo_n8n: 'flow-industria-d0',
    etapa_cadencia: 1, cadencia_id: 'cad-001', resultado: 'enviado',
  },
];

// ─── RESPOSTAS ────────────────────────────────────────────────
export const respostas: Resposta[] = [
  {
    id: 'res-001', empresa_id: 'emp-003', abordagem_id: 'abr-007',
    data: '2026-05-22T16:45:00Z',
    tipo: 'interesse_positivo',
    conteudo: 'Oi Francisco! Achei bem interessante a abordagem de vocês. Temos uma planta nova em Itabira e estamos justamente avaliando sistemas de rastreamento de EPIs e ferramentas. Podemos marcar uma reunião para vocês apresentarem melhor? Tenho disponibilidade na semana que vem.',
    detectado_por: 'humano',
  },
  {
    id: 'res-002', empresa_id: 'emp-008', abordagem_id: 'abr-015',
    data: '2026-06-02T10:30:00Z',
    tipo: 'pediu_mais_info',
    conteudo: 'Oi! Sim, tenho interesse. Vocês têm algum case de rastreamento de rebanho bovino ou suíno? Temos uma operação com 12.000 cabeças e o controle manual está sendo um problema sério.',
    detectado_por: 'humano',
  },
  {
    id: 'res-003', empresa_id: 'emp-006', abordagem_id: 'abr-011',
    data: '2026-05-09T14:00:00Z',
    tipo: 'sem_interesse_agora',
    conteudo: 'Oi, obrigada pela mensagem. No momento nosso orçamento para TI está completamente congelado até Q4. Se puder, retorne em outubro que podemos avaliar melhor.',
    detectado_por: 'humano',
  },
  {
    id: 'res-004', empresa_id: 'emp-011', abordagem_id: 'abr-020',
    data: '2026-05-02T09:15:00Z',
    tipo: 'opt_out',
    conteudo: 'Por favor, não me contacte mais. Não temos interesse em soluções RFID e solicito remoção do nosso contato da sua lista.',
    detectado_por: 'humano',
  },
  {
    id: 'res-005', empresa_id: 'emp-012', abordagem_id: 'abr-021',
    data: '2026-05-14T11:00:00Z',
    tipo: 'negativa_definitiva',
    conteudo: 'Olá Mariana. Agradecemos o contato, mas já temos contrato vigente com outro fornecedor de RFID por mais 3 anos. Não há possibilidade de avaliação no momento.',
    detectado_por: 'humano',
  },
  {
    id: 'res-006', empresa_id: 'emp-007', abordagem_id: 'abr-014',
    data: '2026-06-13T11:20:00Z',
    tipo: 'pediu_mais_info',
    conteudo: 'Olá! Recebi o material. Faz sentido, temos um desafio sério com rastreamento de EPIs na planta de Vitória. Você tem cases de operações de médio porte? Algo entre 50 e 200 colaboradores?',
    detectado_por: 'humano',
  },
  {
    id: 'res-007', empresa_id: 'emp-009', abordagem_id: 'abr-019',
    data: '2026-06-11T09:00:00Z',
    tipo: 'pedir_recontato',
    conteudo: 'Daniel Almeida: Oi, recebemos sua mensagem. Agora não é um bom momento — estamos no meio de uma parada programada. Me contata novamente em meados de julho.',
    detectado_por: 'humano',
  },
];

// ─── FOLLOW-UPS ───────────────────────────────────────────────
export const followUps: FollowUp[] = [
  // ATRASADOS
  {
    id: 'fup-001', empresa_id: 'emp-003',
    data_prevista: '2026-05-23',
    tipo_acao: 'ligar', canal_previsto: 'Telefone',
    responsavel: 'Francisco',
    observacao: 'URGENTE: Adriana respondeu com interesse positivo. Ligar para agendar apresentação.',
    status: 'atrasado', origem: 'manual',
  },
  {
    id: 'fup-002', empresa_id: 'emp-003',
    data_prevista: '2026-06-01',
    tipo_acao: 'ligar', canal_previsto: 'Telefone',
    responsavel: 'Francisco',
    observacao: 'Segunda tentativa de agendamento — Adriana ainda aguarda retorno.',
    status: 'atrasado', origem: 'manual',
  },
  {
    id: 'fup-003', empresa_id: 'emp-001',
    data_prevista: '2026-06-08',
    tipo_acao: 'enviar_mensagem', canal_previsto: 'Email',
    responsavel: 'Francisco',
    observacao: 'Etapa 3 da cadência RFID Logística (D7)',
    status: 'atrasado', origem: 'cadencia_automatica', cadencia_id: 'cad-001', etapa_cadencia: 3,
  },
  {
    id: 'fup-004', empresa_id: 'emp-008',
    data_prevista: '2026-06-08',
    tipo_acao: 'enviar_material', canal_previsto: 'WhatsApp',
    responsavel: 'Francisco',
    observacao: 'Luciana pediu case de rastreamento bovino. Aguarda material técnico.',
    status: 'atrasado', origem: 'manual',
  },
  {
    id: 'fup-005', empresa_id: 'emp-005',
    data_prevista: '2026-06-13',
    tipo_acao: 'enviar_mensagem', canal_previsto: 'LinkedIn',
    responsavel: 'Silmara',
    observacao: 'Etapa 2 da cadência RFID Logística (D3)',
    status: 'atrasado', origem: 'cadencia_automatica', cadencia_id: 'cad-001', etapa_cadencia: 2,
  },
  {
    id: 'fup-006', empresa_id: 'emp-007',
    data_prevista: '2026-06-14',
    tipo_acao: 'enviar_mensagem', canal_previsto: 'LinkedIn',
    responsavel: 'Francisco',
    observacao: 'Etapa 3 da cadência Petróleo/Mineração (D9)',
    status: 'atrasado', origem: 'cadencia_automatica', cadencia_id: 'cad-002', etapa_cadencia: 3,
  },
  {
    id: 'fup-007', empresa_id: 'emp-009',
    data_prevista: '2026-06-11',
    tipo_acao: 'ligar', canal_previsto: 'Telefone',
    responsavel: 'Silmara',
    observacao: 'Etapa 4 da cadência Petróleo/Mineração — ligação manual',
    status: 'atrasado', origem: 'cadencia_automatica', cadencia_id: 'cad-002', etapa_cadencia: 4,
  },
  // PENDENTES
  {
    id: 'fup-008', empresa_id: 'emp-001',
    data_prevista: '2026-06-22',
    tipo_acao: 'enviar_mensagem', canal_previsto: 'LinkedIn',
    responsavel: 'Francisco',
    observacao: 'Etapa 4 da cadência RFID Logística — último contato humano',
    status: 'pendente', origem: 'cadencia_automatica', cadencia_id: 'cad-001', etapa_cadencia: 4,
  },
  {
    id: 'fup-009', empresa_id: 'emp-002',
    data_prevista: '2026-06-17',
    tipo_acao: 'ligar', canal_previsto: 'Telefone',
    responsavel: 'Silmara',
    observacao: 'Etapa 4 da cadência Petróleo — ligação manual com Roberto',
    status: 'pendente', origem: 'cadencia_automatica', cadencia_id: 'cad-002', etapa_cadencia: 4,
  },
  {
    id: 'fup-010', empresa_id: 'emp-004',
    data_prevista: '2026-06-15',
    tipo_acao: 'enviar_mensagem', canal_previsto: 'WhatsApp',
    responsavel: 'Francisco',
    observacao: 'Etapa 1 da cadência Agro (D0) — lead novo, iniciar cadência',
    status: 'pendente', origem: 'cadencia_automatica', cadencia_id: 'cad-003', etapa_cadencia: 1,
  },
  {
    id: 'fup-011', empresa_id: 'emp-010',
    data_prevista: '2026-08-15',
    tipo_acao: 'reativar', canal_previsto: 'LinkedIn',
    responsavel: 'Silmara',
    observacao: 'Reativar prospecção após 90 dias — cadência foi concluída sem resposta',
    status: 'pendente', origem: 'manual',
  },
  // REALIZADOS
  {
    id: 'fup-012', empresa_id: 'emp-006',
    data_prevista: '2026-05-12',
    tipo_acao: 'enviar_mensagem', canal_previsto: 'LinkedIn',
    responsavel: 'Silmara',
    observacao: 'Registrado retorno à Beatriz após opt-out — encerramento respeitoso',
    status: 'realizado', origem: 'manual',
  },
];

// ─── BLACKLIST ────────────────────────────────────────────────
export const blacklist: BlacklistEntry[] = [
  {
    id: 'blk-001', tipo: 'empresa', referencia_id: 'emp-011',
    motivo: 'opt_out_lgpd', data: '2026-05-02', adicionado_por: 'Silmara',
  },
  {
    id: 'blk-002', tipo: 'contato', referencia_id: 'con-012',
    motivo: 'opt_out_lgpd', data: '2026-05-02', adicionado_por: 'Silmara',
  },
];

// ─── WEBHOOK LOGS ─────────────────────────────────────────────
export const webhookLogs: WebhookLog[] = [
  {
    id: 'wh-001', evento: 'lead.criado', empresa_id: 'emp-001',
    payload: { evento: 'lead.criado', lead_id: 'emp-001', empresa: 'LogTech Brasil', segmento: 'Logística', responsavel: 'Francisco', cadencia_id: 'cad-001', timestamp: '2026-06-01T09:00:00Z' },
    timestamp: '2026-06-01T09:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-002', evento: 'cadencia.proxima_etapa', empresa_id: 'emp-001',
    payload: { evento: 'cadencia.proxima_etapa', lead_id: 'emp-001', cadencia_id: 'cad-001', etapa: 1, canal: 'LinkedIn', template_id: 'tpl-001', contato_linkedin: 'linkedin.com/in/carlosmendes', variaveis: { nome: 'Carlos', empresa: 'LogTech Brasil', cargo: 'Diretor de Operações', segmento: 'Logística' } },
    timestamp: '2026-06-01T09:00:05Z', status: 'simulado',
  },
  {
    id: 'wh-003', evento: 'cadencia.proxima_etapa', empresa_id: 'emp-001',
    payload: { evento: 'cadencia.proxima_etapa', lead_id: 'emp-001', cadencia_id: 'cad-001', etapa: 2, canal: 'LinkedIn', template_id: 'tpl-002', contato_linkedin: 'linkedin.com/in/carlosmendes', variaveis: { nome: 'Carlos', empresa: 'LogTech Brasil', cargo: 'Diretor de Operações', segmento: 'Logística' } },
    timestamp: '2026-06-04T09:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-004', evento: 'lead.criado', empresa_id: 'emp-002',
    payload: { evento: 'lead.criado', lead_id: 'emp-002', empresa: 'Petro Sul S.A.', segmento: 'Petróleo', responsavel: 'Silmara', cadencia_id: 'cad-002', timestamp: '2026-05-20T10:00:00Z' },
    timestamp: '2026-05-20T10:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-005', evento: 'resposta.detectada', empresa_id: 'emp-003',
    payload: { evento: 'resposta.detectada', lead_id: 'emp-003', tipo_resposta: 'interesse_positivo', parar_cadencia: true, notificar_responsavel: true, timestamp: '2026-05-22T16:45:00Z' },
    timestamp: '2026-05-22T16:45:00Z', status: 'simulado',
  },
  {
    id: 'wh-006', evento: 'resposta.positiva', empresa_id: 'emp-003',
    payload: { evento: 'resposta.positiva', lead_id: 'emp-003', acao: 'criar_followup_urgente', notificar: 'Francisco', prioridade: 'alta', timestamp: '2026-05-22T16:45:10Z' },
    timestamp: '2026-05-22T16:45:10Z', status: 'simulado',
  },
  {
    id: 'wh-007', evento: 'resposta.opt_out', empresa_id: 'emp-011',
    payload: { evento: 'resposta.opt_out', lead_id: 'emp-011', acao: 'adicionar_blacklist', parar_automacao: true, timestamp: '2026-05-02T09:15:00Z' },
    timestamp: '2026-05-02T09:15:00Z', status: 'simulado',
  },
  {
    id: 'wh-008', evento: 'followup.atrasado', empresa_id: 'emp-003',
    payload: { evento: 'followup.atrasado', lead_id: 'emp-003', followup_id: 'fup-001', dias_atraso: 23, responsavel: 'Francisco', acao: 'alertar_responsavel', timestamp: '2026-06-15T08:00:00Z' },
    timestamp: '2026-06-15T08:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-009', evento: 'cadencia.proxima_etapa', empresa_id: 'emp-003',
    payload: { evento: 'cadencia.proxima_etapa', lead_id: 'emp-003', cadencia_id: 'cad-002', etapa: 2, canal: 'Email', template_id: 'tpl-006', contato_email: 'adriana@minestar.com.br', variaveis: { nome: 'Adriana', empresa: 'MineStar Mineração', cargo: 'Diretora de Operações', segmento: 'Mineração' } },
    timestamp: '2026-05-19T10:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-010', evento: 'lead.criado', empresa_id: 'emp-004',
    payload: { evento: 'lead.criado', lead_id: 'emp-004', empresa: 'AgroFast Soluções', segmento: 'Agro', responsavel: 'Francisco', cadencia_id: 'cad-003', timestamp: '2026-06-14T08:00:00Z' },
    timestamp: '2026-06-14T08:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-011', evento: 'resposta.detectada', empresa_id: 'emp-008',
    payload: { evento: 'resposta.detectada', lead_id: 'emp-008', tipo_resposta: 'pediu_mais_info', parar_cadencia: true, notificar_responsavel: true, timestamp: '2026-06-02T10:30:00Z' },
    timestamp: '2026-06-02T10:30:00Z', status: 'simulado',
  },
  {
    id: 'wh-012', evento: 'cadencia.finalizada', empresa_id: 'emp-010',
    payload: { evento: 'cadencia.finalizada', lead_id: 'emp-010', cadencia_id: 'cad-001', status_novo: 'reativar_futuramente', data_recontato: '2026-08-15', timestamp: '2026-05-01T09:00:00Z' },
    timestamp: '2026-05-01T09:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-013', evento: 'followup.atrasado', empresa_id: 'emp-009',
    payload: { evento: 'followup.atrasado', lead_id: 'emp-009', followup_id: 'fup-007', dias_atraso: 4, responsavel: 'Silmara', acao: 'alertar_responsavel', timestamp: '2026-06-15T08:00:00Z' },
    timestamp: '2026-06-15T08:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-014', evento: 'lead.inativo', empresa_id: 'emp-010',
    payload: { evento: 'lead.inativo', lead_id: 'emp-010', dias_sem_interacao: 45, cadencia_ativa: false, acao: 'alertar_responsavel', timestamp: '2026-06-15T08:00:00Z' },
    timestamp: '2026-06-15T08:00:00Z', status: 'simulado',
  },
  {
    id: 'wh-015', evento: 'cadencia.proxima_etapa', empresa_id: 'emp-007',
    payload: { evento: 'cadencia.proxima_etapa', lead_id: 'emp-007', cadencia_id: 'cad-002', etapa: 3, canal: 'LinkedIn', template_id: 'tpl-007', contato_linkedin: 'n/a', variaveis: { nome: 'Antônio', empresa: 'TransOil Logística', cargo: 'Gerente de Manutenção', segmento: 'Petróleo' } },
    timestamp: '2026-06-14T10:00:00Z', status: 'simulado',
  },
];
