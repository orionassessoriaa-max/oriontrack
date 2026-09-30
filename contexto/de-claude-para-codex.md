# Do Claude para o Codex

> Sessão de 30/09/2026. Projeto: oriontrack. Resposta à pergunta de arquitetura
> do fluxo ISA → vendedor → revisão do SDR, na Unity. Nada foi implementado.

## Três fatos do sistema que mudam o desenho

Antes da proposta, o que eu conferi no código — porque duas das perguntas têm
resposta diferente dependendo disso.

**1. As filas da Unity não existem como dado.** `conversationBelongsToBox` em
`src/app/inbox/page.tsx:153` deriva a caixa de três campos da conversa:
`status`, `hasHumanReply` e `hasOpenFollowUp`. Não há coluna de fila, não há
tabela de fila. Então "criar uma quinta fila" não é adicionar uma linha numa
lista: é inventar um estado novo e ensinar o derivador a enxergá-lo.

**2. A tabela `notificacoes` já existe e serve.** Colunas em uso:
`titulo`, `mensagem`, `remetente_profile_id`, `destinatario_profile_id`,
`destinatario_tipo`, `lida`. O contador de não lidas e o realtime já estão
ligados no `Sidebar`.

**Mas o endpoint `POST /api/notificacoes` dispara WhatsApp pelo Apolo**
(`sendApoloWhatsApp`, linha ~37). O pedido diz explicitamente que esta
notificação não pode sair por WhatsApp. Reaproveitar aquele endpoint manda
mensagem para o celular do vendedor. Precisa de endpoint próprio que só insere
a linha.

**3. Já existe um papel `sdr`, mas em outro contexto.** `src/lib/comercial.ts`
define `CommercialRole = coordenador | closer | sdr | visualizador`, do módulo
comercial (Kripto), que não tem `corretor_id` e casa conversa por telefone. O
SDR da Unity é outra pessoa, em outro fluxo. Reaproveitar o tipo confunde dois
domínios que hoje são separados de propósito — eu criaria um papel próprio no
escopo da concessionária.

---

## 1. Fila separada, filtro, ou outra coisa?

**Nenhum dos dois. Uma tela própria de revisão, lendo as mesmas conversas.**

Contra a quinta fila na barra do vendedor:

- As quatro filas são o fluxo de trabalho **do vendedor**. Revisão é outro ator,
  com outro ciclo de vida. Misturar os dois na mesma barra faz cada um dos
  vendedores ver, o dia inteiro, uma fila que não é dele.
- A barra já está no limite. Foram necessários rótulo empilhado sobre contador e
  fonte de 10px para caber quatro em 320px. A quinta quebra o layout que o dono
  acabou de aprovar.
- A fila precisaria ser derivada de um estado que o vendedor não controla, então
  o número que ele vê mudaria sozinho, por ação de outra pessoa.

Contra o filtro dentro do Inbox atual:

- O Inbox é o componente que garante "cada vendedor vê apenas os seus leads".
  Abrir exceção ali é abrir exceção no ponto mais sensível do sistema. Um erro de
  condicional e um vendedor passa a ver a conversa de outro.
- Filtro é opção de visualização; revisão é trabalho com estado e pendência.
  Filtro não tem onde guardar "revisado", "notificado", "concluído".

A favor da tela própria (`/inbox/revisao`, ou `/unity/revisao`):

- **Segurança por ausência, não por ocultação.** A tela do SDR simplesmente não
  monta compositor, não importa `sendMessage`, não tem botão de encerrar. Não
  existe o que esconder.
- Endpoint próprio, com verificação de papel e de concessionária em um lugar só,
  fácil de auditar.
- A lista do SDR é ordenada pelo que importa para ele (mais antigo pendente
  primeiro), que é ordem diferente da do vendedor (última mensagem primeiro).
- O Inbox do vendedor fica intacto. Zero risco de regressão numa tela que 30
  pessoas usam o dia inteiro.

**Relação com as filas do vendedor: nenhuma, e isso é proposital.** Revisão é
ortogonal. Um lead pode estar em "Em atendimento" para o vendedor e "pendente"
para o SDR ao mesmo tempo, sem que um estado interfira no outro. É o que evita
que a revisão atrapalhe o atendimento.

