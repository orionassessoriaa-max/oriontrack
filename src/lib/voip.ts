/**
 * Click2Call da VoIP do Brasil.
 *
 * A API so origina a chamada: liga primeiro para o src (o SDR) e, quando ele
 * atende, liga para o dst (o lead) e junta os dois em conferencia. O retorno
 * nao traz identificador, nao diz se alguem atendeu, nao tem duracao e nao tem
 * gravacao. Duracao, atendimento e audio dependem do CDR da operadora, que
 * ainda nao foi liberado para a conta.
 *
 * O token e a key vao dentro da URL, entao a chamada nunca pode sair do
 * navegador e a URL nunca pode ir para log.
 */
const TIMEOUT_MS = 15000;

export type ResultadoDiscagem = {
  originada: boolean;
  motivo?: string;
  resposta?: { error?: number; reason?: string; message?: string };
};

export function voipConfigurado() {
  return Boolean(
    process.env.VOIP_CLICK2CALL_DOMINIO &&
    process.env.VOIP_CLICK2CALL_TOKEN &&
    process.env.VOIP_CLICK2CALL_KEY &&
    process.env.VOIP_CLICK2CALL_DEVICE_ID,
  );
}

/**
 * O manual envia os numeros como texto no formato 0 + DDD + numero
 * ("021980986000"), sem o 55 do Brasil. Numero salvo no CRM vem em varios
 * formatos: "(11)93152-9897", "5561999990000", "+55 61 99999-0000".
 */
export function formatarNumeroVoip(telefone?: string | null) {
  let digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.length > 11 && digitos.startsWith('55')) digitos = digitos.slice(2);
  digitos = digitos.replace(/^0+/, '');
  // Ramal continua ramal: nao leva o zero de discagem na frente.
  if (digitos.length <= 6) return digitos;
  if (digitos.length < 10) return '';
  return `0${digitos}`;
}

export async function originarClick2Call(options: {
  src: string;
  dst: string;
  deviceId?: string;
}): Promise<ResultadoDiscagem> {
  const dominio = String(process.env.VOIP_CLICK2CALL_DOMINIO || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const token = process.env.VOIP_CLICK2CALL_TOKEN;
  const key = process.env.VOIP_CLICK2CALL_KEY;
  const deviceId = options.deviceId || process.env.VOIP_CLICK2CALL_DEVICE_ID;

  if (!dominio || !token || !key || !deviceId) {
    return { originada: false, motivo: 'Discagem automatica nao configurada.' };
  }
  if (!options.src) return { originada: false, motivo: 'Operador sem telefone ou ramal cadastrado.' };
  if (!options.dst) return { originada: false, motivo: 'Lead sem telefone valido.' };
  // Regra critica do manual: ramal do src precisa ser diferente do device_id.
  if (options.src === String(deviceId)) {
    return { originada: false, motivo: 'O ramal do operador nao pode ser o mesmo da linha de origem.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://${dominio}/api/click2Call/${encodeURIComponent(token)}/${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: Number(deviceId), src: options.src, dst: options.dst }),
        signal: controller.signal,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload?.error) !== 0) {
      return {
        originada: false,
        motivo: String(payload?.reason || payload?.message || `Erro HTTP ${response.status} na discagem.`),
        resposta: payload,
      };
    }
    return { originada: true, resposta: payload };
  } catch (error: any) {
    const abortou = error?.name === 'AbortError';
    return { originada: false, motivo: abortou ? 'Tempo esgotado ao falar com a central telefonica.' : 'Falha ao falar com a central telefonica.' };
  } finally {
    clearTimeout(timeout);
  }
}
