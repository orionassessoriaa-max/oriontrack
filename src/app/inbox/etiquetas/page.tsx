'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Save,
  Tag,
  X,
} from 'lucide-react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import type { UnityLabel } from '@/lib/unityLabels';
import styles from './page.module.css';

function normalizedCompany(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

const EMPTY_DRAFT = { name: '', color: '#06b6d4' };

export default function UnityLabelsPage() {
  const { profile } = useAuth();
  const [labels, setLabels] = useState<UnityLabel[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const isUnity = normalizedCompany(profile?.nome_empresa) === 'UNITY SAUDE';

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  const requestHeaders = useCallback(async () => {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getToken()}`,
      ...(profile?.id ? { 'x-orion-view-profile-id': profile.id } : {}),
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    if (!isUnity) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/inbox/unity-config', { cache: 'no-store', headers: await requestHeaders() });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar as etiquetas.');
        if (!active) return;
        setLabels(Array.isArray(payload.labels) ? payload.labels : []);
        setUsage(payload.labelUsage && typeof payload.labelUsage === 'object' ? payload.labelUsage : {});
      } catch (error: unknown) {
        if (active) setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Nao foi possivel carregar as etiquetas.' });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isUnity, profile?.id, requestHeaders]);

  const activeCount = labels.filter((label) => label.active !== false).length;
  const usedCount = useMemo(() => labels.filter((label) => (usage[label.name.toLocaleLowerCase('pt-BR')] || 0) > 0).length, [labels, usage]);

  async function persist(nextLabels: UnityLabel[], successText: string) {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/inbox/unity-config', {
        method: 'PATCH',
        headers: await requestHeaders(),
        body: JSON.stringify({ labels: nextLabels }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel salvar as etiquetas.');
      setLabels(Array.isArray(payload.labels) ? payload.labels : nextLabels);
      setNotice({ tone: 'success', text: successText });
    } catch (error: unknown) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Nao foi possivel salvar as etiquetas.' });
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    const name = draft.name.trim();
    if (!name) return;
    const duplicate = labels.some((label) => label.id !== editingId && label.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
    if (duplicate) {
      setNotice({ tone: 'error', text: 'Ja existe uma etiqueta com esse nome.' });
      return;
    }
    const previous = editingId ? labels.find((label) => label.id === editingId) : null;
    const next = editingId
      ? labels.map((label) => label.id === editingId ? { ...label, name, color: draft.color } : label)
      : [...labels, { id: crypto.randomUUID(), name, color: draft.color, active: true }];
    try {
      await persist(next, editingId ? 'Etiqueta atualizada.' : 'Etiqueta criada.');
      if (previous && previous.name !== name) {
        setUsage((current) => {
          const oldKey = previous.name.toLocaleLowerCase('pt-BR');
          const newKey = name.toLocaleLowerCase('pt-BR');
          const nextUsage = { ...current, [newKey]: current[oldKey] || 0 };
          delete nextUsage[oldKey];
          return nextUsage;
        });
      }
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
    } catch {
      // A mensagem de erro ja foi apresentada por persist.
    }
  }

  async function toggleActive(label: UnityLabel) {
    const next = labels.map((item) => item.id === label.id ? { ...item, active: item.active === false } : item);
    try {
      await persist(next, label.active === false ? 'Etiqueta ativada.' : 'Etiqueta desativada.');
    } catch {
      // A mensagem de erro ja foi apresentada por persist.
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= labels.length) return;
    const next = [...labels];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await persist(next, 'Ordem atualizada.');
    } catch {
      // A mensagem de erro ja foi apresentada por persist.
    }
  }

  return (
    <InternalLayout>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <Link href="/inbox" className={styles.back}><ArrowLeft size={15} /> Voltar ao Inbox</Link>
            <p className={styles.eyebrow}>UNITY SAÚDE</p>
            <h1>Etiquetas de atendimento</h1>
            <p>Organize a biblioteca usada nas macros e exibida abaixo do nome de cada lead.</p>
          </div>
          <Link href="/inbox/macros" className={styles.macrosLink}>Gerenciar macros</Link>
        </header>

        {!isUnity && profile?.id ? (
          <section className={styles.restricted}>
            <Tag size={24} />
            <h2>Configuração exclusiva da Unity</h2>
            <p>Esta biblioteca não altera as etiquetas das demais concessionárias.</p>
          </section>
        ) : (
          <>
            <section className={styles.summary} aria-label="Resumo das etiquetas">
              <div><span>Total</span><strong>{labels.length}</strong></div>
              <div><span>Ativas nas macros</span><strong>{activeCount}</strong></div>
              <div><span>Em uso nas conversas</span><strong>{usedCount}</strong></div>
              <p>Desativar uma etiqueta preserva o histórico e apenas impede novos usos.</p>
            </section>

            <section className={styles.workspace}>
              <aside className={styles.editor}>
                <div className={styles.sectionTitle}>
                  <span><Plus size={17} /></span>
                  <div><strong>{editingId ? 'Editar etiqueta' : 'Nova etiqueta'}</strong><small>Nome e cor visíveis no Inbox</small></div>
                </div>
                <label>Nome<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={50} placeholder="Ex.: Proposta enviada" /></label>
                <label>Cor<div className={styles.colorField}><input type="color" value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} /><code>{draft.color.toUpperCase()}</code></div></label>
                <div className={styles.preview}><span style={{ backgroundColor: draft.color }} />{draft.name.trim() || 'Prévia da etiqueta'}</div>
                <button type="button" className={styles.saveButton} onClick={() => void saveDraft()} disabled={saving || !draft.name.trim()}>{saving ? <Loader2 className={styles.spin} size={16} /> : <Save size={16} />}{editingId ? 'Salvar alteração' : 'Criar etiqueta'}</button>
                {editingId && <button type="button" className={styles.cancelButton} onClick={() => { setEditingId(null); setDraft(EMPTY_DRAFT); }}><X size={14} /> Cancelar edição</button>}
              </aside>

              <div className={styles.registry}>
                <div className={styles.registryHeader}><div><h2>Biblioteca da Unity</h2><p>A ordem abaixo também será usada no seletor das macros.</p></div><span>{activeCount} ativas</span></div>
                {notice && <div className={`${styles.notice} ${notice.tone === 'error' ? styles.noticeError : ''}`} role="status">{notice.tone === 'success' && <Check size={14} />}{notice.text}</div>}
                {loading ? (
                  <div className={styles.loading}><Loader2 className={styles.spin} /> Carregando etiquetas</div>
                ) : (
                  <div className={styles.rows}>
                    {labels.map((label, index) => {
                      const count = usage[label.name.toLocaleLowerCase('pt-BR')] || 0;
                      return (
                        <article key={label.id} className={`${styles.row} ${label.active === false ? styles.inactive : ''}`}>
                          <span className={styles.swatch} style={{ backgroundColor: label.color }} />
                          <div className={styles.labelName}><strong>{label.name}</strong><small>{count === 1 ? '1 conversa' : `${count} conversas`}</small></div>
                          <span className={styles.state}>{label.active === false ? 'Inativa' : 'Ativa'}</span>
                          <div className={styles.rowActions}>
                            <button type="button" onClick={() => void move(index, -1)} disabled={saving || index === 0} aria-label={`Mover ${label.name} para cima`}><ArrowUp size={14} /></button>
                            <button type="button" onClick={() => void move(index, 1)} disabled={saving || index === labels.length - 1} aria-label={`Mover ${label.name} para baixo`}><ArrowDown size={14} /></button>
                            <button type="button" onClick={() => { setEditingId(label.id); setDraft({ name: label.name, color: label.color }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={`Editar ${label.name}`}><Pencil size={14} /></button>
                            <button type="button" onClick={() => void toggleActive(label)} disabled={saving} aria-label={`${label.active === false ? 'Ativar' : 'Desativar'} ${label.name}`}>{label.active === false ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </InternalLayout>
  );
}
