import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * O Escritorio e enfeite: tres agentes desenhados numa sala e uma caixa de
 * correio. Nenhuma consulta daqui pode custar caro nem derrubar a pagina, por
 * isso cada bloco tem limit e cada falha cai num agente paradinho em vez de 500.
 */
const JANELA_ATIVA_MS = 15 * 60 * 1000;
const CARTAS_LIMITE = 20;
const NAO_LIDAS_LIMITE = 500;

type AgenteAline = {
  id: 'aline';
  nome: 'Aline';
  papel: 'IA de atendimento';
  ativa: boolean;
  acao: string | null;
  corretora: string | null;
  em: string | null;
};

type AgenteApolo = {
  id: 'apolo';
  nome: 'Apolo';
  papel: 'entrega ao corretor';
  ativa: boolean;
  acao: string | null;
  corretor: string | null;
  em: string | null;
};

type AgenteCarteiro = {
  id: 'carteiro';
  nome: 'Carteiro';
  papel: 'avisos';
  ativa: boolean;
  naoLidas: number;
  em: string | null;
};

type Carta = {
  id: string;
  titulo: string;
  mensagem: string;
  para: string | null;
  em: string;
  lida: boolean;
};

const ALINE_PARADA: AgenteAline = {
  id: 'aline',
  nome: 'Aline',
  papel: 'IA de atendimento',
  ativa: false,
  acao: null,
  corretora: null,
  em: null,
};

const APOLO_PARADO: AgenteApolo = {
  id: 'apolo',
  nome: 'Apolo',
  papel: 'entrega ao corretor',
  ativa: false,
  acao: null,
  corretor: null,
  em: null,
};

const CARTEIRO_PARADO: AgenteCarteiro = {
  id: 'carteiro',
  nome: 'Carteiro',
  papel: 'avisos',
  ativa: false,
  naoLidas: 0,
  em: null,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recente(valor: unknown) {
  if (!valor) return false;
  const quando = new Date(String(valor)).getTime();
  if (!Number.isFinite(quando)) return false;
  return Date.now() - quando <= JANELA_ATIVA_MS;
}

function textoOuNull(valor: unknown) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}

function primeiroNome(valor: unknown) {
  return textoOuNull(String(valor ?? '').trim().split(/\s+/)[0]);
}

function aviso(onde: string, erro: unknown) {
  console.error('[escritorio]', onde, erro instanceof Error ? erro.message : erro);
}

/** Aline = a IA que fala com o lead. Uma linha, a mais recente, mais o nome da corretora. */
async function carregarAline(): Promise<AgenteAline> {
  try {
    const { data: sessao, error } = await supabaseAdmin
      .from('lead_ai_sessions')
      .select('id,corretor_id,last_ai_message_at')
      .order('last_ai_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      aviso('aline_sessao', error.message);
      return ALINE_PARADA;
    }
    if (!sessao) return ALINE_PARADA;

    let corretora: string | null = null;
    if (sessao.corretor_id) {
      const { data: corretor, error: corretorError } = await supabaseAdmin
        .from('corretores')
        .select('id,nome_empresa')
        .eq('id', sessao.corretor_id)
        .limit(1)
        .maybeSingle();

      if (corretorError) aviso('aline_corretora', corretorError.message);
      else corretora = textoOuNull(corretor?.nome_empresa);
    }

    return {
      ...ALINE_PARADA,
      ativa: recente(sessao.last_ai_message_at),
      acao: corretora ? `estou em ${corretora}` : null,
      corretora,
      em: sessao.last_ai_message_at ? String(sessao.last_ai_message_at) : null,
    };
  } catch (erro) {
    aviso('aline', erro);
    return ALINE_PARADA;
  }
}

