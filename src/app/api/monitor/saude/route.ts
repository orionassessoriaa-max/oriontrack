import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { uazapiFetch } from '@/lib/uazapi';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

/**
 * Monitor de saude do CRM.
 *
 * Todo problema desta semana foi descoberto por alguem reclamando: corretor sem
 * receber mensagem, audio picotado, IA que nao conectava, lead que parou de
 * cair. O banco chegou a ficar fora do ar e quem viu foi quem estava olhando
 * por acaso. Aqui o sistema passa a avisar antes do cliente.
 *
 * Roda pelo cron da VPS e so manda mensagem quando algo esta errado. Alerta
 * repetido do mesmo assunto espera a janela de silencio para nao virar ruido
 * que ninguem le.
 */
const JANELA_SILENCIO_MS = 6 * 60 * 60_000;
// Alerta tecnico vai so para quem conserta. Mandar para todos os admins faria a
// equipe receber aviso de banco lento sem ter o que fazer com a informacao, e
// aviso que nao gera acao vira aviso ignorado.
const PERFIL_DEV = process.env.MONITOR_ALERTA_PROFILE_ID || '7091766b-bc44-4ad7-b6c4-caa2461bf26b';
const HORARIO_COMERCIAL = { inicio: 8, fim: 20 };

type Alerta = { chave: string; texto: string };

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET || process.env.UAZAPI_GLOBAL_TOKEN;
  if (!esperado) return true;
  return request.headers.get('authorization') === `Bearer ${esperado}`;
}

function horaBrasilia() {
  return Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
}

function dentroDoExpediente() {
  const agora = new Date();
  const dia = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(agora);
  if (dia === 'Sun') return false;
  const hora = horaBrasilia();
  return hora >= HORARIO_COMERCIAL.inicio && hora < HORARIO_COMERCIAL.fim;
}

/** O banco lento e o primeiro sintoma de tudo o que trava depois. */
async function conferirBanco(): Promise<Alerta | null> {
  const inicio = Date.now();
  const { error } = await supabaseAdmin.from('leads').select('id', { count: 'exact', head: true });
  const ms = Date.now() - inicio;
  if (error) return { chave: 'banco_erro', texto: `Banco nao respondeu: ${String(error.message).slice(0, 80)}` };
  if (ms > 5000) return { chave: 'banco_lento', texto: `Banco lento: contagem simples levou ${(ms / 1000).toFixed(1)}s` };
  return null;
}

/**
 * Instancia conectada que parou de gravar mensagem e o caso do corretor que
 * jura ter respondido e nada aparece no CRM.
 */
async function conferirInstancias(): Promise<Alerta[]> {
  // Fora do expediente o silencio e normal: corretor nao trabalha de madrugada
  // nem no domingo, e alertar nessas horas so ensina a ignorar o aviso.
  if (!dentroDoExpediente()) return [];

  const alertas: Alerta[] = [];
  const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true }).catch(() => null);
  const instancias = Array.isArray(payload) ? payload : [];
  if (!instancias.length) return [{ chave: 'central_fora', texto: 'A central de WhatsApp nao respondeu a consulta de instancias.' }];

  async function contarPorInstancia(desde: string) {
    const mapa = new Map<string, number>();
    for (let inicio = 0; ; inicio += 1000) {
      const { data } = await supabaseAdmin
        .from('whatsapp_mensagens')
        .select('metadata->>instance')
        .gte('created_at', desde)
        .range(inicio, inicio + 999);
      if (!data?.length) break;
      for (const linha of data as any[]) {
        const nome = String(linha.instance || '');
        if (nome) mapa.set(nome, (mapa.get(nome) || 0) + 1);
      }
      if (data.length < 1000) break;
    }
    return mapa;
  }

  const naSemana = await contarPorInstancia(new Date(Date.now() - 7 * 86400_000).toISOString());
  const nasOitoHoras = await contarPorInstancia(new Date(Date.now() - 8 * 3600_000).toISOString());

  for (const instancia of instancias) {
    const nome = String(instancia?.name || '');
    if (!nome.startsWith('orion_') || nome.startsWith('orion_ai_')) continue;
    if (String(instancia?.status || '') !== 'connected') continue;
    // So conta como problema quem trabalha todo dia e emudeceu. Numero de uso
    // esporadico ficaria alertando para sempre sem nada de errado.
    if ((naSemana.get(nome) || 0) < 50) continue;
    if (nasOitoHoras.get(nome)) continue;

    alertas.push({
      chave: `sem_mensagem_${nome}`,
      texto: `${instancia?.profileName || nome}: conectada na central e com ${naSemana.get(nome)} mensagens na semana, mas nenhuma no CRM ha 8 horas.`,
    });
  }
  return alertas;
}

/** Lead que para de cair costuma ser automacao quebrada, nao mercado parado. */
async function conferirEntradaDeLeads(): Promise<Alerta | null> {
  if (!dentroDoExpediente()) return null;
  const desde = new Date(Date.now() - 4 * 3600_000).toISOString();
  const { count } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', desde);
  if ((count || 0) > 0) return null;
  return { chave: 'sem_lead', texto: 'Nenhum lead entrou no CRM nas ultimas 4 horas de expediente.' };
}

async function jaAvisouAgora(chave: string) {
  const { data } = await supabaseAdmin
    .from('audit_logs')
    .select('created_at')
    .eq('action', 'monitor.alerta')
    .contains('metadata', { chave })
    .gte('created_at', new Date(Date.now() - JANELA_SILENCIO_MS).toISOString())
    .limit(1);
  return Boolean(data?.length);
}

export async function GET(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });

  try {
    const [banco, instancias, leads] = await Promise.all([
      conferirBanco(),
      conferirInstancias().catch(() => [] as Alerta[]),
      conferirEntradaDeLeads().catch(() => null),
    ]);

    const todos = [banco, ...instancias, leads].filter(Boolean) as Alerta[];
    const novos: Alerta[] = [];
    for (const alerta of todos) {
      if (await jaAvisouAgora(alerta.chave)) continue;
      novos.push(alerta);
    }

    if (novos.length) {
      const { data: dev } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, tipo_usuario, telefone')
        .eq('id', PERFIL_DEV)
        .maybeSingle();
      const destinos = dev ? [dev] : [];

      await sendApoloWhatsApp({
        type: 'suporte',
        title: 'Alerta do CRM',
        message: ['Alerta do CRM:', '', ...novos.map((alerta) => `- ${alerta.texto}`)].join('\n'),
        profiles: destinos as any,
        respectPreferences: false,
      }).catch((erro) => console.error('[monitor] Falha ao avisar:', erro));

      for (const alerta of novos) {
        await supabaseAdmin.from('audit_logs').insert({
          action: 'monitor.alerta',
          entity_type: 'monitor',
          entity_id: null,
          metadata: { chave: alerta.chave, texto: alerta.texto },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      verificado_em: new Date().toISOString(),
      problemas: todos.map((alerta) => alerta.texto),
      avisados: novos.length,
    });
  } catch (erro: any) {
    return NextResponse.json({ error: erro?.message || 'Falha no monitor.' }, { status: 500 });
  }
}
