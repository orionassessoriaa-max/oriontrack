import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notificarTarefaAtribuida } from '@/lib/taskNotifications';

/**
 * Aviso de tarefa criada dentro do lead.
 *
 * A tarefa e gravada pelo navegador com a chave publica, e o WhatsApp so pode
 * sair do servidor. Por isso a tela grava e chama esta rota com o id: aqui a
 * tarefa e relida do banco, entao o texto do aviso vem do que foi salvo e nao
 * do que o navegador mandou.
 */
export async function POST(request: Request) {
  const guard = await requireApiUser(request);
  if ('error' in guard) return guard.error;

  const body = await request.json().catch(() => ({}));
  const tarefaId = String(body.tarefa_id || '').trim();
  if (!tarefaId) return NextResponse.json({ error: 'Informe a tarefa.' }, { status: 400 });

  const { data: tarefa, error } = await supabaseAdmin
    .from('lead_tarefas')
    .select('id, titulo, descricao, vencimento, responsavel_profile_id, lead_id, corretor_id')
    .eq('id', tarefaId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!tarefa) return NextResponse.json({ error: 'Tarefa nao encontrada.' }, { status: 404 });

  // Sem responsavel nao existe para quem avisar, e avisar a si mesmo so gera
  // ruido para quem acabou de criar a tarefa.
  if (!tarefa.responsavel_profile_id || tarefa.responsavel_profile_id === guard.profile.id) {
    return NextResponse.json({ enviado: false, motivo: 'Sem responsavel diferente de quem criou.' });
  }

  let contexto: string | null = null;
  if (tarefa.lead_id) {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('nome')
      .eq('id', tarefa.lead_id)
      .maybeSingle();
    if (lead?.nome) contexto = `Lead ${lead.nome}`;
  }

  const resultado = await notificarTarefaAtribuida({
    titulo: tarefa.titulo,
    descricao: tarefa.descricao,
    prazo: tarefa.vencimento,
    responsavelProfileId: tarefa.responsavel_profile_id,
    autorProfileId: guard.profile.id,
    origem: 'lead',
    contexto,
  });

  return NextResponse.json({ enviado: true, resultado });
}
