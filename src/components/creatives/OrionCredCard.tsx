import Image from 'next/image';
import { LockKeyhole } from 'lucide-react';
import styles from './OrionCredCard.module.css';

type Props = {
  holderName: string;
  balance?: number | null;
  cycleLabel?: string;
};

function formatCredits(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

export default function OrionCredCard({ holderName, balance = null, cycleLabel = 'Ciclo de 20 dias' }: Props) {
  return (
    <section aria-label="Cartão Orion Cred" className={styles.card}>
      <div className="flex h-full flex-col justify-between p-6 sm:p-7">
        <div className="flex items-start justify-between gap-5">
          <Image
            src="/brand-logo.png"
            alt="Orion Track"
            width={1920}
            height={1080}
            className={styles.logo}
            priority
          />
          <span className={styles.monogram}>BLACK</span>
        </div>

        <div>
          <div className="mb-5 flex items-center justify-between gap-5">
            <div className={styles.chip} aria-hidden="true" />
            <div className="text-right">
              <p className={styles.creditLabel}>Orion Cred</p>
              <p className="mt-1 text-[11px] font-semibold text-cyan-100/55">Somente para criativos</p>
            </div>
          </div>

          <p className={styles.creditLabel}>Saldo disponível</p>
          <p className={`${styles.creditValue} mt-1`}>
            {balance === null ? 'Limite em configuração' : `${formatCredits(balance)} créditos`}
          </p>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className={styles.holder}>{holderName || 'Gestor Orion'}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{cycleLabel}</p>
          </div>
          <LockKeyhole size={17} className="shrink-0 text-cyan-200/50" aria-label="Saldo protegido" />
        </div>
      </div>
    </section>
  );
}