## 1b. Como fica a fila do SDR, na prática

Mesma forma do Inbox — lista à esquerda, conversa à direita — porque é o modelo
mental que a equipe já tem. O que muda é tudo que decorre do trabalho ser outro.

```
┌─────────────────────────────┬──────────────────────────────────────────┐
│ REVISÃO                     │  Marcia Silva · (31) 98765-4321          │
│ 12 pendentes                │  Vendedor: Melina Meira                  │
│ mais antigo: há 6 dias  ⚠   │  Distribuído há 2h · Cotação enviada     │
│                             │                                          │
│ [Pendentes] Notificados     │  ┌────────────────────────────────────┐  │
│ ─────────────────────────── │  │ SOMENTE LEITURA                    │  │
│ ● Marcia Silva        há 2h │  │ Você não responde por esta conversa│  │
│   Melina Meira              │  └────────────────────────────────────┘  │
│   "quero saber o valor..."  │                                          │
│ ─────────────────────────── │   (a conversa, igual à do vendedor,      │
│   João Pereira        há 5h │    sem compositor no rodapé)             │
│   Lucas Andrade             │                                          │
│   "bom dia, é pra mim e..." │                                          │
│ ─────────────────────────── │                                          │
│   Ana Souza           há 6d │  ┌──────────────┬────────────────────┐   │
│   Melina Meira        ⚠     │  │  Adequado    │ Notificar vendedor │   │
│   "..."                     │  └──────────────┴────────────────────┘   │
└─────────────────────────────┴──────────────────────────────────────────┘
```

### As sete decisões que esse desenho carrega

**Ordem: mais antigo primeiro.** O Inbox do vendedor ordena pela última mensagem,
porque lá o risco é deixar cliente falando sozinho. Aqui o risco é lead
envelhecer sem revisão, então a ordem se inverte. Item novo entra embaixo.

**O cabeçalho mostra idade, não só contagem.** "12 pendentes" não alarma ninguém.
"mais antigo: há 6 dias" alarma. Com um SDR só, esse número é o único aviso de
que a fila parou.

**Cada linha mostra o vendedor responsável.** É a informação que define o trabalho
do SDR — ele não atende, ele avisa alguém. Sem isso ele abre a conversa só para
descobrir para quem falar.

**A linha mostra a primeira mensagem do cliente, não a última.** O que o SDR
julga é se o lead tem perfil, e isso está no que a pessoa pediu no começo, não no
último "ok".

**Duas abas, não quatro.** Pendentes e Notificados. "Notificados" é a lista do que
ele apontou e ainda não teve ciência — é dali que ele cobra. Aprovado sai de
vista: se virar aba, vira lista infinita que ninguém abre.

**O aviso de somente leitura fica no topo da conversa, sempre visível.** Não é
tooltip, não é aviso que aparece uma vez. Com a tela idêntica à do vendedor, a
única coisa que impede confusão é o rótulo estar sempre lá — junto com a ausência
do compositor.

**As duas ações ficam no rodapé da conversa, onde estaria o compositor.** É para
onde a mão vai depois de ler. "Adequado" é secundário, "Notificar vendedor" é o
que abre o card.

### O que o SDR NÃO vê

Só entram na lista os leads com revisão `pendente` — e, na segunda aba, os que ele
mesmo notificou. Ele não recebe um Inbox da concessionária inteira.

Isso é decisão de segurança, não de interface: hoje a regra do sistema é "cada
vendedor vê apenas os seus leads", e o SDR é a primeira exceção. Quanto mais
estreita a exceção, menor o estrago se algo escapar.

## 2. Dois observadores sem dois responsáveis

O dono do lead continua sendo um só: `responsibleProfileId` na conversa, escrito
pelo rodízio. **O fluxo de revisão nunca escreve nesse campo.** Essa é a regra
que sustenta tudo.

O acesso do SDR não é propriedade, é concessão, e mora em outro lugar: uma linha
de revisão que aponta para o lead e para o SDR. Ela dá direito de **ler**.

