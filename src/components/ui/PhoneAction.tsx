'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Phone } from 'lucide-react';

type PhoneActionProps = {
  phone?: string | null;
};

function phoneDigits(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

function whatsappDigits(value?: string | null) {
  const digits = phoneDigits(value);
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

export default function PhoneAction({ phone }: PhoneActionProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const digits = phoneDigits(phone);
  const display = digits || '-';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            onClick={() => setOpen(false)}
          >
            <Phone size={14} />
            Ligar
          </a>
          <a
            href={`https://wa.me/${whatsappDigits(phone)}`}
            target="_blank"
            rel="noreferrer"
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
