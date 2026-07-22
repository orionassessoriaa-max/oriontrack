import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { configureUazapiWebhook, uazapiFetch, uazapiInstanceName } from '@/lib/uazapi';

type TargetProfile = { id: string; nome: string | null; email: string | null; email_real: string | null; tipo_usuario: string };

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

async function targetForCommercial() {
  const { data: config, error: configError } = await supabaseAdmin.from('comercial_config').select('ia_sdr_profile_id').eq('id', 1).maybeSingle();
  if (configError && !/comercial_config|schema cache/i.test(configError.message)) throw configError;
  if (!config?.ia_sdr_profile_id) return null;
  const { data, error } = await supabaseAdmin.from('profiles').select('id,nome,email,email_real,tipo_usuario').eq('id', config.ia_sdr_profile_id).maybeSingle();
  if (error) throw error;
  return data as TargetProfile | null;
}

async function statusForInstance(instance: string) {
  try {
    const payload = await uazapiFetch('/instance/status', { method: 'GET' }, { instanceName: instance });
    const state = stateFromPayload(payload);
    if (state !== 'close') return state;
  } catch { /* fallback abaixo */ }
  try {
    const payload = await uazapiFetch('/instance/all', { method: 'GET' }, { useAdminAuth: true });
    const list = Array.isArray(payload) ? payload : payload?.data || payload?.instances || [];
    const found = list.find((item: any) => String(item?.name || item?.instanceName || item?.instance || item?.session || '') === instance);
    return found ? stateFromPayload(found) : 'close';
  } catch {
    return 'close';
  }
}

function profilePayload(profile: TargetProfile) {
  return { id: profile.id, nome: profile.nome, email: profile.email_real || profile.email, tipo_usuario: profile.tipo_usuario };
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  try {
    const target = await targetForCommercial();
    if (!target) return NextResponse.json({ configured: false, connected: false, state: 'close', targetProfile: null });
    const instance = uazapiInstanceName(target.id);
    const state = await statusForInstance(instance);
    return NextResponse.json({ configured: true, connected: state === 'open', state, instance, targetProfile: profilePayload(target) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel consultar o WhatsApp comercial.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.accepted_terms) return NextResponse.json({ error: 'Confirme o aceite para conectar o WhatsApp.' }, { status: 400 });
    const target = await targetForCommercial();
    if (!target) return NextResponse.json({ error: 'Configure primeiro o perfil da instância na aba IA.' }, { status: 409 });
    const instance = uazapiInstanceName(target.id);
    try {
      await uazapiFetch('/instance/init', { method: 'POST', body: JSON.stringify({ name: instance, instance, instanceName: instance }) }, { useAdminAuth: true });
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (!message.includes('already') && !message.includes('existe')) throw error;
    }
    await configureUazapiWebhook(instance);
    const payload = await uazapiFetch('/instance/connect', { method: 'POST', body: JSON.stringify({}) }, { instanceName: instance });
    return NextResponse.json({ success: true, configured: true, connected: false, state: 'connecting', instance, qrcode: qrFromPayload(payload), targetProfile: profilePayload(target) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Nao foi possivel iniciar a conexao do WhatsApp.' }, { status: 502 });
  }
}
