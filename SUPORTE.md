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

Se a contratação foi há menos de 7 dias, o cancelamento devolve o valor
integral e encerra na hora (direito de arrependimento). Passados os 7 dias,
o acesso continua até o fim do período já pago, sem nova cobrança.
```

### Quero reembolso (fora dos 7 dias)
```
Entendo. Fora do prazo de 7 dias a regra é o acesso seguir até o fim do
período já pago, sem nova cobrança — é o que está nos Termos.

Me conta o que motivou? Se foi algo que não funcionou como deveria, quero
corrigir, e aí avalio o reembolso caso a caso.
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