Para a leitura ser realmente só leitura, três camadas:

1. **Servidor.** O endpoint de envio já valida autoria. A regra passa a ser
   explícita: envia quem é o responsável, ou supervisor do time. Papel de revisão
   não entra nessa lista, em nenhuma condição.
2. **Visibilidade de mensagem.** `src/lib/inboxMessageVisibility.ts` já decide
   quem vê o quê. A revisão entra ali como caso próprio, e não como "supervisor",
   para não herdar poderes que supervisor tem.
3. **Interface.** A tela do SDR não tem compositor. Não é `disabled`, não é
   `hidden`: não é renderizado.

Sem conversa duplicada: é a mesma `whatsapp_conversas`, as mesmas mensagens, lida
por outra tela. Duplicar conversa criaria dois históricos que divergem no
primeiro webhook.

## 3. O botão "Notificar vendedor" e o card de motivo

> Decisão do dono em 30/09: o botão abre um card onde o SDR escreve o motivo, e
> esse campo aceita mensagem rápida, como o compositor.

### O card

Abre ancorado no botão, sobre a conversa. Não é tela cheia — o SDR precisa
continuar vendo o que está julgando enquanto escreve.

Dentro dele, nesta ordem:

1. **Motivos rápidos**, como chips clicáveis. Clicar insere o texto no campo,
   sem enviar. O SDR pode usar puro, completar ou apagar.
2. **Campo de texto livre**, obrigatório, com limite (500 caracteres serve).
3. **Notificar** e **Cancelar**.

Depois de enviado, o botão vira marcador de estado — "Notificado há 5 min" —
para não notificar duas vezes o mesmo lead sem perceber.

### As mensagens rápidas: mesma ideia, lista separada

**Não reaproveitar as macros do compositor.** Elas estão em
`corretores.operadoras_info.unity_inbox_config` e carregam muito mais do que
texto: `messages[]` com áudio e arquivo, `intervalSeconds`, e `actions` com
`closeConversation`, `status` e `labelIds`.

Dois problemas em reusá-las:

- São mensagens **para o cliente**. No campo de motivo interno, o SDR veria
  "Olá! Segue a cotação..." como opção de motivo.
- Carregam ações. Ligar uma macro no card de notificação abre caminho para uma
  anotação interna **fechar a conversa do cliente** ou mudar o status do lead. É
  o tipo de acidente que só aparece em produção.

O que eu faria: uma lista própria, com a forma mínima — `id`, `titulo`, `texto`.
Sem mensagens múltiplas, sem áudio, sem ações.

Onde guardar: no mesmo `unity_inbox_config`, numa chave nova
(`motivosRevisao`), com sanitizador próprio no padrão do `sanitizeUnityMacros`.
É config de concessionária, muda pouco, e evita tabela nova para uma lista de
cinco linhas.

Quem edita: admin, na mesma tela onde hoje se editam as macros, em seção
separada — com formulário simples, porque o objeto é simples.

### O que se perde, e como recuperar depois

Com motivo em texto livre, não dá para responder "quantos leads foram recusados
por estarem fora de região". As mensagens rápidas reduzem isso na prática, porque
o texto tende a se repetir, mas não garantem nada — basta alguém digitar do
zero.

Se essa métrica importar, o caminho é acrescentar depois uma categoria opcional
ao motivo rápido, e gravar a categoria junto do texto quando ele veio de um chip.
Não bloqueia começar agora.

### A ação em si

Uma ação, dois efeitos, uma transação:

1. Atualiza a linha de revisão para `notificado`, gravando motivo, observação,
   quem notificou e quando.
2. Insere **uma** linha em `notificacoes` com `destinatario_profile_id` do
   vendedor responsável, referência à conversa, e nada mais.

Três coisas que ele **não** faz, e que precisam estar escritas no código, não só
na cabeça de quem implementa:

- Não chama `sendApoloWhatsApp`. Endpoint próprio, justamente por isso.
- Não mexe em `responsibleProfileId`.
- Não muda `status` da conversa nem cria tarefa — senão o lead pula de fila no
  Inbox do vendedor sozinho, que é o efeito que a gente passou a semana
  corrigindo.

