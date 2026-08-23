import { sendApoloWhatsApp } from '@/lib/apoloNotifications';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Aviso de "fulano criou uma tarefa para voce".
 *
 * Antes disso, criar tarefa no Apollo ou dentro do lead nao avisava ninguem: a
 * pessoa so descobria abrindo a tela. Quem recebe e o responsavel pela tarefa,
 * mais a copia de acompanhamento para o dev.
 */
const PERFIL_DEV = '7091766b-bc44-4ad7-b6c4-caa2461bf26b';

type PerfilAlvo = {
  id: string;
  nome: string | null;
  email?: string | null;
  tipo_usuario: string | null;
  telefone?: string | null;
};

async function carregarPerfis(ids: string[]) {
  const limpos = Array.from(new Set(ids.filter(Boolean)));
  if (!limpos.length) return [] as PerfilAlvo[];
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, tipo_usuario, telefone')
    .in('id', limpos);
  return (data || []) as PerfilAlvo[];
}

function formatarPrazo(valor?: string | null) {
  if (!valor) return 'sem prazo definido';
  const data = new Date(valor);
  if (!Number.isFinite(data.getTime())) return 'sem prazo definido';
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function notificarTarefaAtribuida(options: {
  titulo: string;
  descricao?: string | null;
  prazo?: string | null;
  responsavelProfileId?: string | null;
  autorProfileId?: string | null;
  origem: 'apollo' | 'lead';
  contexto?: string | null;
}) {
  const { responsavelProfileId, autorProfileId } = options;
  if (!responsavelProfileId) return [];

  const perfis = await carregarPerfis([responsavelProfileId, autorProfileId || '', PERFIL_DEV]);
  const responsavel = perfis.find((perfil) => perfil.id === responsavelProfileId);
  if (!responsavel) return [];

  const autor = perfis.find((perfil) => perfil.id === autorProfileId);
  const primeiroNomeAutor = String(autor?.nome || 'A coordenacao').trim().split(/\s+/)[0];
  const linhas = [
    `${primeiroNomeAutor} criou uma tarefa para voce.`,
    '',
    `*${options.titulo}*`,
    `Prazo: ${formatarPrazo(options.prazo)}`,
  ];
  if (options.contexto) linhas.push(`Onde: ${options.contexto}`);
  if (options.descricao) linhas.push('', options.descricao.slice(0, 400));
  linhas.push('', options.origem === 'apollo' ? 'Abra em /equipe/apollo/tarefas' : 'Abra em /tarefas');

  const alvos: PerfilAlvo[] = [responsavel];
  // O dev acompanha todas as atribuicoes, menos as dele mesmo, para nao
  // receber a mesma mensagem duas vezes.
  const dev = perfis.find((perfil) => perfil.id === PERFIL_DEV);
  if (dev && dev.id !== responsavel.id) alvos.push(dev);

  return sendApoloWhatsApp({
    type: 'demandas',
    title: 'Nova tarefa',
    message: linhas.join('\n'),
    profiles: alvos,
  });
}

function duracaoLegivel(inicio?: string | null, fim?: string | null) {
  const de = inicio ? new Date(inicio).getTime() : NaN;
  const ate = fim ? new Date(fim).getTime() : Date.now();
  if (!Number.isFinite(de) || !Number.isFinite(ate) || ate <= de) return null;
  const minutos = Math.round((ate - de) / 60000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 24) return resto ? `${horas}h${String(resto).padStart(2, '0')}` : `${horas}h`;
  const dias = Math.floor(horas / 24);
  const horasResto = horas % 24;
  return horasResto ? `${dias}d ${horasResto}h` : `${dias}d`;
}

/**
 * Quem criou a tarefa acompanha o andamento dela: recebe quando o responsavel
 * inicia e quando entrega, com o tempo que levou.
 */
export async function notificarAndamentoTarefa(options: {
  titulo: string;
  status: 'fazendo' | 'feito';
  criadorProfileId?: string | null;
  responsavelProfileId?: string | null;
  quemMoveuProfileId?: string | null;
  iniciadaEm?: string | null;
  concluidaEm?: string | null;
}) {
  const { criadorProfileId, quemMoveuProfileId } = options;
  // Quem move a propria tarefa que ele mesmo criou nao precisa se avisar.
  if (!criadorProfileId || criadorProfileId === quemMoveuProfileId) return [];

  const perfis = await carregarPerfis([criadorProfileId, quemMoveuProfileId || '', PERFIL_DEV]);
  const criador = perfis.find((perfil) => perfil.id === criadorProfileId);
  if (!criador) return [];

  const executor = perfis.find((perfil) => perfil.id === quemMoveuProfileId);
  const primeiroNome = String(executor?.nome || 'A equipe').trim().split(/\s+/)[0];
  const linhas =
    options.status === 'fazendo'
      ? [`${primeiroNome} iniciou a tarefa *${options.titulo}*.`]
      : [`${primeiroNome} concluiu a tarefa *${options.titulo}*.`];

  if (options.status === 'feito') {
    const duracao = duracaoLegivel(options.iniciadaEm, options.concluidaEm);
    if (duracao) linhas.push(`Duracao da entrega: ${duracao}.`);
    linhas.push('', 'Se algo precisar mudar, peca revisao em /equipe/apollo/tarefas.');
  }

  const alvos: PerfilAlvo[] = [criador];
  const dev = perfis.find((perfil) => perfil.id === PERFIL_DEV);
  if (dev && dev.id !== criador.id) alvos.push(dev);

  return sendApoloWhatsApp({
    type: 'demandas',
    title: options.status === 'fazendo' ? 'Tarefa iniciada' : 'Tarefa concluida',
    message: linhas.join('\n'),
    profiles: alvos,
  });
}

/** Revisao pedida por quem criou a tarefa, de volta para quem executou. */
export async function notificarRevisaoTarefa(options: {
  tituloTarefa: string;
  tituloRevisao: string;
  comentario?: string | null;
  responsavelProfileId?: string | null;
  autorProfileId?: string | null;
}) {
  if (!options.responsavelProfileId) return [];
  const perfis = await carregarPerfis([options.responsavelProfileId, options.autorProfileId || '', PERFIL_DEV]);
  const responsavel = perfis.find((perfil) => perfil.id === options.responsavelProfileId);
  if (!responsavel) return [];

  const autor = perfis.find((perfil) => perfil.id === options.autorProfileId);
  const primeiroNome = String(autor?.nome || 'Quem pediu a tarefa').trim().split(/\s+/)[0];
  const linhas = [
    `${primeiroNome} pediu revisao da tarefa *${options.tituloTarefa}*.`,
    '',
    `*${options.tituloRevisao}*`,
  ];
  if (options.comentario) linhas.push(options.comentario.slice(0, 400));

  const alvos: PerfilAlvo[] = [responsavel];
  const dev = perfis.find((perfil) => perfil.id === PERFIL_DEV);
  if (dev && dev.id !== responsavel.id) alvos.push(dev);

  return sendApoloWhatsApp({
    type: 'demandas',
    title: 'Revisao pedida',
    message: linhas.join('\n'),
    profiles: alvos,
  });
}
