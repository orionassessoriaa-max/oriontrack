import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

// Fontes do painel de parede. Ficam num modulo proprio porque as duas rotas que
// mostram o painel (a Sala e o atalho /sala-tv) precisam das mesmas variaveis.
// Numeros gigantes pedem uma grotesca com eixo de largura e digito tabular:
// sem tabular-nums o placar "danca" a cada atualizacao.
const display = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-tv-display', display: 'swap' });
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-tv-sans', display: 'swap' });
// A mono maiuscula espacada faz o papel das etiquetas de instrumento da cabine.
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-tv-mono', display: 'swap' });

export const tvFontClass = `${display.variable} ${sans.variable} ${mono.variable}`;