O botão exige motivo selecionado. Sem motivo, o vendedor recebe "tem algo errado"
e não sabe o quê.

## 4. Onde a notificação aparece para o vendedor

Em dois lugares, com pesos diferentes:

**Na conversa: uma tarja fixa logo acima do compositor.** Não é bolha no fio da
conversa — bolha parece mensagem do cliente, e o fio é espelho do WhatsApp; nada
que não saiu do WhatsApp pode entrar ali. Acima do compositor é onde o olho já
está quando ele vai responder.

**Na lista: um marcador na linha da conversa.** Um ponto ou uma etiqueta curta,
para ele achar sem abrir uma por uma.

Não usar modal. Modal bloqueia o trabalho e é fechado por reflexo, sem leitura —
e aí a notificação foi "vista" sem ter sido lida.

## 5. Ciência, motivo e histórico

Os três, com uma ressalva em cada.

**Motivo: lista curta e fechada, três a cinco opções, mais observação opcional.**
Só texto livre vira dado que ninguém consegue somar depois. Sugestão de partida,
a confirmar com a operação: fora de região, sem perfil, dado incorreto,
duplicado.

**Ciência: botão explícito "Ciente", que resolve a pendência.** Sem ele não dá
para distinguir "viu e tratou" de "ignorou", e a métrica de revisão não fecha.

**Histórico em dois lugares, com papéis diferentes.** A linha de revisão é a
fonte da verdade do processo. Um registro em `lead_atividades` entra na linha do
tempo do lead — é lá que qualquer pessoa vai procurar daqui a três meses. A
tabela `lead_atividades` já existe e já é usada em mudança de status.

## 6. Ciclo de estados

Quatro estados, sem inventar mais:

```
pendente ──> aprovado ──────────────> (sai do fluxo)
    │
    └─────> notificado ──> ciente ──> concluido
```

- **pendente** — lead distribuído, revisão ainda não feita.
- **aprovado** — SDR revisou e está adequado. Some da fila dele. O vendedor não
  recebe nada: notificação de "está tudo certo" é ruído e treina a pessoa a
  ignorar as próximas.
- **notificado** — SDR apontou problema. Pendência aberta no Inbox do vendedor.
- **concluido** — vendedor deu ciência. Fecha o ciclo.

Eu **não** colocaria "em_revisao" como estado persistido. Ele só existe enquanto
o SDR está com a tela aberta, e estado que depende de alguém não fechar o
navegador vira lixo travado. Para evitar dois SDRs no mesmo lead, ver o ponto 8.

## 7. Modelo de dados, API e interface

**Dados.** Uma tabela nova, `unity_revisoes`:

| coluna | para quê |
|---|---|
| `id` | |
| `lead_id`, `conversa_id` | o que está sendo revisado |
| `vendedor_profile_id` | cópia do responsável no momento da criação, para auditoria |
| `sdr_profile_id` | quem revisou |
| `estado` | pendente / aprovado / notificado / concluido |
| `motivo`, `observacao` | preenchidos só em `notificado` |
| `criado_em`, `revisado_em`, `notificado_em`, `ciente_em` | a linha do tempo |

Índice único parcial em `lead_id` onde `estado = 'pendente'`: impede duas
revisões abertas para o mesmo lead.

`corretor_id` da Unity entra como coluna ou como join — mas a checagem de
concessionária tem que existir na consulta, não só no front.

**API.** Quatro rotas, todas com guarda de papel e de concessionária:

- `GET /api/unity/revisoes` — fila do SDR
- `POST /api/unity/revisoes/[id]/aprovar`
- `POST /api/unity/revisoes/[id]/notificar` — motivo obrigatório
- `POST /api/unity/revisoes/[id]/ciente` — só o vendedor responsável

**Interface.**

- Rota nova para o SDR, sem compositor.
- No Inbox do vendedor: a tarja acima do compositor e o marcador na linha.
- Nada muda nas quatro filas, no rodízio ou nas permissões existentes.

**Quem cria a linha `pendente`?** O mesmo ponto que hoje distribui o lead pelo
rodízio. Se for criada em outro lugar, os dois fluxos divergem no primeiro erro
de rede.

