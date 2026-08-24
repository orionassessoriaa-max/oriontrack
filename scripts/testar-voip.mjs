/**
 * Dispara uma ligacao de teste pelo Click2Call e mostra a resposta crua da
 * central. Serve para descobrir qual device_id e valido antes de ligar a
 * discagem para a equipe inteira.
 *
 *   npm run testar-voip -- 61999990000 61988880000
 *   npm run testar-voip -- 61999990000 61988880000 2      (forca o device_id 2)
 *   npm run testar-voip -- 61999990000 61988880000 scan   (procura o device_id)
 *   npm run testar-voip -- 61999990000 61988880000 scan 9171025 9171026
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
if (String(deviceId).toLowerCase() !== 'scan' && src === String(deviceId)) {
  console.error('Regra do manual: o ramal em src nao pode ser igual ao device_id.');
  process.exit(1);
}
const endpoint = `https://${dominio}/api/click2Call/${encodeURIComponent(token)}/${encodeURIComponent(key)}`;

async function chamar(id) {
  const resposta = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: Number(id), src, dst }),
  });
  const corpo = await resposta.text();
  let json = null;
  try { json = JSON.parse(corpo); } catch { /* resposta fora do padrao */ }
  return { status: resposta.status, corpo, json };
}

// A central valida na ordem src, dst e device_id. Id errado responde
// DEVICE_NOT_FOUND sem discar, entao a varredura so faz o telefone tocar
// quando encontra o id certo.
if (String(deviceId).toLowerCase() === 'scan') {
  // O manual diz que o device_id e o ID da linha, e o exemplo usa 1. Em algumas
  // contas esse ID e o proprio numero da linha, entao a varredura tenta os ids
  // pequenos e tambem o que voce passar depois de 'scan'.
  const extras = process.argv.slice(5).map(limpar).filter(Boolean);
  const candidatos = [...Array.from({ length: 20 }, (_, i) => i + 1), ...extras];
  console.log(`procurando o device_id | src ${src} | dst ${dst}`);
  console.log(`candidatos: 1 a 20${extras.length ? ' e ' + extras.join(', ') : ''}`);
  console.log('id errado nao disca; quando o telefone tocar, achamos.\n');
  for (const id of candidatos) {
    const { json, corpo } = await chamar(id);
    const motivo = json ? (json.reason || json.message || corpo) : corpo.slice(0, 80);
    if (json && Number(json.error) === 0) {
      console.log(`\n>>> device_id ${id} ACEITO: ${json.message || 'chamada em processamento'}`);
      console.log('Coloque este valor em VOIP_CLICK2CALL_DEVICE_ID.');
      process.exit(0);
    }
    console.log(`    device_id ${String(id).padStart(2)} | ${motivo}`);
  }
  console.log('\nNenhum candidato foi aceito. Peca o device_id ao suporte.');
  process.exit(1);
}

console.log(`device_id ${deviceId} | src ${src} | dst ${dst}`);
console.log('a central liga primeiro para o src...');
const { status, corpo, json } = await chamar(deviceId);
console.log(`\nHTTP ${status}`);
console.log(corpo);
if (!json) console.log('\nA resposta nao veio em JSON. Confira o dominio.');
else if (Number(json.error) === 0) console.log('\nOK: a central aceitou e vai ligar para o src primeiro.');
else console.log(`\nRECUSADO: ${json.reason || json.message || 'sem motivo'}`);
