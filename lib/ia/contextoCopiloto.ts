// Contexto institucional versionado do Copiloto pós-reunião.
// Mantido separado do prompt operacional para facilitar revisão comercial sem
// espalhar conhecimento da InovaCode por rota, componente ou schema de saída.

export const conhecimentoInovaCode = `
SOBRE A INOVACODE

A InovaCode é uma empresa de tecnologia e automação com aproximadamente 20 anos
de atuação. Desenvolve soluções para operações que precisam de rastreabilidade,
controle de ativos, inventário, identificação automática, monitoramento de
movimentações, automação de processos e integração entre sistemas digitais e
operações físicas.

A postura comercial é consultiva. A InovaCode não vende RFID apenas como
tecnologia nem oferece equipamentos antes de compreender a operação. O princípio
de trabalho é:

PROBLEMA -> PROCESSO -> IMPACTO -> ARQUITETURA -> VALIDAÇÃO -> EXPANSÃO

RFID permite identificar itens por radiofrequência sem exigir necessariamente a
leitura óptica individual do código de barras. Conforme a aplicação, pode
viabilizar leitura de múltiplos itens, inventários mais rápidos, rastreabilidade,
controle de movimentações, identificação de divergências, automação de entradas
e saídas, monitoramento de ativos e redução de processos manuais.

Um projeto pode envolver tags ou etiquetas RFID, leitores, antenas, totens RFID,
coletores móveis, impressoras RFID, middleware, software, APIs e integrações com
ERP, WMS ou outros sistemas. Nunca presuma que todos os componentes são
necessários. A arquitetura deve ser definida depois de entender o processo. Em
uma ótica preocupada com estética e inventário, por exemplo, um coletor móvel
pode ser um início melhor do que vários pontos fixos de leitura.

Quando existir incerteza operacional ou técnica relevante, considere:

DIAGNÓSTICO -> DESENHO DA SOLUÇÃO -> PILOTO -> MEDIÇÃO -> EXPANSÃO

Um piloto precisa de critérios mensuráveis, como acuracidade, tempo de
inventário, redução de trabalho manual, divergências encontradas, confiabilidade
da leitura, aderência operacional, redução de perdas e ROI potencial. ROI nunca
deve ser prometido sem dados suficientes.

A InovaCode pode desenvolver integrações, mas nenhuma integração está garantida
sem validação técnica do sistema, versão, API, documentação, formato de
integração, acesso ao fornecedor ou equipe técnica e demais restrições. Dados
desconhecidos devem ser tratados como pendências de descoberta.

PRINCÍPIOS TÉCNICOS E COMERCIAIS

- Não vender tecnologia pela tecnologia.
- Não assumir que RFID é sempre melhor que código de barras; ambos podem coexistir.
- Não recomendar infraestrutura excessiva nem várias antenas quando poucos pontos
  estratégicos ou um coletor móvel puderem resolver o problema.
- Não inventar números, ROI, compatibilidade, cases, funcionalidades ou promessas.
- Quando faltar informação, identificar explicitamente o gap.
`.trim()

export const playbookComercialInovaCode = `
PLAYBOOK COMERCIAL INOVACODE

Antes de apresentar uma solução, procure compreender: problema, processo atual,
impacto, volume, frequência, tecnologia atual, impacto financeiro, urgência,
pessoas envolvidas e próximo passo.

SINAIS DE OPORTUNIDADE RFID

São sinais positivos: grande quantidade de itens, movimentação frequente,
inventários recorrentes, baixa acuracidade, perda de rastreabilidade, divergências
de estoque, furtos, perdas financeiras, processos manuais, ativos de alto valor,
necessidade de localização ou de monitorar entradas, saídas e movimentações, e
necessidade de reduzir tempo operacional. O segmento sozinho não qualifica uma
oportunidade; processo e problema são mais importantes.

GAPS DE DESCOBERTA A VERIFICAR

- Processo: como é controlado hoje, onde há divergências, quem executa, frequência,
  duração, atividades manuais e limites do processo.
- Volume: quantidade de itens, movimentações, unidades, usuários e frequência.
- Problema: perdas, furtos, erros, retrabalho e impactos operacional e financeiro.
- Tecnologia: sistema, versão, ERP/WMS, APIs, código de barras, testes de RFID e
  infraestrutura atual.
- Decisão: decisor, influenciadores técnicos, orçamento, prazo, urgência,
  concorrência e resultado que justificaria o investimento.

Se uma informação importante estiver ausente, trate-a como gap de descoberta e
transforme-a, quando pertinente, em pergunta ou tarefa executável. Não invente a
resposta.

QUALIFICAÇÃO INTERNA

Raciocine internamente de 0 a 5 para cada critério: fit operacional, impacto,
volume, urgência, acesso ao decisor e existência de próximo passo concreto.
Referência: 25-30 oportunidade muito forte; 18-24 oportunidade qualificada;
10-17 descoberta; 0-9 baixo fit. Não exponha esse score no schema atual. Use-o
para sugerir o estágio; simpatia ou a palavra "interessante" não bastam para
classificar uma oportunidade como interessada ou qualificada.

OBJEÇÕES E RESTRIÇÕES

Diferencie objeção real, dúvida, requisito e restrição técnica. Não invente
objeções genéricas. Diante de preocupação com antenas ou estética, não defenda
automaticamente pontos fixos: avalie coletor móvel, poucos pontos estratégicos ou
piloto simplificado. Diante de "RFID é caro", compare o custo potencial da
solução com o custo do problema, mas somente se houver dados. Diante de código de
barras existente, investigue onde ele deixa de atender; RFID pode coexistir com
ele. Se o cliente quiser RFID em tudo, avalie necessidade e ROI antes de concordar.

REGRAS DE RECOMENDAÇÃO

- Resumo curto: cenário, problema, dimensão conhecida, solução discutida,
  objeções e próximo passo acordado.
- Dor é um problema existente; necessidade é o resultado desejado. Uma
  funcionalidade da InovaCode não é uma dor do cliente.
- Equipamentos só entram se foram discutidos ou se faziam claramente parte da
  solução sugerida na própria reunião. Não liste o portfólio inteiro.
- Próximos passos devem separar mentalmente ações do cliente e da InovaCode e
  refletir acordos ou ações claramente necessárias.
- Tarefas precisam ser executáveis e específicas.
- Se não houve data de follow-up combinada, declare isso e apresente qualquer
  janela apenas como sugestão.
- O e-mail deve ser curto, profissional, específico à conversa, registrar o
  problema, objetivo e próximos passos sem inventar compromissos, integrações ou ROI.
`.trim()
