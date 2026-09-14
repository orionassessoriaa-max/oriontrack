import { NextResponse } from 'next/server';
import { requireApiUser, rateLimit, writeAuditLog } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isDevOpsManagerProfile } from '@/lib/users';
import { notificarTarefaAtribuida } from '@/lib/taskNotifications';

const CATEGORIES: Record<string, string> = {
  funil_crm: 'Funil e CRM',
  trafego: 'Tráfego',
  integracao: 'Integração',
  relatorio: 'Relatório',
  acesso: 'Acesso',
  outro: 'Outra demanda',
};
const PRIORITIES = new Set(['baixa', 'normal', 'alta', 'urgente']);

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ['admin', 'gestor_trafego']);
  if ('error' in guard) return guard.error;
  const limited = rateLimit(request, 'apollo-manager-demand', { limit: 20, windowMs: 60 * 60_000, key: guard.profile.id });
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const category = String(body.categoria || '').trim();
    const title = String(body.titulo || '').trim();
    const description = String(body.descricao || '').trim();
    const priority = String(body.prioridade || 'normal').trim();
    if (!CATEGORIES[category] || title.length < 2 || title.length > 180 || description.length > 4000 || !PRIORITIES.has(priority)) {
      return NextResponse.json({ error: 'Preencha a categoria, o título e os detalhes da demanda corretamente.' }, { status: 400 });
    }

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, is_admin_master')
      .in('status', ['active', 'ativo', 'Ativo'])
      .or('email.eq.ewerttonherculano@gmail.com,email_real.eq.ewerttonherculano@gmail.com');
    if (profileError) throw profileError;
    const ewertton = (profiles || []).find((profile) => isDevOpsManagerProfile(profile));
    if (!ewertton) return NextResponse.json({ error: 'Responsável DevOps não está disponível para receber demandas.' }, { status: 503 });

    const prazo = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
    const fullDescription = [
      `Categoria: ${CATEGORIES[category]}`,
      `Solicitado por: ${guard.profile.nome || 'Gestor de tráfego'}`,
      '',
      description || 'Sem detalhes adicionais.',
    ].join('\n');
    const { data: task, error } = await supabaseAdmin
      .from('apollo_tasks')
      .insert({
        equipe: 'apollo',
        titulo: `[${CATEGORIES[category]}] ${title}`,
        descricao: fullDescription,
        prazo,
        status: 'a_fazer',
        prioridade: priority,
        responsavel_profile_id: ewertton.id,
        criado_por_profile_id: guard.profile.id,
        predefinicao: 'demanda_gestor',
      })
      .select('id, titulo, prazo, prioridade')
      .single();
    if (error) throw error;

    void notificarTarefaAtribuida({
      titulo: task.titulo,
      descricao: fullDescription,
      prazo,
      responsavelProfileId: ewertton.id,
      autorProfileId: guard.profile.id,
      origem: 'apollo',
    }).catch((notificationError) => console.error('[manager demand] notification failed:', notificationError));

    await writeAuditLog(request, guard.profile, {
      action: 'apollo.manager_demand.create',
      entity_type: 'apollo_task',
      entity_id: task.id,
      metadata: { categoria: category, prioridade: priority, responsavel_profile_id: ewertton.id },
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível registrar a demanda.' }, { status: 500 });
  }
}
