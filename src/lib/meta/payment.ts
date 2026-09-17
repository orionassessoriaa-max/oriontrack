export type MetaBillingType = 'prepaid' | 'postpaid' | 'unknown';

type FundingSourceDetails = {
  display_string?: string | null;
  type?: string | number | null;
} | null | undefined;

type MetaBillingPayload = {
  balance?: string | number | null;
  funding_source_details?: FundingSourceDetails;
  is_prepay_account?: boolean | null;
};

function parseMoneyFromMetaText(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/(?:R\$|BRL)\s*([\d.]+(?:,\d{1,2})?)/i);
  if (!match) return null;
  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Usa `is_prepay_account`, campo oficial da conta, como fonte de verdade.
 * `funding_source_details.type` pode ser apenas um codigo numerico interno e
 * nunca deve ser exibido diretamente para o usuario.
 */
export function resolveMetaBilling(payload: MetaBillingPayload) {
  const rawBalance = payload.balance;
  const apiBalance = rawBalance === undefined || rawBalance === null
    ? null
    : Number(rawBalance) / 100;
  const fundingDetails = payload.funding_source_details;
  const fundingText = JSON.stringify(fundingDetails || {}).toLowerCase();
  const hasCardDescription = /card|cart|visa|mastercard|amex/.test(fundingText);
  const paymentError = /failed|declined|past.?due|unpaid|payment.?error|billing.?error|recusad|falh/.test(fundingText);
  const displayBalance = parseMoneyFromMetaText(fundingDetails?.display_string);
  const billingType: MetaBillingType = payload.is_prepay_account === true
    ? 'prepaid'
    : payload.is_prepay_account === false
      ? 'postpaid'
      : 'unknown';

  if (billingType === 'prepaid') {
    return {
      billingType,
      paymentLabel: 'Saldo pré-pago',
      availableBalance: displayBalance ?? apiBalance,
      paymentError: false,
    };
  }

  if (billingType === 'postpaid') {
    return {
      billingType,
      paymentLabel: hasCardDescription ? 'Cartão' : 'Pós-pago',
      availableBalance: null,
      paymentError,
    };
  }

  return {
    billingType,
    paymentLabel: hasCardDescription ? 'Cartão' : 'Método cadastrado na Meta',
    availableBalance: null,
    paymentError: hasCardDescription && paymentError,
  };
}
