'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

type DialogState = {
  title: string;
  message: string;
  variant?: 'info' | 'danger' | 'success';
  confirmLabel?: string;
  cancelLabel?: string;
  resolve?: (value: boolean) => void;
};

type DialogContextValue = {
  alertDialog: (message: string, options?: Partial<DialogState>) => Promise<void>;
  confirmDialog: (message: string, options?: Partial<DialogState>) => Promise<boolean>;
};

const DialogContext = createContext<DialogContextValue>({
  alertDialog: async () => {},
  confirmDialog: async () => false,
});

export function useDialog() {
  return useContext(DialogContext);
}

export default function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const value = useMemo<DialogContextValue>(() => ({
    alertDialog: async (message, options) => {
      await new Promise<boolean>((resolve) => {
        setDialog({
          title: options?.title || 'Atenção',
          message,
          variant: options?.variant || 'info',
          confirmLabel: options?.confirmLabel || 'Entendi',
          resolve,
        });
      });
    },
    confirmDialog: async (message, options) => {
      return new Promise<boolean>((resolve) => {
        setDialog({
          title: options?.title || 'Confirmar ação',
          message,
          variant: options?.variant || 'danger',
          confirmLabel: options?.confirmLabel || 'Confirmar',
          cancelLabel: options?.cancelLabel || 'Cancelar',
          resolve,
        });
      });
    },
  }), []);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message?: any) => {
      const msgStr = String(message ?? '');
      const isSuccess = /sucesso|copiado|criado|salvo|atualizado|excluído|excluido|adicionado/i.test(msgStr);
      void value.alertDialog(msgStr, isSuccess ? { variant: 'success', title: 'Sucesso' } : undefined);
    };
    return () => {
      window.alert = originalAlert;
    };
  }, [value]);

  function close(result: boolean) {
    dialog?.resolve?.(result);
    setDialog(null);
  }

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          data-escape-overlay
        >
          <div className="w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/20 bg-white shadow-2xl dark:border-blue-400/20 dark:bg-[#07182b]">
            <div className="flex items-start gap-4 border-b border-slate-100 p-6 dark:border-blue-400/10">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                dialog.variant === 'danger'
                  ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300'
                  : dialog.variant === 'success'
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
              }`}>
                {dialog.variant === 'success' ? <CheckCircle2 size={23} /> : <AlertTriangle size={23} />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-black text-slate-950 dark:text-white">{dialog.title}</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600 dark:text-blue-100">{dialog.message}</p>
              </div>
              <button aria-label="Fechar" onClick={() => close(false)} className="cursor-pointer rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col-reverse gap-3 p-5 sm:flex-row sm:justify-end">
              {dialog.cancelLabel ? (
                <button
                  onClick={() => close(false)}
                  className="cursor-pointer rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-blue-400/20 dark:text-blue-100 dark:hover:bg-white/10"
                >
                  {dialog.cancelLabel}
                </button>
              ) : null}
              <button
                onClick={() => close(true)}
                className={`cursor-pointer rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 ${
                  dialog.variant === 'danger'
                    ? 'bg-red-600 shadow-red-600/20 hover:bg-red-700'
                    : dialog.variant === 'success'
                      ? 'bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700'
                      : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-700'
                }`}
              >
                {dialog.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}
