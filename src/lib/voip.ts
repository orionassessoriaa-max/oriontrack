/**
 * Click2Call da VoIP do Brasil.
 *
 * A API so origina a chamada: liga primeiro para o src (o SDR) e, quando ele
 * atende, liga para o dst (o lead) e junta os dois em conferencia. O retorno
 * nao traz identificador, nao diz se alguem atendeu, nao tem duracao e nao tem
 * gravacao. Duracao, atendimento e audio sao conciliados depois pelo endpoint
 * /api/recording da mesma operadora.
 *
 * O token e a key vao dentro da URL, entao a chamada nunca pode sair do
 * navegador e a URL nunca pode ir para log.
 */
const TIMEOUT_MS = 15000;

export type GravacaoVoip = {
  recordId: number;
  calldate: string;
  clid: string;
  source: string;
  destination: string;
  duration: number;
  durationText: string | null;
  size: string | null;
};

type RecordingResponse = {
  error?: number;
  reason?: string;
  total_records?: number;
  records?: number;
  data?: Array<Record<string, unknown>>;
};

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

function credenciaisVoip() {
  const dominio = String(process.env.VOIP_CLICK2CALL_DOMINIO || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const token = process.env.VOIP_CLICK2CALL_TOKEN;
  const key = process.env.VOIP_CLICK2CALL_KEY;
  if (!dominio || !token || !key) throw new Error('Credenciais da VoIP do Brasil nao configuradas.');
  return { dominio, token, key };
}

function recordingUrl(path = '', query?: URLSearchParams) {
  const { dominio, token, key } = credenciaisVoip();
  const base = `https://${dominio}/api/recording/${encodeURIComponent(token)}/${encodeURIComponent(key)}${path}`;
  return query?.size ? `${base}?${query.toString()}` : base;
}

/** Consulta paginada do relatorio oficial sem expor token ou key ao navegador. */
export async function listarGravacoesVoip(options: {
  dateIni: string;
  dateEnd: string;
  timeIni?: string;
  timeEnd?: string;
  limit?: number;
  maxPages?: number;
}) {
  const limit = Math.min(100, Math.max(1, options.limit || 100));
  const maxPages = Math.min(50, Math.max(1, options.maxPages || 20));
  const results: GravacaoVoip[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * limit;
    const query = new URLSearchParams({
      date_ini: options.dateIni,
      date_end: options.dateEnd,
      time_ini: options.timeIni || '00:00:00',
      time_end: options.timeEnd || '23:59:59',
      start: String(start),
      limit: String(limit),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(recordingUrl('', query), { method: 'GET', cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => ({})) as RecordingResponse;
      if (!response.ok || Number(payload.error || 0) !== 0) {
        throw new Error(String(payload.reason || `Erro HTTP ${response.status} ao consultar gravacoes.`));
      }
      const rows = Array.isArray(payload.data) ? payload.data : [];
      for (const row of rows) {
        const recordId = Number(row.record_id);
        if (!Number.isSafeInteger(recordId) || recordId <= 0) continue;
        results.push({
          recordId,
          calldate: String(row.calldate || ''),
          clid: String(row.clid || ''),
          source: String(row.source || ''),
          destination: String(row.destination || ''),
          duration: Math.max(0, Number(row.duration) || 0),
          durationText: row.duration2 ? String(row.duration2) : null,
          size: row.size ? String(row.size) : null,
        });
      }
      const total = Math.max(0, Number(payload.total_records) || 0);
      if (rows.length < limit || start + rows.length >= total) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  return results;
}

/**
 * O manual oferece POST por path e GET com id_record/is_download. Na conta
 * real, validada em 26/08/2026, o GET devolve audio/mpeg e o POST responde JSON.
 */
export async function baixarGravacaoVoip(recordId: number) {
  if (!Number.isSafeInteger(recordId) || recordId <= 0) throw new Error('ID de gravacao invalido.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const query = new URLSearchParams({ id_record: String(recordId), is_download: '1' });
    const response = await fetch(recordingUrl('', query), { method: 'GET', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`A operadora nao disponibilizou a gravacao (${response.status}).`);
    if (!String(response.headers.get('content-type') || '').toLowerCase().includes('audio/')) {
      throw new Error('A operadora respondeu sem um arquivo de audio valido.');
    }
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
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
  const deviceIdNumerico = Number(deviceId);
  if (!Number.isInteger(deviceIdNumerico) || deviceIdNumerico <= 0) {
    return { originada: false, motivo: 'Device ID da central invalido.' };
  }
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
        body: JSON.stringify({ device_id: deviceIdNumerico, src: options.src, dst: options.dst }),
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
  } catch (error: unknown) {
    const abortou = error instanceof Error && error.name === 'AbortError';
    return { originada: false, motivo: abortou ? 'Tempo esgotado ao falar com a central telefonica.' : 'Falha ao falar com a central telefonica.' };
  } finally {
    clearTimeout(timeout);
  }
}
