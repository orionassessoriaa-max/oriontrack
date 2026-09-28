'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Archive, AudioLines, CheckCircle2, Layers3, Loader2, MessageSquareText, Pause, Play, Settings2, Tag, X } from 'lucide-react';
import type { KanbanStage } from '@/lib/kanbanStages';
import type { UnityMacro } from '@/lib/unityMacros';
import styles from './UnityMacroMenu.module.css';

type UnityLabel = { id: string; name: string; color: string };

export default function UnityMacroMenu({
  macros,
  labels,
  stages,
  executingId,
  pausedId,
  onExecute,
  onPause,
  onResume,
}: {
  macros: UnityMacro[];
  labels: UnityLabel[];
  stages: KanbanStage[];
  executingId: string | null;
  pausedId: string | null;
  onExecute: (macro: UnityMacro) => Promise<boolean>;
  onPause: (macroId: string) => void;
  onResume: (macroId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<UnityMacro | null>(null);

  const selectedLabels = selected
    ? labels.filter((label) => selected.actions.labelIds.includes(label.id))
    : [];
  const selectedStage = selected?.actions.status
    ? stages.find((stage) => stage.id === selected.actions.status)
    : null;

  async function execute() {
    if (!selected) return;
    if (pausedId === selected.id) {
      onResume(selected.id);
      setSelected(null);
      setOpen(false);
      return;
    }
    if (executingId) return;
    const success = await onExecute(selected);
    if (success) {
      setSelected(null);
      setOpen(false);
    }
  }

  return (
    <div className={styles.root}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((current) => !current)}>
        <MessageSquareText size={14} /> Macros
      </button>

      {open && (
        <div className={styles.menu}>
          <div className={styles.menuHeader}>
            <div><span>Minhas macros</span><strong>{macros.length} salvas</strong></div>
            <Link href="/inbox/macros"><Settings2 size={13} /> Gerenciar</Link>
          </div>
          <div className={styles.list}>
            {macros.length ? macros.map((macro) => (
              <div key={macro.id} className={`${styles.macroRow} ${executingId === macro.id ? styles.macroRunning : ''}`}>
                <button className={styles.macroInfo} type="button" onClick={() => setSelected(macro)}>
                  <span>{macro.messages.some((message) => message.type === 'audio') ? <AudioLines size={14} /> : <MessageSquareText size={14} />}</span>
                  <div><strong>{macro.title}</strong><small>{macro.messages.length} {macro.messages.length === 1 ? 'mensagem' : 'mensagens'} · {macro.text}</small></div>
                </button>
                <div className={styles.transport}>
                  <button type="button" aria-label={`Executar ${macro.title}`} title="Executar macro" disabled={Boolean(executingId && executingId !== macro.id)} onClick={() => {
                    if (pausedId === macro.id) onResume(macro.id);
                    else setSelected(macro);
                  }}><Play size={12} fill="currentColor" /></button>
                  <button type="button" aria-label={`Pausar ${macro.title}`} title="Pausar macro" disabled={executingId !== macro.id || pausedId === macro.id} onClick={() => onPause(macro.id)}><Pause size={12} fill="currentColor" /></button>
                </div>
              </div>
            )) : (
              <div className={styles.empty}>Nenhuma macro criada.<Link href="/inbox/macros">Criar a primeira</Link></div>
            )}
          </div>
        </div>
      )}

      {selected && (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="macro-confirm-title">
          <div className={styles.dialog}>
            <button className={styles.close} type="button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={16} /></button>
            <span className={styles.dialogIcon}><MessageSquareText size={21} /></span>
            <p className={styles.kicker}>Confirmar macro</p>
            <h2 id="macro-confirm-title">{selected.title}</h2>
            <div className={styles.message}>{selected.text}</div>
            <div className={styles.actions}>
              <div><CheckCircle2 size={15} /><span><strong>Enviar {selected.messages.length} {selected.messages.length === 1 ? 'mensagem' : 'mensagens'}</strong><small>Intervalo de {selected.intervalSeconds}s. Nenhuma acao ocorre se algum envio falhar.</small></span></div>
              {selectedLabels.length > 0 && <div><Tag size={15} /><span><strong>2. Aplicar etiquetas</strong><small>{selectedLabels.map((label) => label.name).join(', ')}</small></span></div>}
              {selectedStage && <div><Layers3 size={15} /><span><strong>Mover para {selectedStage.label}</strong><small>Atualiza a etapa no CRM.</small></span></div>}
              {selected.actions.closeConversation && <div><Archive size={15} /><span><strong>Encerrar atendimento</strong><small>Remove a conversa da caixa ativa.</small></span></div>}
            </div>
            <div className={styles.footer}>
              <button type="button" onClick={() => setSelected(null)}>Cancelar</button>
              <button type="button" disabled={Boolean(executingId && pausedId !== selected.id)} onClick={() => void execute()}>
                {executingId === selected.id && pausedId !== selected.id ? <Loader2 className={styles.spin} size={16} /> : <Play size={16} />}
                {pausedId === selected.id ? 'Retomar macro' : executingId === selected.id ? 'Executando...' : 'Executar macro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
