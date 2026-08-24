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
  const leadId = String(body.lead_id || '').trim();
  const responsavelId = String(body.responsavel_profile_id || '').trim();
  if (!tarefaId && !(leadId && responsavelId)) {
    return NextResponse.json({ error: 'Informe a tarefa ou o lead e o responsavel.' }, { status: 400 });
  }

  // A tela grava a tarefa com a chave publica e nao recebe o id de volta: pedir
  // a linha de volta esbarra na politica de leitura. Entao aqui achamos a
  // tarefa recem-criada pelo par lead + responsavel.
  let consulta = supabaseAdmin
    .from('lead_tarefas')
    .select('id, titulo, descricao, vencimento, responsavel_profile_id, lead_id, corretor_id')
    .order('created_at', { ascending: false })
    .limit(1);
  consulta = tarefaId
    ? consulta.eq('id', tarefaId)
    : consulta
        .eq('lead_id', leadId)
        .eq('responsavel_profile_id', responsavelId)
        .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString());

  const { data: encontradas, error } = await consulta;
  const tarefa = encontradas?.[0];
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
