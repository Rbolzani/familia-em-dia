# Suporte — plantão de lançamento

Como o suporte funciona nas primeiras semanas. Item U8 da bateria de prontidão.
Escrito em 27/09/2026.

O objetivo aqui não é um "SAC": é garantir que **ninguém fique sem resposta** e
que os primeiros problemas reais cheguem rápido a quem pode corrigi-los.

---

## 1. Canais

| Canal | Endereço | Chega onde |
|---|---|---|
| Suporte | `suporte@familiaemdia.com.br` | ImprovMX → Gmail |
| Encarregado (LGPD) | `dpo@familiaemdia.com.br` | ImprovMX → Gmail |
| Dentro do app | aba **Suporte** → `/suporte` | mesmo e-mail acima |

Responder sempre **como** `suporte@` (Gmail → "Enviar como"), nunca pela conta
pessoal. Um e-mail pessoal na resposta vira o endereço que o cliente guarda.

## 2. Compromisso assumido

- **Primeira resposta em até 24 h úteis**, mesmo que seja "recebi, estou vendo".
- **Nas duas primeiras semanas de lançamento:** olhar a caixa **3×/dia** — manhã,
  início da tarde e fim do dia.
- **Depois:** 1×/dia, dias úteis.

Uma resposta curta e rápida vale mais que uma completa e tardia. "Recebi, vou
verificar e te respondo hoje" já muda a experiência.

## 3. Preparar o Gmail (uma vez)

1. **Filtro + marcador:** busca `to:(suporte@familiaemdia.com.br)` → criar filtro
   → aplicar marcador **Suporte**, marcar como importante, **nunca enviar para
   spam**.
2. Repetir para `dpo@` com o marcador **DPO/LGPD**.
3. **Notificação no celular** só para esses marcadores, para não competir com o
   resto da caixa.
4. Conferir que **"Enviar como suporte@"** está configurado e é o remetente
   padrão ao responder mensagens desse marcador.

## 4. Triagem — 3 caixas

**Agora (minutos):** cliente sem acesso, cobrança indevida, dado de outra
família aparecendo, vazamento. Qualquer coisa que envolva **dinheiro** ou
**dados de criança** entra aqui.

**Hoje:** funcionalidade quebrada para um cliente, dúvida que bloqueia o uso,
pedido de cancelamento ou reembolso.

**Esta semana:** dúvida de uso, sugestão, pedido de recurso novo.

Regra de bolso: se a pessoa **não consegue usar o que pagou**, é "agora".

## 5. Respostas prontas

Ajuste o tom, mas mantenha a estrutura: **o que aconteceu → o que fazer → o que
eu já fiz**.

### Não consigo entrar
```
Oi, [nome]! Vamos resolver.

1. Na tela de login, toque em "Esqueci minha senha" e siga o link do e-mail.
2. Se o link não chegar em 2 minutos, confira o spam — o remetente é
   noreply@familiaemdia.com.br.
3. Se abrir e disser que o link expirou, peça outro: por segurança, ele vale
   só para o primeiro uso.

Se ainda assim não entrar, me diga qual e-mail você usou no cadastro que eu
verifico por aqui.
```

### Como cancelo?
```
Você mesmo cancela pelo app, em Planos → Cancelar assinatura. Não precisa
falar com ninguém.

Cancelando durante os 14 dias grátis, nada é cobrado e você usa até o fim do
teste. Depois do teste, o acesso continua até o fim do período já pago, sem
nova cobrança. Depois disso a conta fica pausada: dá para ver tudo por 90 dias
e reativar quando quiser.
```
*(Internamente: quem contratou SEM teste — conta antiga, "assinar sem teste",
reativação — e cancela em até 7 dias da cobrança recebe o valor de volta na
hora, automaticamente; é o arrependimento do CDC, Termos 5.6.)*

