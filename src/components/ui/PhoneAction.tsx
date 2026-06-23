'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Phone } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type PhoneActionProps = {
  phone?: string | null;
  leadId?: string | null;
  whatsappHref?: string;
};

function phoneDigits(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

export default function PhoneAction({ phone, leadId, whatsappHref }: PhoneActionProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const digits = phoneDigits(phone);
  const display = digits || '-';
  const inboxHref = whatsappHref || `/inbox?${new URLSearchParams({
    ...(leadId ? { lead: leadId } : {}),
    telefone: digits,
  }).toString()}`;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCall = async () => {
    setOpen(false);
    if (!leadId) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const profileId = sessionData?.session?.user?.id;
      
      await supabase.from('lead_atividades').insert([{
        lead_id: leadId,
        profile_id: profileId || null,
        tipo: 'ligacao',
        titulo: 'Ligação Iniciada',
        descricao: 'O corretor iniciou uma chamada telefônica através do painel.'
      }]);
    } catch (e) {
      console.error('Erro ao registrar ligação no histórico:', e);
    }
  };

  if (!digits) {
    return <span className="whitespace-nowrap text-slate-400">-</span>;
  }

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="whitespace-nowrap rounded-md bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 transition-all hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200"
      >
        {display}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 grid min-w-[180px] gap-2 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
          <a
            href={`tel:${digits}`}
            className="flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white transition-colors hover:bg-slate-700"
            onClick={handleCall}
          >
            <Phone size={14} />
            Ligar
          </a>
          <a
            href={inboxHref}
            className="flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-500"
            onClick={() => setOpen(false)}
          >
            <MessageCircle size={14} />
            WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
