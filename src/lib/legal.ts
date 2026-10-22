// Versão vigente dos documentos legais. Ao publicar uma nova versão dos Termos
// ou da Política, incremente LEGAL_VERSION — assim o aceite passa a referenciar
// a versão correta e é possível auditar quem aceitou o quê.
export const LEGAL_VERSION = '2026-10-22'
export const LEGAL_EFFECTIVE_DATE = '22 de outubro de 2026'

// Data da virada para a nova oferta (Termos 5.12). FIXA: não acompanha
// LEGAL_EFFECTIVE_DATE — cada nova versão dos documentos mudaria o corte das
// contas do modelo antigo.
export const NOVA_OFERTA_DATA = '21 de outubro de 2026'

export const LEGAL_ENTITY = {
  razaoSocial: 'Bonju Serviços Ltda.',
  nomeFantasia: 'Família em Dia',
  cnpj: '49.111.234/0001-03',
  endereco: 'Rua Conde do Pinhal, nº 1.762, caixa postal nº 73, Jardim São Carlos, São Carlos-SP, CEP 13560-648',
  email: 'suporte@familiaemdia.com.br',   // contato geral / suporte (caixa ativa via ImprovMX → Gmail)
  dpoEmail: 'dpo@familiaemdia.com.br',    // Encarregado/DPO (LGPD) — caixa ativa via ImprovMX → Gmail
}
