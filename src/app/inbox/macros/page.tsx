'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  AudioLines,
  Archive,
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Layers3,
  Loader2,
  Mic,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
  Search,
  Square,
  Tag,
  Trash2,
  UserRound,
} from 'lucide-react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import type { KanbanStage } from '@/lib/kanbanStages';
import type { UnityMacro, UnityMacroMessage } from '@/lib/unityMacros';
import styles from './page.module.css';

type UnityLabel = { id: string; name: string; color: string; active?: boolean };
type Draft = Omit<UnityMacro, 'id'>;

const EMPTY_DRAFT: Draft = {
  title: '',
  text: '',
  messages: [{ id: 'mensagem-1', type: 'text', text: '' }],
  intervalSeconds: 3,
  actions: { closeConversation: false, status: null, labelIds: [] },
};

function emptyMessage(index: number): UnityMacroMessage {
  return { id: `mensagem-${index + 1}-${crypto.randomUUID()}`, type: 'text', text: '' };
}

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
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function stopRecorderTracks() {
    if (recorderTimerRef.current) clearInterval(recorderTimerRef.current);
    recorderTimerRef.current = null;
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  }

  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    stopRecorderTracks();
  }, []);

  function setMessageCount(value: number) {
    const count = Math.min(10, Math.max(1, value || 1));
    setDraft((current) => {
      const messages = current.messages.slice(0, count);
      while (messages.length < count) messages.push(emptyMessage(messages.length));
      return { ...current, messages };
    });
  }

  function updateMessage(index: number, update: Partial<UnityMacroMessage>) {
    setDraft((current) => ({
      ...current,
      messages: current.messages.map((message, messageIndex) => messageIndex === index
        ? { ...message, ...update }
        : message),
    }));
  }

  function selectMacroFile(index: number, file: File | undefined) {
    if (!file) return;
    if (file.size > 2_200_000) {
      setNotice({ tone: 'error', text: 'O arquivo deve ter no maximo 2 MB para ser salvo na macro.' });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || '');
      const fileBase64 = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : '';
      if (!fileBase64 || fileBase64.length > 3_000_000) {
        setNotice({ tone: 'error', text: 'Nao foi possivel preparar este arquivo. Escolha um arquivo menor.' });
        return;
      }
      setNotice(null);
      updateMessage(index, {
        type: 'file',
        text: '',
        fileBase64,
        fileMimeType: file.type || 'application/octet-stream',
        fileName: file.name,
      });
    };
    reader.readAsDataURL(file);
  }

  async function startAudioRecording(index: number) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotice({ tone: 'error', text: 'Este navegador nao permite gravar audio. Use Chrome ou Edge atualizado.' });
      return;
    }
    try {
      setNotice(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorderChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data);
      };
      recorder.start(250);
      setRecordingIndex(index);
      setRecordSeconds(0);
      recorderTimerRef.current = setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    } catch {
      stopRecorderTracks();
      setNotice({ tone: 'error', text: 'Libere o microfone no navegador para gravar o audio da macro.' });
    }
  }

  function finishAudioRecording() {
    const recorder = recorderRef.current;
    const index = recordingIndex;
    if (!recorder || recorder.state === 'inactive' || index === null) return;
    const duration = Math.max(recordSeconds, 1);
    recorder.onstop = () => {
      const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      stopRecorderTracks();
      recorderRef.current = null;
      setRecordingIndex(null);
      if (!blob.size) {
        setNotice({ tone: 'error', text: 'A gravacao ficou vazia. Grave novamente.' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = String(reader.result || '');
        const audioBase64 = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : '';
        if (!audioBase64 || audioBase64.length > 3_000_000) {
          setNotice({ tone: 'error', text: 'O audio ficou grande demais. Grave uma mensagem mais curta.' });
          return;
        }
        const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
        const seconds = (duration % 60).toString().padStart(2, '0');
        updateMessage(index, {
          type: 'audio',
          text: '',
          audioBase64,
          audioMimeType: recorder.mimeType || 'audio/webm',
          audioDuration: `${minutes}:${seconds}`,
        });
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  }

  function editMacro(macro: UnityMacro) {
    setEditingId(macro.id);
    setDraft({
      title: macro.title,
      text: macro.text,
      messages: macro.messages.map((message) => ({ ...message })),
      intervalSeconds: macro.intervalSeconds,
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
    const validMessages = draft.messages.filter((message) => {
      if (message.type === 'audio') return Boolean(message.audioBase64);
      if (message.type === 'file') return Boolean(message.fileBase64 && message.fileName);
      return Boolean(message.text.trim());
    });
    if (!title || validMessages.length !== draft.messages.length) {
      setNotice({ tone: 'error', text: 'Informe o nome e complete todas as mensagens da sequencia.' });
      return;
    }
    if (macros.some((macro) => macro.id !== editingId && macro.title.toLocaleLowerCase('pt-BR') === title.toLocaleLowerCase('pt-BR'))) {
      setNotice({ tone: 'error', text: 'Voce ja possui uma macro com esse nome.' });
      return;
    }

    const item: UnityMacro = {
      id: editingId || crypto.randomUUID(),
      title,
      text: validMessages.find((message) => message.type === 'text')?.text.trim()
        || validMessages.find((message) => message.type === 'file')?.fileName
        || '[Mensagem de voz]',
      messages: validMessages,
      intervalSeconds: Math.min(120, Math.max(0, draft.intervalSeconds || 0)),
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
                  <span className={styles.macroIcon}>{macro.messages.some((message) => message.type === 'file') ? <FileUp size={17} /> : <MessageSquareText size={17} />}</span>
                  <span className={styles.macroBody}>
                    <strong>{macro.title}</strong>
                    <small>{macro.text}</small>
                    <span className={styles.actionSummary}>
                      <i><MessageSquareText size={11} /> {macro.messages.length} msg</i>
                      {macro.messages.some((message) => message.type === 'audio') && <i><AudioLines size={11} /> audio</i>}
                      {macro.messages.some((message) => message.type === 'file') && <i><FileUp size={11} /> arquivo</i>}
                      {macro.actions.closeConversation && <i><Archive size={11} /> arquiva</i>}
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
              <div className={styles.sequenceConfig}>
                <label className={styles.field}>
                  <span>Quantidade de mensagens</span>
                  <input type="number" min={1} max={10} value={draft.messages.length} onChange={(event) => setMessageCount(Number(event.target.value))} />
                </label>
                <label className={styles.field}>
                  <span>Intervalo entre mensagens</span>
                  <div className={styles.secondsInput}>
                    <input type="number" min={0} max={120} value={draft.intervalSeconds} onChange={(event) => setDraft((current) => ({ ...current, intervalSeconds: Math.min(120, Math.max(0, Number(event.target.value) || 0)) }))} />
                    <b>segundos</b>
                  </div>
                </label>
              </div>

              <div className={styles.sequenceList}>
                {draft.messages.map((message, index) => {
                  const isRecordingThis = recordingIndex === index;
                  const audioUrl = message.audioBase64
                    ? `data:${message.audioMimeType || 'audio/webm'};base64,${message.audioBase64}`
                    : '';
                  return (
                    <div className={styles.sequenceItem} key={message.id}>
                      <div className={styles.sequenceRail}><span>{index + 1}</span>{index < draft.messages.length - 1 && <i />}</div>
                      <div className={styles.sequenceContent}>
                        <div className={styles.sequenceHeader}>
                          <div><strong>Mensagem {index + 1}</strong><small>{message.type === 'audio' ? 'Audio gravado' : message.type === 'file' ? 'Arquivo ou print' : 'Texto'}</small></div>
                          <div className={styles.typeSwitch}>
                            <button type="button" className={message.type === 'text' ? styles.typeActive : ''} onClick={() => updateMessage(index, { type: 'text', audioBase64: undefined, audioMimeType: undefined, audioDuration: undefined, fileBase64: undefined, fileMimeType: undefined, fileName: undefined })}>Texto</button>
                            <button type="button" className={message.type === 'audio' ? styles.typeActive : ''} onClick={() => updateMessage(index, { type: 'audio', text: '', fileBase64: undefined, fileMimeType: undefined, fileName: undefined })}>Audio</button>
                            <button type="button" className={message.type === 'file' ? styles.typeActive : ''} onClick={() => updateMessage(index, { type: 'file', text: '', audioBase64: undefined, audioMimeType: undefined, audioDuration: undefined })}>Arquivo</button>
                          </div>
                        </div>

                        {message.type === 'text' ? (
                          <label className={`${styles.field} ${styles.messageField}`}>
                            <textarea maxLength={4000} rows={4} value={message.text} onChange={(event) => updateMessage(index, { text: event.target.value })} placeholder="Escreva exatamente como o cliente deve receber." />
                            <small>{message.text.length}/4000</small>
                          </label>
                        ) : message.type === 'audio' ? (
                          <div className={styles.audioRecorder}>
                            {audioUrl ? (
                              <>
                                <AudioLines size={18} />
                                <audio controls preload="metadata" src={audioUrl} />
                                <button type="button" onClick={() => updateMessage(index, { audioBase64: undefined, audioMimeType: undefined, audioDuration: undefined })}>Gravar novamente</button>
                              </>
                            ) : isRecordingThis ? (
                              <>
                                <span className={styles.recordingDot} />
                                <strong>Gravando {Math.floor(recordSeconds / 60).toString().padStart(2, '0')}:{(recordSeconds % 60).toString().padStart(2, '0')}</strong>
                                <button type="button" className={styles.stopRecording} onClick={finishAudioRecording}><Square size={13} /> Finalizar</button>
                              </>
                            ) : (
                              <button type="button" disabled={recordingIndex !== null} className={styles.recordButton} onClick={() => void startAudioRecording(index)}><Mic size={16} /> Gravar audio</button>
                            )}
                          </div>
                        ) : (
                          <div className={styles.filePicker}>
                            {message.fileBase64 && message.fileName ? (
                              <>
                                {message.fileMimeType?.startsWith('image/') ? (
                                  <img src={`data:${message.fileMimeType};base64,${message.fileBase64}`} alt="Previa do arquivo da macro" />
                                ) : <span className={styles.fileIcon}><FileUp size={19} /></span>}
                                <div><strong>{message.fileName}</strong><small>{message.fileMimeType?.startsWith('image/') ? 'Print pronto para envio' : 'Arquivo pronto para envio'}</small></div>
                                <label><input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => selectMacroFile(index, event.target.files?.[0])} />Trocar arquivo</label>
                              </>
                            ) : (
                              <label className={styles.fileSelect}><FileUp size={17} /><span><strong>Selecionar arquivo ou print</strong><small>Imagem, PDF, documento ou planilha de ate 2 MB.</small></span><input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => selectMacroFile(index, event.target.files?.[0])} /></label>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.actionsBlock}>
              <div className={styles.sectionHeading}><CheckCircle2 size={17} /><div><strong>Acoes depois do envio</strong><span>A mensagem sempre vai primeiro. Se o envio falhar, nenhuma acao seguinte e executada.</span></div></div>

              <label className={`${styles.actionCard} ${draft.actions.closeConversation ? styles.actionCardActive : ''}`}>
                <input type="checkbox" checked={draft.actions.closeConversation} onChange={(event) => setDraft((current) => ({ ...current, actions: { ...current.actions, closeConversation: event.target.checked } }))} />
                <span className={styles.actionIcon}><Archive size={18} /></span>
                <span><strong>Mover para arquivados</strong><small>Retira a conversa da fila ativa depois que toda a sequencia for enviada.</small></span>
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
                  {labels.some((label) => label.active !== false) ? labels.filter((label) => label.active !== false).map((label) => {
                    const selected = draft.actions.labelIds.includes(label.id);
                    return (
                      <button key={label.id} type="button" onClick={() => toggleLabel(label.id)} className={selected ? styles.labelSelected : ''}>
                        <i style={{ backgroundColor: label.color }} /> {label.name} {selected && <CheckCircle2 size={13} />}
                      </button>
                    );
                  }) : <p>Nenhuma etiqueta ativa. Gerencie a biblioteca em Etiquetas.</p>}
                </div>
              </div>
            </div>

            <footer className={styles.editorFooter}>
              <p>A sequencia ficara disponivel no Inbox somente para o seu acesso. Play inicia e pausa interrompe antes da proxima mensagem.</p>
              <button type="button" onClick={() => void saveMacro()} disabled={saving || recordingIndex !== null || !draft.title.trim()}>
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