### Quero reembolso
```
Entendo. Os 14 dias grátis existem justamente para conhecer o app antes de
pagar, e por isso, depois da primeira cobrança, a regra é o acesso seguir até
o fim do período já pago, sem nova cobrança — é o que está nos Termos.

Me conta o que motivou? Se foi algo que não funcionou como deveria, quero
corrigir, e aí avalio o reembolso caso a caso.
```

### Fui cobrado e não queria / esqueci de cancelar
```
A primeira cobrança acontece no 15º dia, e avisamos por e-mail 7 e 3 dias
antes e, na véspera, por e-mail e WhatsApp. Posso cancelar agora para não haver novas
cobranças, e você continua usando até o fim do período pago.

Me conta o que aconteceu que eu avalio o seu caso.
```
*(Internamente: reembolso fora da regra é decisão manual no painel do Stripe —
Pagamentos → Reembolsar. A taxa do Stripe não volta.)*

### Meu cartão foi recusado
```
Quando a cobrança é recusada, você tem 7 dias para atualizar o cartão, sem
perder nada. É só entrar em Planos → Atualizar cartão. Assim que o novo cartão
é aceito, a cobrança é feita e tudo segue normal.

Se passar dos 7 dias, a conta fica pausada (só visualização), e dá para
reativar em Planos a qualquer momento.
```

### Minha conta está pausada / não consigo editar
```
A conta fica pausada quando a assinatura termina (cancelamento ou cartão não
atualizado). Seus dados continuam guardados e você consegue ver tudo, mas não
criar nem editar. Quem você convidou também fica só com visualização.

Para voltar, é só reativar em Planos — escolhe o plano e cadastra o cartão.
Os dados ficam guardados por 90 dias depois da pausa; avisamos por e-mail 30
e 7 dias antes de apagar.
```

### Não consigo usar o teste grátis de novo
```
O teste grátis é um por pessoa (CPF) e por cartão. Como ele já foi usado,
a assinatura começa direto, sem teste — e, nesse caso, se você cancelar em até
7 dias da cobrança, devolvemos o valor integral.
```

### O resumo no WhatsApp não chegou
```
Vou verificar aqui o envio de hoje.

Enquanto isso, confira em Alertas: o aviso diário precisa estar ligado, com o
número no formato (11) 91234-5678, e o horário escolhido. O resumo é enviado
no horário que você definiu.
```
*(Internamente: consultar `whatsapp_messages` — status `failed` traz o código
do erro; `accepted` sem evolução é problema de entrega.)*

### Como convido meu parceiro?
```
Em Configurações → Compartilhar acesso, você gera um link de convite e
escolhe o nível: apenas leitura, leitura + logística, ou acesso completo.

Envie o link para a pessoa. Ela cria a conta (ou entra na dela) e passa a ver
os dados dos filhos conforme o nível que você escolheu. Dá para mudar o nível
ou revogar o acesso quando quiser, na mesma tela.
```

### Quero apagar minha conta e meus dados (LGPD)
```
Você pode fazer isso sozinho, em Minha Conta → Excluir conta.

A exclusão apaga cadastro, filhos, atividades, mensalidades e também os
arquivos guardados — documentos e fotos —, e encerra a assinatura. Permanecem
apenas registros que a lei exige manter, como os dados fiscais de cobranças já
feitas.

É definitivo e não dá para desfazer. Se preferir que eu faça por você, me
confirme por este mesmo e-mail.
```

## 6. Quando escalar para mim (desenvolvimento)

Encaminhe com **o que a pessoa fez, o que esperava e o que aconteceu**, mais
horário e e-mail da conta:

- dado de uma família aparecendo para outra pessoa — **para tudo, é prioridade**;
- cobrança que não bate com o plano contratado;
- mesma falha relatada por **duas pessoas diferentes** — deixa de ser caso
  isolado;
- qualquer erro que o Sentry também registrou.

## 7. Registro

Uma linha por atendimento, numa planilha ou no próprio marcador do Gmail:
**data · e-mail · assunto em 5 palavras · resolvido/pendente**.

Nas primeiras semanas isso vale mais que suporte bonito: é a lista do que o
produto precisa arrumar, escrita pelos clientes.
