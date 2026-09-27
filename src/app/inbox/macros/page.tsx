'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Layers3,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  Search,
  Tag,
  Trash2,
  UserRound,
} from 'lucide-react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import type { KanbanStage } from '@/lib/kanbanStages';
import type { UnityMacro } from '@/lib/unityMacros';
import styles from './page.module.css';

type UnityLabel = { id: string; name: string; color: string };
type Draft = Omit<UnityMacro, 'id'>;

const EMPTY_DRAFT: Draft = {
  title: '',
  text: '',
  actions: { closeConversation: false, status: null, labelIds: [] },
};

function normalizedCompany(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

export default function UnityMacrosPage() {
  const { profile } = useAuth();
  const [macros, setMacros] = useState<UnityMacro[]>([]);
  const [labels, setLabels] = useState<UnityLabel[]>([]);
  const [stages, setStages] = useState<KanbanStage[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const isUnity = normalizedCompany(profile?.nome_empresa) === 'UNITY SAUDE';
  const profileId = profile?.id || '';
  const corretorId = profile?.corretor_id || '';

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  async function requestHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getToken()}`,
      ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
    };
  }

  useEffect(() => {
    if (!profileId || !isUnity) return;
    let active = true;

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const nextHeaders = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token || ''}`,
          'x-orion-view-profile-id': profileId,
        };
        const [configResponse, stagesResponse] = await Promise.all([
          fetch('/api/inbox/unity-config', { cache: 'no-store', headers: nextHeaders }),
          fetch(`/api/crm/stages?corretor_id=${encodeURIComponent(corretorId)}`, { cache: 'no-store', headers: nextHeaders }),
        ]);
        const [config, stagePayload] = await Promise.all([
          configResponse.json().catch(() => ({})),
          stagesResponse.json().catch(() => ({})),
        ]);
        if (!configResponse.ok) throw new Error(config.error || 'Nao foi possivel carregar suas macros.');
        if (!active) return;
        setMacros(Array.isArray(config.macros) ? config.macros : []);
        setLabels(Array.isArray(config.labels) ? config.labels : []);
        setStages(stagesResponse.ok && Array.isArray(stagePayload.stages) ? stagePayload.stages : []);
      } catch (error: unknown) {
        if (active) setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Nao foi possivel carregar suas macros.' });
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [corretorId, isUnity, profileId]);

  const query = search.trim().toLocaleLowerCase('pt-BR');
  const filteredMacros = query
    ? macros.filter((macro) => `${macro.title} ${macro.text}`.toLocaleLowerCase('pt-BR').includes(query))
    : macros;

  function newMacro() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setNotice(null);
  }

  function editMacro(macro: UnityMacro) {
    setEditingId(macro.id);
    setDraft({
      title: macro.title,
      text: macro.text,
      actions: {
        closeConversation: macro.actions.closeConversation,
        status: macro.actions.status,
        labelIds: [...macro.actions.labelIds],
      },
    });
    setNotice(null);
  }

  async function persist(nextMacros: UnityMacro[]) {
    const response = await fetch('/api/inbox/unity-config', {
      method: 'PATCH',
      headers: await requestHeaders(),
      body: JSON.stringify({ macros: nextMacros }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Nao foi possivel salvar a macro.');
    return Array.isArray(payload.macros) ? payload.macros as UnityMacro[] : nextMacros;
  }

  async function saveMacro() {
    const title = draft.title.trim();
    const text = draft.text.trim();
    if (!title || !text) {
      setNotice({ tone: 'error', text: 'Informe o nome e a mensagem da macro.' });
      return;
    }
    if (macros.some((macro) => macro.id !== editingId && macro.title.toLocaleLowerCase('pt-BR') === title.toLocaleLowerCase('pt-BR'))) {
      setNotice({ tone: 'error', text: 'Voce ja possui uma macro com esse nome.' });
      return;
    }

    const item: UnityMacro = {
      id: editingId || crypto.randomUUID(),
      title,
      text,
      actions: draft.actions,
    };
    const next = editingId
      ? macros.map((macro) => macro.id === editingId ? item : macro)
      : [...macros, item];

    setSaving(true);
    try {
      const saved = await persist(next);
      setMacros(saved);
      setEditingId(item.id);
      setNotice({ tone: 'success', text: editingId ? 'Macro atualizada.' : 'Macro criada para o seu acesso.' });
    } catch (error: unknown) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Nao foi possivel salvar a macro.' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteMacro(macro: UnityMacro) {
    if (!window.confirm(`Apagar a macro "${macro.title}"?`)) return;
    setSaving(true);
    try {
      const saved = await persist(macros.filter((item) => item.id !== macro.id));
      setMacros(saved);
      if (editingId === macro.id) newMacro();
      setNotice({ tone: 'success', text: 'Macro apagada.' });
    } catch (error: unknown) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Nao foi possivel apagar a macro.' });
    } finally {
      setSaving(false);
    }
  }

  function toggleLabel(labelId: string) {
    setDraft((current) => ({
      ...current,
      actions: {
        ...current.actions,
        labelIds: current.actions.labelIds.includes(labelId)
          ? current.actions.labelIds.filter((id) => id !== labelId)
          : [...current.actions.labelIds, labelId],
      },
    }));
  }

  if (profile?.id && !isUnity) {
    return (
      <InternalLayout>
        <div className={styles.denied}>
          <MessageSquareText size={28} />
          <h1>Macros exclusivas da Unity</h1>
          <p>Este recurso nao esta habilitado para esta operacao.</p>
          <Link href="/inbox">Voltar ao Inbox</Link>
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <Link className={styles.back} href="/inbox"><ArrowLeft size={15} /> Inbox</Link>
            <p className={styles.eyebrow}>Unity / automacoes pessoais</p>
            <h1>Macros do atendimento</h1>
            <p>Crie mensagens que executam o proximo passo do atendimento sem misturar configuracoes entre vendedores.</p>
          </div>
          <div className={styles.identityCard}>
            <UserRound size={20} />
            <div><strong>Uso individual</strong><span>Somente {profile?.nome || 'voce'} visualiza estas macros</span></div>
          </div>
        </header>

        {notice && (
          <div className={`${styles.notice} ${notice.tone === 'success' ? styles.success : styles.error}`}>
            {notice.tone === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
            {notice.text}
          </div>
        )}

        <section className={styles.workspace}>
          <aside className={styles.library}>
            <div className={styles.libraryHeader}>
              <div><span>Minha biblioteca</span><strong>{macros.length} {macros.length === 1 ? 'macro' : 'macros'}</strong></div>
              <button type="button" onClick={newMacro}><Plus size={15} /> Nova</button>
            </div>
            <label className={styles.search}>
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar macro" />
            </label>
            <div className={styles.macroList}>
              {loading ? (
                <div className={styles.empty}><Loader2 className={styles.spin} size={24} />Carregando macros</div>
              ) : filteredMacros.length ? filteredMacros.map((macro) => (
                <button key={macro.id} type="button" onClick={() => editMacro(macro)} className={`${styles.macroCard} ${editingId === macro.id ? styles.macroCardActive : ''}`}>
                  <span className={styles.macroIcon}><MessageSquareText size={17} /></span>
                  <span className={styles.macroBody}>
                    <strong>{macro.title}</strong>
                    <small>{macro.text}</small>
                    <span className={styles.actionSummary}>
                      {macro.actions.closeConversation && <i><Archive size={11} /> encerra</i>}
                      {macro.actions.status && <i><Layers3 size={11} /> muda etapa</i>}
                      {macro.actions.labelIds.length > 0 && <i><Tag size={11} /> etiqueta</i>}
                      {!macro.actions.closeConversation && !macro.actions.status && macro.actions.labelIds.length === 0 && <i>somente mensagem</i>}
                    </span>
                  </span>
                  <Pencil size={14} />
                </button>
              )) : (
                <div className={styles.empty}><MessageSquareText size={25} /><strong>Nenhuma macro ainda</strong><span>Crie a primeira para usar no Inbox.</span></div>
              )}
            </div>
          </aside>

          <section className={styles.editor}>
            <div className={styles.editorTitle}>
              <div><span>{editingId ? 'Editando macro' : 'Nova macro'}</span><h2>{draft.title || 'Mensagem e acoes'}</h2></div>
              {editingId && (
                <button className={styles.deleteButton} type="button" disabled={saving} onClick={() => {
                  const macro = macros.find((item) => item.id === editingId);
                  if (macro) void deleteMacro(macro);
                }}><Trash2 size={15} /> Apagar</button>
              )}
            </div>

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Nome da macro</span>
                <input maxLength={60} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Ex.: Finalizar com despedida" />
              </label>
              <label className={`${styles.field} ${styles.messageField}`}>
                <span>Mensagem enviada ao cliente</span>
                <textarea maxLength={4000} rows={8} value={draft.text} onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))} placeholder="Escreva a mensagem exatamente como o cliente deve receber." />
                <small>{draft.text.length}/4000</small>
              </label>
            </div>

            <div className={styles.actionsBlock}>
              <div className={styles.sectionHeading}><CheckCircle2 size={17} /><div><strong>Acoes depois do envio</strong><span>A mensagem sempre vai primeiro. Se o envio falhar, nenhuma acao seguinte e executada.</span></div></div>

              <label className={`${styles.actionCard} ${draft.actions.closeConversation ? styles.actionCardActive : ''}`}>
                <input type="checkbox" checked={draft.actions.closeConversation} onChange={(event) => setDraft((current) => ({ ...current, actions: { ...current.actions, closeConversation: event.target.checked } }))} />
                <span className={styles.actionIcon}><Archive size={18} /></span>
                <span><strong>Encerrar atendimento</strong><small>Remove a conversa da caixa ativa depois de enviar a mensagem.</small></span>
                <i>{draft.actions.closeConversation ? 'Ativo' : 'Inativo'}</i>
              </label>

              <label className={styles.selectAction}>
                <span className={styles.actionIcon}><Layers3 size={18} /></span>
                <span><strong>Mover lead para uma etapa</strong><small>Opcional. O lead precisa estar associado a conversa.</small></span>
                <select value={draft.actions.status || ''} onChange={(event) => setDraft((current) => ({ ...current, actions: { ...current.actions, status: event.target.value || null } }))}>
                  <option value="">Nao alterar etapa</option>
                  {stages.filter((stage) => stage.id !== 'Sem interesse').map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
                </select>
              </label>

              <div className={styles.labelsAction}>
                <div className={styles.sectionHeading}><Tag size={17} /><div><strong>Aplicar etiquetas</strong><span>Opcional. Selecione uma ou mais etiquetas ja cadastradas na Unity.</span></div></div>
                <div className={styles.labelGrid}>
                  {labels.length ? labels.map((label) => {
                    const selected = draft.actions.labelIds.includes(label.id);
                    return (
                      <button key={label.id} type="button" onClick={() => toggleLabel(label.id)} className={selected ? styles.labelSelected : ''}>
                        <i style={{ backgroundColor: label.color }} /> {label.name} {selected && <CheckCircle2 size={13} />}
                      </button>
                    );
                  }) : <p>Nenhuma etiqueta cadastrada no Inbox.</p>}
                </div>
              </div>
            </div>

            <footer className={styles.editorFooter}>
              <p>A macro ficara disponivel no topo da conversa do Inbox somente para o seu acesso.</p>
              <button type="button" onClick={() => void saveMacro()} disabled={saving || !draft.title.trim() || !draft.text.trim()}>
                {saving ? <Loader2 className={styles.spin} size={17} /> : <Save size={17} />}
                {editingId ? 'Salvar alteracoes' : 'Criar macro'}
              </button>
            </footer>
          </section>
        </section>
      </main>
    </InternalLayout>
  );
}
