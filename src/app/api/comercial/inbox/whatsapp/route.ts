import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { configureUazapiWebhook, ensureUazapiInstance, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';
import { writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

function stateFromPayload(payload: any): 'open' | 'connecting' | 'close' {
  const value = String(payload?.instance?.status || payload?.status?.status || payload?.status || payload?.state || '').toLowerCase();
  const connected = payload?.connected === true || payload?.loggedIn === true || payload?.instance?.connected === true || payload?.instance?.loggedIn === true || Boolean(payload?.jid || payload?.instance?.jid || payload?.instance?.owner);
  if (value.includes('disconnect') || value.includes('logout') || value.includes('close') || value.includes('loggedout')) return 'close';
  if (connected || ['open', 'connected', 'conectado', 'loggedin'].includes(value)) return 'open';
  if (value.includes('connect') || value.includes('qr') || value.includes('pair')) return 'connecting';
  return 'close';
}

function qrFromPayload(payload: any): string | null {
  return payload?.qrcode || payload?.base64 || payload?.instance?.qrcode || payload?.instance?.base64 || payload?.data?.qrcode || payload?.data?.base64 || null;
}

type StatusInstancia = { state: 'open' | 'connecting' | 'close'; numero: string | null; perfil: string | null };

type ItemUazapi = Record<string, unknown> & { instance?: Record<string, unknown> };

function donoDaInstancia(item?: ItemUazapi | null) {
  const bruto = String(item?.owner || item?.jid || item?.instance?.owner || '').replace(/@.*$/, '').replace(/\D/g, '');
  return bruto || null;
}

/**
 * Alem do estado, devolve o numero e o nome do WhatsApp conectado. Sem isso a
 * tela dizia so "WhatsApp conectado", e ninguem percebia quando a instancia de
 * uma pessoa estava com o chip de outra.
 */
async function statusForInstance(instance: string): Promise<StatusInstancia> {
  let resultado: StatusInstancia = { state: 'close', numero: null, perfil: null };
  try {
    const payload = await uazapiFetch('/instance/status', { method: 'GET' }, { instanceName: instance });
    const state = stateFromPayload(payload);
    const dados = (payload?.instance || payload) as ItemUazapi;
    resultado = { state, numero: donoDaInstancia(dados), perfil: String(dados?.profileName || '') || null };
    if (state !== 'close' && resultado.numero) return resultado;
  } catch { /* fallback abaixo */ }
  try {
    const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
    const list = Array.isArray(payload) ? payload : payload?.data || payload?.instances || [];
    const matches = (list as ItemUazapi[]).filter((item) => String(item?.name || item?.instanceName || item?.instance || item?.session || '').toLowerCase() === instance.toLowerCase());
    const found = matches.find((item) => stateFromPayload(item) === 'open') || matches[0];
    if (found) return { state: stateFromPayload(found), numero: donoDaInstancia(found), perfil: String(found?.profileName || '') || null };
    return resultado;
  } catch {
    return resultado;
  }
}

/** Quem do time esta conectado e com qual numero. So a coordenacao enxerga. */
async function conexoesDoTime() {
  const { data: membros } = await supabaseAdmin
    .from('comercial_membros')
    .select('profile_id, papel, ativo')
    .eq('ativo', true);
  const ids = (membros || []).map((membro) => membro.profile_id);
  if (!ids.length) return [];
  const { data: perfis } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, telefone')
    .in('id', ids);
  type PerfilResumo = { id: string; nome: string | null; telefone: string | null };
  const porId = new Map(((perfis || []) as PerfilResumo[]).map((perfil) => [perfil.id, perfil]));

  return Promise.all((membros || []).map(async (membro: { profile_id: string; papel: string }) => {
    const instancia = uazapiInstanceName(membro.profile_id);
    const status = await statusForInstance(instancia);
    const perfil = porId.get(membro.profile_id);
    return {
      profile_id: membro.profile_id,
      nome: perfil?.nome || 'Integrante Kripto',
      papel: membro.papel,
      telefone_cadastrado: perfil?.telefone || null,
      instancia,
      state: status.state,
      numero: status.numero,
      perfil_whatsapp: status.perfil,
    };
  }));
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  try {
    const instance = uazapiInstanceName(guard.profile.id);
    const status = await statusForInstance(instance);
    const podeVerTime = guard.isDevOps || guard.commercialRole === 'coordenador';
    return NextResponse.json({
      configured: true,
      connected: status.state === 'open',
      state: status.state,
      instance,
      numero: status.numero,
      perfil_whatsapp: status.perfil,
      targetProfile: { id: guard.profile.id, nome: guard.profile.nome || 'Integrante Kripto' },
      equipe: podeVerTime ? await conexoesDoTime() : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel consultar o WhatsApp comercial.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.accepted_terms) return NextResponse.json({ error: 'Confirme o aceite para conectar o WhatsApp.' }, { status: 400 });
    const instance = uazapiInstanceName(guard.profile.id);
    await writeAuditLog(request, guard.profile, {
      action: 'commercial.whatsapp.terms.accept',
      entity_type: 'profile',
      entity_id: guard.profile.id,
      metadata: {
        terms_version: body.terms_version || 'commercial-inbox-v2',
        commercial_role: guard.commercialRole,
      },
    });
    await ensureUazapiInstance(instance);
    await configureUazapiWebhook(instance);
    const payload = await uazapiFetch('/instance/connect', { method: 'POST', body: JSON.stringify({}) }, { instanceName: instance });
    return NextResponse.json({
      success: true,
      configured: true,
      connected: false,
      state: 'connecting',
      instance,
      qrcode: qrFromPayload(payload),
      targetProfile: { id: guard.profile.id, nome: guard.profile.nome || 'Integrante Kripto' },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel iniciar a conexao do WhatsApp.' }, { status: 502 });
  }
}