## 8. Riscos

**Exposição de conversa é o maior.** Hoje vale "cada vendedor vê apenas os seus
leads". O SDR é a primeira exceção a essa regra. Mitigação: papel próprio e não
reaproveitamento de "supervisor"; verificação no servidor em toda rota; e
`writeAuditLog` em cada conversa que o SDR abre — auditoria já existe no projeto.

**Concorrência entre SDRs.** Dois abrem o mesmo lead e um sobrescreve o outro. O
índice único parcial resolve a duplicação de linha; a escrita usa comparação de
estado esperado, para o segundo receber conflito em vez de silenciosamente
vencer.

**Confusão de responsabilidade.** O vendedor pode achar que o SDR assumiu. É por
isso que a tarja diz quem notificou e quando, e por isso que o SDR não tem
compositor: se ele não consegue responder, ninguém supõe que ele responde.

**WhatsApp indevido.** Repito porque é o erro mais provável desta
implementação: o endpoint de notificação que já existe manda WhatsApp. Este
fluxo precisa do seu próprio.

**A ISA pedindo CPF duas vezes.** "Uma única vez" exige marca de idempotência na
conversa — um campo em `metadata`, do tipo `cpf_solicitado_em`. Sem isso, um
reinício de fluxo ou uma reentrega de webhook faz a ISA perguntar de novo, e para
o cliente isso lê como sistema quebrado. E "não insiste" significa nenhuma
tentativa de retry, nem depois de silêncio.

**Notificação sem dono.** Se o lead for reatribuído entre a notificação e a
ciência, a pendência fica órfã. Por isso `vendedor_profile_id` é gravado na linha
de revisão: a pendência pertence a quem era responsável no momento, e o novo
responsável vê a pendência anterior como histórico, não como tarefa dele.

---

## Respondido pelo dono: vai existir um SDR só

Isso fecha a pergunta que estava em aberto e simplifica três pontos.

**Critério de entrada: não precisa.** Todo lead distribuído entra como
`pendente`. A alternativa — amostragem — só faria sentido com fila grande demais
para uma pessoa, e isso a gente descobre olhando o número, não adivinhando agora.

**Concorrência entre SDRs deixa de ser problema real.** O índice único parcial em
`lead_id` continua valendo como higiene, mas o cenário de dois revisores
disputando o mesmo lead não existe. Não é preciso mecanismo de reserva, de
"assumir revisão", nem estado intermediário.

**`sdr_profile_id` continua na tabela**, mesmo com uma pessoa só. Ele responde
"quem notificou" no histórico, e é o que evita migração no dia em que entrar o
segundo SDR.

### O risco que aparece no lugar

Com uma pessoa só, a fila para quando ela para. Férias, atestado, um dia cheio, e
o `pendente` acumula sem ninguém perceber.

Duas defesas, as duas baratas:

1. **A fila mostra a idade do item mais antigo**, não só a contagem. "12
   pendentes" não alarma ninguém; "o mais antigo tem 6 dias" alarma.
2. **Nada bloqueia a venda enquanto a revisão não acontece.** Essa é a
   propriedade que torna o SDR único aceitável: o lead é distribuído na hora, o
   vendedor atende normalmente, e a revisão corre em paralelo. Se a revisão
   parar, o atendimento continua — o que se perde é a checagem, não o negócio.
   **Nenhuma parte do fluxo pode esperar pela revisão.** Se em algum momento
   alguém propuser segurar o lead até o SDR aprovar, isso muda o risco de lugar e
   precisa ser decidido de novo.

### Ainda em aberto, para o dono

Nada que bloqueie começar. Duas coisas que dá para decidir enquanto se
implementa:

- Os motivos da notificação. Eu sugeri quatro como ponto de partida — fora de
  região, sem perfil, dado incorreto, duplicado — mas quem sabe quais são os
  problemas reais é quem revisa.
- Se leads que o SDR aprovou devem sumir da vista dele ou virar um histórico
  consultável. Sumir é mais simples; histórico ajuda a medir quantos leads ruins
  o rodízio está distribuindo.
