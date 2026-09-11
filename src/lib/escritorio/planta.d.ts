/** Fronteira tipada do motor em DOM puro que vive em planta.js. */

export type PessoaEscritorio = {
  id: string;
  nome: string;
  papel?: string;
  /** Id da mesa em que a pessoa senta. Sem mesa, ela vai descansar. */
  mesa?: string | null;
  arquivo?: string | null;
  acao?: string | null;
  /** ISO. Passado de OCIOSO_MS sem mudar, a pessoa larga a mesa. */
  em?: string | null;
  cor?: string;
  cabelo?: string;
  pele?: string;
};

export type DadosEscritorio = {
  pessoas: PessoaEscritorio[];
  /** Vira o selo em cima da caixa de correio. */
  naoLidas?: number;
};

export type Escritorio = {
  aplicar(dados: DadosEscritorio): void;
  /** Chamado quando alguem clica na caixa de correio. */
  aoClicarCorreio(fn: () => void): void;
  /** Mata timers e animacoes. Obrigatorio no cleanup do efeito. */
  destruir(): void;
};

export function montarEscritorio(raiz: HTMLElement | null): Escritorio;
