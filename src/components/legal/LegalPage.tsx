import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

type LegalPageProps = {
  title: string;
  description: string;
  children: ReactNode;
};

const legalLinks = [
  { href: '/privacidade', label: 'Privacidade' },
  { href: '/termos', label: 'Termos de uso' },
  { href: '/exclusao-de-dados', label: 'Exclusão de dados' },
];

export default function LegalPage({ title, description, children }: LegalPageProps) {
  return (
    <main className="min-h-dvh bg-[#050b16] text-slate-200">
      <a
        href="#conteudo-legal"
        className="sr-only z-50 rounded-lg bg-cyan-300 px-4 py-3 font-bold text-slate-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-white/10 bg-[#071120]/95">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link
            href="/login"
            aria-label="Ir para o login do Orion Track"
            className="inline-flex min-h-11 w-fit items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#071120]"
          >
            <Image
              src="/brand-logo.png"
              alt="Orion Track"
              width={180}
              height={74}
              priority
              className="h-auto w-40 object-contain"
            />
          </Link>

          <nav aria-label="Documentos legais" className="flex flex-wrap gap-2 text-sm font-bold">
            {legalLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-slate-300 hover:border-cyan-400/50 hover:bg-cyan-400/10 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <section className="mb-8 rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 via-blue-500/5 to-transparent p-6 sm:p-9">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Orion Track · Documento oficial</p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">{description}</p>
          <p className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-500">Última atualização: 3 de agosto de 2026</p>
        </section>

        <article
          id="conteudo-legal"
          className="rounded-2xl border border-white/10 bg-[#0a1423] p-6 shadow-2xl shadow-black/20 sm:p-10 [&_a]:font-bold [&_a]:text-cyan-300 [&_a]:underline [&_a]:underline-offset-4 [&_a]:focus-visible:outline-none [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-cyan-300 [&_h2]:mb-3 [&_h2]:mt-9 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-white [&_h2:first-child]:mt-0 [&_li]:max-w-3xl [&_li]:leading-7 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:my-3 [&_p]:max-w-3xl [&_p]:leading-7 [&_strong]:text-white [&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6"
        >
          {children}
        </article>
      </div>

      <footer className="border-t border-white/10 bg-[#071120]">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-7 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© 2026 ORION ASSESSORIA DIGITAL LTDA. Todos os direitos reservados.</p>
          <a href="mailto:ewerttonherculano@gmail.com" className="font-bold text-cyan-300 hover:text-cyan-200">
            ewerttonherculano@gmail.com
          </a>
        </div>
      </footer>
    </main>
  );
}
