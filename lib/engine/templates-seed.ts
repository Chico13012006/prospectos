// FONTE ÚNICA do conteúdo dos templates (master: templates-prospectos-master.md).
// Usada em dois lugares:
//   1) scripts/seed-templates.ts  -> popula a tabela `templates` do Supabase
//      (runtime real do motor + aba Templates).
//   2) MemoryStore                -> mesmos dados in-memory para os testes do
//      motor rodarem offline.
//
// Mapa conceitual -> coluna real da tabela:
//   segmento = `nicho`  (null = GENÉRICO / fallback)
//   estágio  = `tipo`
//
// Variáveis suportadas: {nome} {empresa} {segmento} {cidade} {responsavel_comercial}
//
// Convenção de `tipo`:
//   e-mail              -> 'primeiro_contato' | 'follow_up_1' | 'follow_up_2' | 'follow_up_3'
//   linkedin/whatsapp   -> 'primeiro_contato'                (por nicho, MANUAL/referência)
//   telefone (scripts)  -> 'abertura_geral' | 'gancho_reuniao' | 'pedir_material' | 'nao_e_a_pessoa'

export type CanalTemplate = 'email' | 'linkedin' | 'whatsapp' | 'telefone'

export interface SeedTemplate {
  canal: CanalTemplate
  nicho: string | null // null = genérico
  tipo: string
  nome: string
  assunto: string | null // só e-mail
  corpo: string
}

// Nichos canônicos (valor da coluna `nicho`).
export const NICHOS = ['oticas', 'hotelaria', 'varejo', 'hospital', 'industria', 'alimentos'] as const

