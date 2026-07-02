import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { FERRAMENTA_CATALOG, FerramentaStatus, isFerramentaStatus } from '@/lib/ferramentas';

type ToolConfigRow = {
  ferramenta_key: string;
  status: FerramentaStatus;
  observacoes: string | null;
};

async function resolveCorretoraForProfile(profile: { corretor_id: string | null; tipo_usuario: string }) {
  if (!profile.corretor_id) return null;

  const { data: corretor, error: corretorError } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('id', profile.corretor_id)
    .maybeSingle();

  if (corretorError) throw corretorError;
  const brokerageName = String(corretor?.nome_empresa || '').trim();
  if (!brokerageName) return null;

  const { data: corretora, error: corretoraError } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome, status')
    .ilike('nome', brokerageName)
    .maybeSingle();

  if (corretoraError) throw corretoraError;
  return corretora || null;
}

export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request, ['admin', 'corretor', 'corretor_admin', 'corretor_membro']);
    if ('error' in guard) return guard.error;

    const isAdmin = guard.profile.tipo_usuario === 'admin';
    const corretora = isAdmin ? null : await resolveCorretoraForProfile(guard.profile);
    const searchParams = new URL(request.url).searchParams;
    const requestedCorretoraId = searchParams.get('corretoraId');
    const configCorretoraId = isAdmin ? requestedCorretoraId : corretora?.id;

    let configs: ToolConfigRow[] = [];
    if (configCorretoraId) {
      const { data, error } = await supabaseAdmin
        .from('corretora_ferramentas')
        .select('ferramenta_key, status, observacoes')
        .eq('corretora_id', configCorretoraId);

      if (error) throw error;
      configs = (data || []).filter((row): row is ToolConfigRow => isFerramentaStatus(row.status));
    }

    const configByKey = new Map(configs.map((config) => [config.ferramenta_key, config]));
    const tools = FERRAMENTA_CATALOG.map((tool) => {
      const config = configByKey.get(tool.key);
      const status = config?.status || 'disponivel';
      return {
        ...tool,
        status,
        observacoes: config?.observacoes || null,
      };
    }).filter((tool) => isAdmin || tool.status !== 'oculto');

    return NextResponse.json({
      corretora,
      tools,
    });
  } catch (error: any) {
    console.error('[api_ferramentas] GET error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erro ao carregar ferramentas.' },
      { status: 500 }
    );
  }
}
