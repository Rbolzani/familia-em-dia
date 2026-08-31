# DMARC — plano de endurecimento

**Achado 17 da bateria de pré-lançamento.** Estado em 30/08/2026: o domínio publica
`v=DMARC1; p=none;` e nada mais.

## Por que isso importa aqui

Duas coisas faltam, e a segunda é a que realmente incomoda.

`p=none` não pede ação nenhuma do servidor que recebe. Qualquer pessoa pode enviar
e-mail se passando por `@familiaemdia.com.br` e a mensagem é entregue normalmente.
Este é o domínio que manda **redefinição de senha** — é o disfarce mais valioso que
existe no produto.

**Não há `rua=`**, o endereço para onde vão os relatórios agregados. E `p=none` existe
*para* colher dados antes de endurecer. Sem `rua` ele não colhe nada: é o pior dos
dois mundos, nenhuma proteção e nenhuma visibilidade.

SPF e DKIM já estão corretos e não precisam de mudança:

| Registro | Valor | Situação |
|---|---|---|
| SPF raiz | `v=spf1 include:spf.improvmx.com ~all` | correto (recebimento) |
| SPF `send.` | `v=spf1 include:amazonses.com ~all` | correto (envio via Resend) |
| DKIM | `resend._domainkey` publicado | correto |
| MX | `mx1/mx2.improvmx.com` | correto |

## Onde mexer

Registro.br → o domínio → **DNS / modo avançado**. É um registro **TXT** no nome
`_dmarc` (não na raiz).

## Passo 1 — agora: ligar a visibilidade

Substituir o valor atual por:

```
v=DMARC1; p=none; rua=mailto:dpo@familiaemdia.com.br; adkim=r; aspf=r
```

O que cada parte faz:

- `p=none` — **continua sem enforcement de propósito**. Não mude ainda.
- `rua=` — relatórios agregados diários. É o que passa a existir, e é o ponto inteiro
  deste passo.
- `adkim=r; aspf=r` — alinhamento relaxado, que é o correto aqui: o Resend envia com
  return-path no subdomínio `send.`, e alinhamento estrito reprovaria envio legítimo.

> **Sobre `ruf` (relatórios forenses):** deixado de fora de propósito. Quase nenhum
> provedor grande envia, e os que enviam mandam **cópia da mensagem que falhou** —
> que pode conter dado pessoal de terceiros, caindo numa caixa que não foi pensada
> para isso. O `rua` sozinho responde a pergunta que importa: quem está enviando em
> nome do domínio, e o que passa ou não.

> ⚠️ **Sobre o volume.** Os relatórios chegam como anexo XML, um por provedor por dia
> (Google, Microsoft, Yahoo…). Como `dpo@` é encaminhado pelo ImprovMX para o seu
> Gmail, espere alguns e-mails por dia. Se incomodar, troque por um endereço dedicado
> ou por um serviço que leia os XML por você — mas **não tire o `rua`**, ele é o ponto
> inteiro deste passo.

## Passo 2 — depois de 2 a 4 semanas lendo os relatórios

Só avance quando os relatórios mostrarem que **todo** envio legítimo passa (Resend para
os e-mails de auth, e qualquer coisa que saia do Gmail como `dpo@`/`suporte@`).

```
v=DMARC1; p=quarantine; pct=25; rua=mailto:dpo@familiaemdia.com.br; adkim=r; aspf=r
```

`pct=25` aplica a regra a um quarto das mensagens reprovadas. Se nada legítimo cair,
subir para `pct=100`, depois para `p=reject`.

## O erro a não cometer

Ir direto para `p=reject` sem ter lido relatório nenhum. O que acontece é o
previsível: um caminho de envio legítimo que ninguém lembrava — o "enviar como" do
Gmail, um formulário, uma ferramenta de marketing — passa a ser **descartado
silenciosamente** pelo destinatário. E, diferente de cair no spam, mensagem rejeitada
por DMARC não vai para pasta nenhuma.

## Como conferir depois de aplicar

```bash
curl -s "https://cloudflare-dns.com/dns-query?name=_dmarc.familiaemdia.com.br&type=TXT" -H "accept: application/dns-json"
```

A propagação leva de minutos a algumas horas. O primeiro relatório costuma chegar em
24–48h.
