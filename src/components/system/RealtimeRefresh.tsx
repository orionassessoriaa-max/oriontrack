'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const WATCHED_TABLES = [
  'leads',
  'whatsapp_conversas',
  'whatsapp_mensagens',
  'lead_tarefas',
  'lead_atividades',
  'lead_ai_sessions',
  'corretores',
  'profiles',
  'corretoras',
  'notificacoes',
];

function isUserEditing() {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tagName = active.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || active.isContentEditable;
}

export default function RealtimeRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (!user || !profile) return;

    const emitRefreshEvent = (reason: string) => {
      window.dispatchEvent(new CustomEvent('orion:data-refresh', { detail: { reason } }));
    };

    const scheduleRefresh = (reason: string) => {
      emitRefreshEvent(reason);

      if (isUserEditing()) return;

      const now = Date.now();
      if (now - lastRefreshRef.current < 2500) return;
      lastRefreshRef.current = now;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        router.refresh();
      }, 500);
    };

    const channel = supabase.channel(`orion-auto-refresh-${profile.id}`);
    for (const table of WATCHED_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => scheduleRefresh(`table:${table}`)
      );
    }

    channel.subscribe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh('visibility');
    };

    const onFocus = () => scheduleRefresh('focus');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleRefresh('interval');
    }, pathname.startsWith('/inbox') || pathname.startsWith('/crm') || pathname.startsWith('/leads') ? 30000 : 60000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [pathname, profile, router, user]);

  return null;
}
