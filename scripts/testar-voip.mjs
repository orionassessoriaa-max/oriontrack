/**
 * Dispara uma ligacao de teste pelo Click2Call e mostra a resposta crua da
 * central. Serve para descobrir qual device_id e valido antes de ligar a
 * discagem para a equipe inteira.
 *
 *   npm run testar-voip -- 61999990000 61988880000
 *   npm run testar-voip -- 61999990000 61988880000 2      (forca o device_id 2)
 *
 * ATENCAO: isto faz o telefone tocar de verdade. Use dois numeros seus.
 */
function limpar(valor) {
  return String(valor || '').replace(/\^/g, '').trim();
}

function formatar(telefone) {
  let digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.length > 11 && digitos.startsWith('55')) digitos = digitos.slice(2);
  digitos = digitos.replace(/^0+/, '');
  if (digitos.length <= 6) return digitos;
  if (digitos.length < 10) return '';
  return `0${digitos}`;
}

const src = formatar(limpar(process.argv[2]));
const dst = formatar(limpar(process.argv[3]));
const deviceId = limpar(process.argv[4]) || process.env.VOIP_CLICK2CALL_DEVICE_ID;
const dominio = String(process.env.VOIP_CLICK2CALL_DOMINIO || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const token = process.env.VOIP_CLICK2CALL_TOKEN;
const key = process.env.VOIP_CLICK2CALL_KEY;

const faltando = [
  !dominio && 'VOIP_CLICK2CALL_DOMINIO',
  !token && 'VOIP_CLICK2CALL_TOKEN',
  !key && 'VOIP_CLICK2CALL_KEY',
  !deviceId && 'VOIP_CLICK2CALL_DEVICE_ID (ou passe como terceiro argumento)',
].filter(Boolean);
if (faltando.length) {
  console.error('Falta configurar no .env.local:\n  ' + faltando.join('\n  '));
  process.exit(1);
}
if (!src || !dst) {
  console.error('Uso: npm run testar-voip -- <numero-do-operador> <numero-de-destino> [device_id]');
  process.exit(1);
}
if (src === String(deviceId)) {
  console.error('Regra do manual: o ramal em src nao pode ser igual ao device_id.');
  process.exit(1);
}

console.log(`device_id ${deviceId} | src ${src} | dst ${dst}`);
console.log('a central liga primeiro para o src...');

const resposta = await fetch(`https://${dominio}/api/click2Call/${encodeURIComponent(token)}/${encodeURIComponent(key)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ device_id: Number(deviceId), src, dst }),
});
const corpo = await resposta.text();
console.log(`\nHTTP ${resposta.status}`);
console.log(corpo);
try {
  const json = JSON.parse(corpo);
  console.log(Number(json.error) === 0 ? '\nOK: a central aceitou. Se o telefone nao tocar, o device_id ou a linha estao errados.' : `\nRECUSADO: ${json.reason || json.message || 'sem motivo'}`);
} catch {
  console.log('\nA resposta nao veio em JSON. Confira o dominio.');
}