export const SEED_TEMPLATES: SeedTemplate[] = [
  // ===================== E-MAIL — GENÉRICO (fallback / piloto) =====================
  {
    canal: 'email', nicho: null, tipo: 'primeiro_contato',
    nome: 'E-mail · Genérico · 1º contato',
    assunto: '{empresa} — perdas no estoque',
    corpo: `Olá {nome}, tudo bem?

Sou da iNovaCode. A gente usa RFID pra ajudar empresas como a {empresa} a reduzir perdas de estoque e eliminar os erros de contagem manual — com rastreio automático dos itens.

Faz sentido eu te explicar rapidamente como isso funcionaria aí?

Se tiver interesse, é só me responder.

Atenciosamente, {responsavel_comercial}`,
  },

  // ===================== E-MAIL POR NICHO — 1º contato =====================
  {
    canal: 'email', nicho: 'oticas', tipo: 'primeiro_contato',
    nome: 'E-mail · Óticas · 1º contato',
    assunto: 'Inventário e baixa automática na {empresa}',
    corpo: `Olá {nome}, tudo bem?
Normalmente, operações de óticas lidam com um desafio bem comum: estoque pequeno em tamanho físico, mas com alto valor agregado, muita movimentação e risco de divergência entre o físico e o sistema.
A iNovaCode ajuda empresas desse segmento com RFID para inventário cíclico, controle de estoque, baixa automática e apoio antifurto.
Em projetos com RFID, já vimos reduções de até 90% no tempo de inventário, além de mais visibilidade sobre perdas e movimentações.
Faz sentido conversarmos 15 minutos para entender como a {empresa} controla isso hoje?
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: 'hotelaria', tipo: 'primeiro_contato',
    nome: 'E-mail · Hotelaria · 1º contato',
    assunto: 'Controle de enxoval e lavanderia na {empresa}',
    corpo: `Olá {nome}, tudo bem?
Em hotelaria, um dos pontos que mais gera perda e retrabalho é o controle de enxoval, movimentações de lavanderia, estoque e itens que circulam entre áreas.
A iNovaCode aplica RFID para dar mais rastreabilidade a esses ativos, facilitando inventário cíclico, controle de estoque, movimentações e redução de perdas.
A ideia não é só "contar itens", mas dar visibilidade sobre onde eles estão, por onde passaram e onde podem estar ocorrendo desvios.
Podemos conversar 15 minutos para eu entender como a {empresa} faz esse controle hoje?
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: 'varejo', tipo: 'primeiro_contato',
    nome: 'E-mail · Varejo · 1º contato',
    assunto: 'Divergência de estoque na {empresa}',
    corpo: `Olá {nome}, tudo bem?
No varejo, pequenas divergências de estoque acabam virando perda de venda, retrabalho no inventário e baixa confiança nas informações do sistema.
A iNovaCode trabalha com RFID para controle de estoque, inventário cíclico e rastreabilidade de itens, ajudando a reduzir o tempo de conferência e aumentar a visibilidade da operação.
Já atuamos em projetos com alto volume de tags e operações onde o ganho principal foi sair de um controle manual para uma operação mais rápida e confiável.
Faz sentido uma conversa rápida de 15 minutos para avaliar se isso se aplica à realidade da {empresa}?
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: 'hospital', tipo: 'primeiro_contato',
    nome: 'E-mail · Hospital · 1º contato',
    assunto: 'Rastreabilidade de ativos na {empresa}',
    corpo: `Olá {nome}, tudo bem?
Hospitais costumam ter um desafio grande com ativos, equipamentos, enxoval, insumos e itens que circulam entre setores. Quando o controle depende muito de processo manual, aparecem perdas, divergências e baixa visibilidade.
A iNovaCode aplica RFID para rastreabilidade, inventário cíclico e controle de ativos, ajudando a localizar itens com mais agilidade e reduzir o esforço operacional das equipes.
A proposta é trazer mais controle sem aumentar a complexidade da rotina.
Podemos conversar 15 minutos para entender como a {empresa} controla esses ativos hoje?
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: 'industria', tipo: 'primeiro_contato',
    nome: 'E-mail · Indústria · 1º contato',
    assunto: 'Controle de ativos e materiais na {empresa}',
    corpo: `Olá {nome}, tudo bem?
Em operações industriais, é comum encontrar perdas de ativos, inventário manual demorado, erro de expedição, controle frágil de ferramentas/EPIs e divergência entre físico e sistema.
A iNovaCode atua com RFID para rastreabilidade de materiais, controle de ativos, inventário cíclico, ferramentas, EPIs e movimentações internas.
Temos experiência prática em campo e cases em grandes operações industriais, incluindo projetos com grande volume de tags e implantação em ambientes complexos.
Faz sentido conversarmos 15 minutos para entender onde a RFID poderia gerar mais impacto na {empresa}?
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: 'alimentos', tipo: 'primeiro_contato',
    nome: 'E-mail · Alimentos · 1º contato',
    assunto: 'Rastreabilidade e controle operacional na {empresa}',
    corpo: `Olá {nome}, tudo bem?
Empresas do setor de alimentos costumam ter uma necessidade forte de rastreabilidade, controle de estoque, expedição e visibilidade sobre materiais e ativos dentro da operação.
Quando o processo depende muito de conferência manual, surgem erros, retrabalho e dificuldade para confiar nos dados do sistema.
A iNovaCode aplica RFID para inventário cíclico, rastreabilidade e controle operacional, com implantação prática em campo e projetos em grandes empresas, incluindo atuação com a Nestlé em mais de 4 países.
Podemos conversar 15 minutos para entender se existe oportunidade de ganho na operação da {empresa}?
Atenciosamente, {responsavel_comercial}`,
  },

  // ===================== E-MAIL — FOLLOW-UPS (genéricos) =====================
  // Assunto é só ilustrativo na UI: o motor deriva "Re: " do 1º contato do lead
  // (ver lib/engine/mensagem.ts) para manter a mesma thread.
  {
    canal: 'email', nicho: null, tipo: 'follow_up_1',
    nome: 'E-mail · Follow-up 1',
    assunto: 'Re: [assunto do 1º contato]',
    corpo: `Olá {nome}, tudo bem?
Passando por aqui novamente.
Meu contato é porque a iNovaCode ajuda empresas a reduzir inventário manual, perdas, divergências e falta de rastreabilidade usando RFID.
Não sei se esse tema está no radar da {empresa} agora, mas pode existir oportunidade de ganho em tempo, controle e visibilidade operacional.
Faz sentido conversarmos 15 minutos esta semana?
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: null, tipo: 'follow_up_2',
    nome: 'E-mail · Follow-up 2',
    assunto: 'Re: [assunto do 1º contato]',
    corpo: `Olá {nome}, tudo bem?
Sei que a rotina costuma ser corrida, então vou ser direto.
Quando uma operação depende muito de conferência manual, é comum aparecer divergência entre físico e sistema, perda de ativos e baixa visibilidade sobre movimentações.
A iNovaCode atua justamente nesse ponto com RFID, inventário cíclico e rastreabilidade.
Você acha que faz sentido eu falar com você sobre isso, ou teria outra pessoa mais envolvida nesse tema na {empresa}?
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: null, tipo: 'follow_up_3',
    nome: 'E-mail · Follow-up 3',
    assunto: 'Re: [assunto do 1º contato]',
    corpo: `Olá {nome}, tudo bem?
Não quero ser insistente, então vou facilitar: se eu te mandar um exemplo rápido de como uma empresa parecida com a {empresa} reduziu perdas e tempo de inventário com RFID, isso ajuda a decidir se vale uma conversa?
É só responder "sim" que eu te envio.
Atenciosamente, {responsavel_comercial}`,
  },
  {
    canal: 'email', nicho: null, tipo: 'follow_up_4',
    nome: 'E-mail · Follow-up 4 (última tentativa)',
    assunto: 'Re: [assunto do 1º contato]',
    corpo: `Olá {nome}, tudo bem?
Essa será minha última mensagem sobre esse tema por enquanto.
Entrei em contato porque a iNovaCode ajuda empresas a reduzir inventário manual, perdas, divergências e falta de rastreabilidade com soluções RFID.
Caso a {empresa} avalie esse tipo de solução no futuro, fico à disposição para uma conversa rápida.
Atenciosamente, {responsavel_comercial}`,
  },

  // ===================== LINKEDIN — por nicho (MANUAL — referência) =====================
  {
    canal: 'linkedin', nicho: 'oticas', tipo: 'primeiro_contato',
    nome: 'LinkedIn · Óticas', assunto: null,
    corpo: `Olá {nome}, tudo bem?
Vi que a {empresa} atua no segmento de óticas. Muitas operações desse setor têm dificuldade com inventário, baixa automática, perdas e divergência entre loja, estoque e sistema.
A iNovaCode trabalha com RFID para dar mais velocidade e rastreabilidade nesse processo.
Faz sentido conversarmos 15 minutos?`,
  },
  {
    canal: 'linkedin', nicho: 'hotelaria', tipo: 'primeiro_contato',
    nome: 'LinkedIn · Hotelaria', assunto: null,
    corpo: `Olá {nome}, tudo bem?
Tenho acompanhado desafios de hotelaria ligados a enxoval, lavanderia, perdas e movimentações internas.
A iNovaCode aplica RFID para controlar esses itens com mais rastreabilidade e menos inventário manual.
Faz sentido uma conversa rápida de 15 minutos para entender como a {empresa} faz esse controle hoje?`,
  },
  {
    canal: 'linkedin', nicho: 'varejo', tipo: 'primeiro_contato',
    nome: 'LinkedIn · Varejo', assunto: null,
    corpo: `Olá {nome}, tudo bem?
No varejo, divergência de estoque costuma gerar ruptura, perda de venda e retrabalho no inventário.
A iNovaCode trabalha com RFID para controle de estoque e inventário cíclico com mais velocidade.
Faz sentido trocarmos uma ideia rápida sobre isso na {empresa}?`,
  },
  {
    canal: 'linkedin', nicho: 'hospital', tipo: 'primeiro_contato',
    nome: 'LinkedIn · Hospital', assunto: null,
    corpo: `Olá {nome}, tudo bem?
Em hospitais, o controle de ativos, enxoval, equipamentos e insumos pode virar um grande desafio quando depende muito de processo manual.
A iNovaCode aplica RFID para dar mais rastreabilidade e visibilidade a esses itens.
Faz sentido uma conversa rápida de 15 minutos?`,
  },
  {
    canal: 'linkedin', nicho: 'industria', tipo: 'primeiro_contato',
    nome: 'LinkedIn · Indústria', assunto: null,
    corpo: `Olá {nome}, tudo bem?
Operações industriais costumam ter desafios com rastreabilidade, inventário manual, ferramentas, EPIs, expedição e divergência entre físico e sistema.
A iNovaCode aplica RFID em campo para dar mais visibilidade e controle sobre esses processos.
Faz sentido conversarmos 15 minutos sobre a operação da {empresa}?`,
  },
  {
    canal: 'linkedin', nicho: 'alimentos', tipo: 'primeiro_contato',
    nome: 'LinkedIn · Alimentos', assunto: null,
    corpo: `Olá {nome}, tudo bem?
Empresas de alimentos normalmente precisam de controle forte sobre estoque, rastreabilidade, expedição e movimentações internas.
A iNovaCode trabalha com RFID para reduzir inventário manual e aumentar a visibilidade operacional.
Podemos conversar 15 minutos para entender se isso faz sentido para a {empresa}?`,
  },

  // ===================== WHATSAPP — por nicho (MANUAL — referência) =====================
  {
    canal: 'whatsapp', nicho: 'oticas', tipo: 'primeiro_contato',
    nome: 'WhatsApp · Óticas', assunto: null,
    corpo: `Olá {nome}, tudo bem? Aqui é {responsavel_comercial}, da iNovaCode.
Trabalhamos com RFID para óticas, ajudando em inventário cíclico, controle de estoque, baixa automática e apoio antifurto.
Normalmente conseguimos reduzir bastante o tempo de inventário e dar mais visibilidade sobre divergências.
Faz sentido uma conversa rápida de 15 minutos?`,
  },
  {
    canal: 'whatsapp', nicho: 'hotelaria', tipo: 'primeiro_contato',
    nome: 'WhatsApp · Hotelaria', assunto: null,
    corpo: `Olá {nome}, tudo bem? Aqui é {responsavel_comercial}, da iNovaCode.
Ajudamos hotéis a controlar enxoval, lavanderia, estoque e movimentações internas com RFID.
A ideia é reduzir perdas, inventário manual e falta de rastreabilidade.
Faz sentido conversarmos 15 minutos para entender como vocês controlam isso hoje?`,
  },
  {
    canal: 'whatsapp', nicho: 'varejo', tipo: 'primeiro_contato',
    nome: 'WhatsApp · Varejo', assunto: null,
    corpo: `Olá {nome}, tudo bem? Aqui é {responsavel_comercial}, da iNovaCode.
A iNovaCode trabalha com RFID para controle de estoque e inventário cíclico no varejo.
Normalmente o ganho está em reduzir divergência, acelerar conferência e aumentar a confiança no estoque.
Faz sentido uma conversa rápida de 15 minutos?`,
  },
  {
    canal: 'whatsapp', nicho: 'hospital', tipo: 'primeiro_contato',
    nome: 'WhatsApp · Hospital', assunto: null,
    corpo: `Olá {nome}, tudo bem? Aqui é {responsavel_comercial}, da iNovaCode.
Trabalhamos com RFID para controle de ativos, enxoval, equipamentos e insumos em operações com alta movimentação.
A ideia é dar mais rastreabilidade e reduzir controle manual.
Faz sentido conversarmos 15 minutos?`,
  },
  {
    canal: 'whatsapp', nicho: 'industria', tipo: 'primeiro_contato',
    nome: 'WhatsApp · Indústria', assunto: null,
    corpo: `Olá {nome}, tudo bem? Aqui é {responsavel_comercial}, da iNovaCode.
Ajudamos indústrias com RFID para rastreabilidade, inventário cíclico, controle de ferramentas, EPIs, ativos e materiais.
O foco é reduzir inventário manual, perdas e divergência entre físico e sistema.
Faz sentido uma conversa rápida de 15 minutos?`,
  },
  {
    canal: 'whatsapp', nicho: 'alimentos', tipo: 'primeiro_contato',
    nome: 'WhatsApp · Alimentos', assunto: null,
    corpo: `Olá {nome}, tudo bem? Aqui é {responsavel_comercial}, da iNovaCode.
A iNovaCode aplica RFID para rastreabilidade, controle de estoque, inventário cíclico e movimentações internas em operações de alimentos.
O objetivo é reduzir processo manual e aumentar visibilidade operacional.
Faz sentido uma conversa rápida de 15 minutos?`,
  },

  // ===================== TELEFONE — scripts (MANUAL — referência) =====================
  {
    canal: 'telefone', nicho: null, tipo: 'abertura_geral',
    nome: 'Telefone · Abertura geral', assunto: null,
    corpo: `Olá {nome}, tudo bem? Aqui é {responsavel_comercial}, da iNovaCode.
Vou ser bem breve. A gente trabalha com RFID para ajudar empresas a reduzir inventário manual, perdas, divergência de estoque e falta de rastreabilidade.
Estou falando com a {empresa} porque normalmente empresas do segmento de {segmento} têm algum desafio com controle de ativos, estoque ou movimentações internas.
Hoje esse tipo de controle aí é feito mais por sistema, planilha ou conferência manual?`,
  },
  {
    canal: 'telefone', nicho: null, tipo: 'gancho_reuniao',
    nome: 'Telefone · Gancho para reunião', assunto: null,
    corpo: `Entendi. O motivo do meu contato é justamente avaliar se existe algum ponto onde RFID poderia reduzir retrabalho ou dar mais visibilidade para vocês.
Não quero tomar seu tempo agora por telefone. Faz sentido marcarmos uma conversa de 15 minutos para eu entender melhor o cenário e te mostrar alguns exemplos de aplicação?`,
  },
  {
    canal: 'telefone', nicho: null, tipo: 'pedir_material',
    nome: 'Telefone · Se pedir para enviar material', assunto: null,
    corpo: `Claro, eu te envio sim.
Só para eu não mandar algo genérico: hoje o maior desafio de vocês está mais ligado a estoque, inventário, rastreabilidade, perda de ativos ou movimentação interna?
Com isso eu te mando algo mais direcionado e, se fizer sentido, marcamos uma conversa rápida depois.`,
  },
  {
    canal: 'telefone', nicho: null, tipo: 'nao_e_a_pessoa',
    nome: 'Telefone · Se não for a pessoa certa', assunto: null,
    corpo: `Sem problema, {nome}.
Você saberia me dizer quem é a pessoa mais envolvida com controle de estoque, logística, ativos, inventário ou rastreabilidade aí na {empresa}?
Pode ser alguém de operações, logística, TI, compras ou gestão industrial.`,
  },
]
