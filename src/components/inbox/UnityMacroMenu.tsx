'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Archive, CheckCircle2, Layers3, Loader2, MessageSquareText, Settings2, Tag, X } from 'lucide-react';
import type { KanbanStage } from '@/lib/kanbanStages';
import type { UnityMacro } from '@/lib/unityMacros';
import styles from './UnityMacroMenu.module.css';

type UnityLabel = { id: string; name: string; color: string };

export default function UnityMacroMenu({
  macros,
  labels,
  stages,
  executingId,
  onExecute,
}: {
  macros: UnityMacro[];
  labels: UnityLabel[];
  stages: KanbanStage[];
  executingId: string | null;
  onExecute: (macro: UnityMacro) => Promise<boolean>;
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
    if (!selected || executingId) return;
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
              <button key={macro.id} type="button" onClick={() => setSelected(macro)}>
                <span><MessageSquareText size={14} /></span>
                <div><strong>{macro.title}</strong><small>{macro.text}</small></div>
              </button>
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
              <div><CheckCircle2 size={15} /><span><strong>1. Enviar mensagem</strong><small>Nenhuma outra acao ocorre se o envio falhar.</small></span></div>
              {selectedLabels.length > 0 && <div><Tag size={15} /><span><strong>2. Aplicar etiquetas</strong><small>{selectedLabels.map((label) => label.name).join(', ')}</small></span></div>}
              {selectedStage && <div><Layers3 size={15} /><span><strong>Mover para {selectedStage.label}</strong><small>Atualiza a etapa no CRM.</small></span></div>}
              {selected.actions.closeConversation && <div><Archive size={15} /><span><strong>Encerrar atendimento</strong><small>Remove a conversa da caixa ativa.</small></span></div>}
            </div>
            <div className={styles.footer}>
              <button type="button" onClick={() => setSelected(null)}>Cancelar</button>
              <button type="button" disabled={Boolean(executingId)} onClick={() => void execute()}>
                {executingId === selected.id ? <Loader2 className={styles.spin} size={16} /> : <CheckCircle2 size={16} />}
                {executingId === selected.id ? 'Executando...' : 'Executar macro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
