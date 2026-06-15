import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';
import { rateLimit, writeAuditLog } from '@/lib/api/security';

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, email_real, nome, tipo_usuario, corretor_id, status, is_admin_master')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.tipo_usuario !== 'admin') {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user, profile };
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'admin:leads:create', { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const guard = await requireAdmin(request);
  if ('error' in guard) return guard.error;

  try {
    const body = await request.json();
    const corretorId = String(body.corretor_id || '').trim();
    const nome = String(body.nome || '').trim();
    const telefone = String(body.telefone || '').trim();

    if (!corretorId) {
      return NextResponse.json({ error: 'Selecione um corretor.' }, { status: 400 });
    }

    if (!nome || !telefone) {
      return NextResponse.json({ error: 'Informe nome e telefone do lead.' }, { status: 400 });
    }

    const { data: corretor } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('id', corretorId)
      .maybeSingle();

    if (!corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert([{
        corretor_id: corretorId,
        nome,
        telefone,
        idades: String(body.idades || ''),
        possui_cnpj: String(body.possui_cnpj || 'Nao informado'),
        cnpj: body.cnpj ? String(body.cnpj) : null,
        tem_plano_ativo: String(body.tem_plano_ativo || 'Nao informado'),
        plano_atual: String(body.plano_atual || ''),
        custo_plano_atual: String(body.custo_plano_atual || ''),
        investimento: String(body.investimento || ''),
        cidade: String(body.cidade || ''),
        operadora: body.operadora ? String(body.operadora) : null,
        status: normalizeLeadStatus(body.status || 'Aguardando atendimento'),
        data_entrada: body.data_entrada ? new Date(body.data_entrada).toISOString() : new Date().toISOString(),
      }])
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await writeAuditLog(request, guard.profile as any, {
      action: 'lead.create_admin',
      entity_type: 'lead',
      entity_id: data.id,
      metadata: { corretor_id: corretorId, nome },
    });

    return NextResponse.json({ ok: true, lead_id: data.id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro ao salvar lead.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const limited = rateLimit(request, 'admin:leads:delete-bulk', { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const guard = await requireAdmin(request);
  if ('error' in guard) return guard.error;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== 'DELETE_ALL_LEADS') {
      return NextResponse.json({ error: 'Confirmacao invalida para remover todos os leads.' }, { status: 400 });
    }

    const corretorId = String(body.corretor_id || '').trim();
    const requestedCorretorIds = Array.isArray(body.corretor_ids)
      ? body.corretor_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const corretorIds = Array.from(new Set(corretorId ? [corretorId] : requestedCorretorIds));
    const concessionariaNome = String(body.concessionaria || '').trim();
    let scopeNome = concessionariaNome;

    if (corretorIds.length > 0) {
      const { data: corretores, error: corretorError } = await supabaseAdmin
        .from('corretores')
        .select('id, nome, nome_empresa')
        .in('id', corretorIds);

      if (corretorError) {
        return NextResponse.json({ error: corretorError.message }, { status: 500 });
      }

      if (!corretores || corretores.length !== corretorIds.length) {
        return NextResponse.json({ error: 'Concessionaria nao encontrada.' }, { status: 404 });
      }

      scopeNome = scopeNome || corretores[0]?.nome_empresa || corretores[0]?.nome || '';
    }

    let countQuery = supabaseAdmin
      .from('leads')
      .select('id', { count: 'exact', head: true });

    if (corretorIds.length > 0) countQuery = countQuery.in('corretor_id', corretorIds);

    const { count, error: countError } = await countQuery;

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    let deleteQuery = supabaseAdmin
      .from('leads')
      .delete()
      .not('id', 'is', null);

    if (corretorIds.length > 0) deleteQuery = deleteQuery.in('corretor_id', corretorIds);

    const { error } = await deleteQuery;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile as any, {
      action: corretorIds.length > 0 ? 'lead.bulk_delete_by_concessionaria' : 'lead.bulk_delete_all',
      entity_type: 'leads',
      entity_id: corretorIds.length > 0 ? corretorIds.join(',') : 'all',
      metadata: {
        deleted_count: count || 0,
        corretor_ids: corretorIds,
        concessionaria: scopeNome || null,
      },
    });

    return NextResponse.json({ success: true, deleted: count || 0, concessionaria: scopeNome || null });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro ao remover todos os leads.' }, { status: 500 });
  }
}
