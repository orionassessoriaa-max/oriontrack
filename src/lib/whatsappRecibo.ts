/**
 * Recibo de entrega do WhatsApp.
 *
 * O provedor fala do mesmo estado com nomes diferentes conforme o caminho:
 * o evento de atualizacao manda "DELIVERY_ACK" ou um numero, o historico manda
 * "Delivered". Sem traduzir tudo para a mesma escala nao da para saber se um
 * recibo novo e mais adiantado que o que ja esta gravado.
 */
export const ORDEM_RECIBO = ['pending', 'sent', 'server', 'delivered', 'read', 'played'];

export function reciboDoProvedor(valor: unknown) {
  const bruto = String(valor ?? '').trim().toLowerCase();
  if (!bruto) return '';
  if (bruto === '1') return 'sent';
  if (bruto === '2') return 'delivered';
  if (bruto === '3') return 'read';
  if (bruto === '4') return 'played';
  if (bruto === 'server_ack') return 'server';
  if (bruto === 'delivery_ack') return 'delivered';
  if (bruto === 'read_ack') return 'read';
  return ORDEM_RECIBO.includes(bruto) ? bruto : '';
}

/** Recibo atrasado nao pode rebaixar o que ja foi lido. */
export function reciboAvanca(atual: unknown, novo: string) {
  if (!novo) return false;
  const anterior = String(atual ?? '').trim().toLowerCase();
  if (!anterior) return true;
  return ORDEM_RECIBO.indexOf(novo) > ORDEM_RECIBO.indexOf(anterior);
}