/** Apolo = o entregador. A ultima notificacao de lead novo diz para quem ele esta levando. */
async function carregarApolo(): Promise<AgenteApolo> {
  try {
    const { data: entrega, error } = await supabaseAdmin
      .from('notificacoes')
      .select('id,titulo,destinatario_profile_id,created_at')
      .ilike('titulo', 'Novo lead%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      aviso('apolo_notificacao', error.message);
      return APOLO_PARADO;
    }
    if (!entrega) return APOLO_PARADO;

    let corretor: string | null = null;
    if (entrega.destinatario_profile_id) {
      const { data: perfil, error: perfilError } = await supabaseAdmin
        .from('profiles')
        .select('id,nome')
        .eq('id', entrega.destinatario_profile_id)
        .limit(1)
        .maybeSingle();

      if (perfilError) aviso('apolo_corretor', perfilError.message);
      else corretor = primeiroNome(perfil?.nome);
    }

    return {
      ...APOLO_PARADO,
      ativa: recente(entrega.created_at),
      acao: corretor ? `envie para ${corretor}` : null,
      corretor,
      em: entrega.created_at ? String(entrega.created_at) : null,
    };
  } catch (erro) {
    aviso('apolo', erro);
    return APOLO_PARADO;
  }
}

/** Carteiro = a caixa de correio do usuario logado. Nunca mostra carta de outro. */
async function carregarCarteiro(profileId: string, nomeDoDono: string | null) {
  try {
    const [contagem, cartasResult] = await Promise.all([
      supabaseAdmin
        .from('notificacoes')
        .select('id', { count: 'exact', head: true })
        .eq('destinatario_profile_id', profileId)
        .eq('lida', false)
        .limit(NAO_LIDAS_LIMITE),
      supabaseAdmin
        .from('notificacoes')
        .select('id,titulo,mensagem,lida,created_at')
        .eq('destinatario_profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(CARTAS_LIMITE),
    ]);

    if (contagem.error) aviso('carteiro_nao_lidas', contagem.error.message);
    if (cartasResult.error) {
      aviso('carteiro_cartas', cartasResult.error.message);
      return { carteiro: CARTEIRO_PARADO, cartas: [] as Carta[] };
    }

    const cartas: Carta[] = (cartasResult.data || []).map((linha) => ({
      id: String(linha.id),
      titulo: String(linha.titulo || ''),
      mensagem: String(linha.mensagem || ''),
      // Todas as linhas sao do proprio dono da caixa, o nome ja veio no guard.
      para: nomeDoDono,
      em: String(linha.created_at || ''),
      lida: linha.lida === true,
    }));

    const carteiro: AgenteCarteiro = {
      ...CARTEIRO_PARADO,
      ativa: true,
      naoLidas: Number(contagem.count || 0),
      em: cartas[0]?.em || null,
    };

    return { carteiro, cartas };
  } catch (erro) {
    aviso('carteiro', erro);
    return { carteiro: CARTEIRO_PARADO, cartas: [] as Carta[] };
  }
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request);
  if ('error' in guard) return guard.error;

  const [aline, apolo, correio] = await Promise.all([
    carregarAline(),
    carregarApolo(),
    carregarCarteiro(guard.profile.id, textoOuNull(guard.profile.nome)),
  ]);

  return NextResponse.json({
    agentes: [aline, apolo, correio.carteiro],
    cartas: correio.cartas,
  });
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request);
  if ('error' in guard) return guard.error;

  try {
    const body = await request.json().catch(() => null);
    const id = String((body as { id?: unknown } | null)?.id ?? '').trim();

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Carta invalida.' }, { status: 400 });
    }

    // O eq no destinatario e o que impede marcar a carta de outra pessoa.
    const { data, error } = await supabaseAdmin
      .from('notificacoes')
      .update({ lida: true })
      .eq('id', id)
      .eq('destinatario_profile_id', guard.profile.id)
      .select('id')
      .limit(1);

    if (error) {
      aviso('marcar_lida', error.message);
      return NextResponse.json({ error: 'Nao deu para marcar a carta como lida.' }, { status: 500 });
    }

    if (!data?.length) {
      return NextResponse.json({ error: 'Carta nao encontrada na sua caixa.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id });
  } catch (erro) {
    aviso('post', erro);
    return NextResponse.json({ error: 'Nao deu para marcar a carta como lida.' }, { status: 500 });
  }
}
