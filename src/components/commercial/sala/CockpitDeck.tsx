'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// A cabine nao rola: ela gira. O deck guarda um valor continuo `pan` (0 = janela
// da esquerda, 1 = central, 2 = direita) e escreve o transform de cada painel
// direto no DOM a cada quadro.
//
// Tres jeitos de virar a cadeira, do mais natural para o mais explicito:
//   1. mover o mouse  -> a vista inclina junto, e encostar na borda vira de vez
//   2. arrastar       -> leva a janela na mao
//   3. setas, botoes  -> para quem quer ir direto ao ponto

export type CockpitPanel = {
  id: string;
  label: string;
  content: React.ReactNode;
};

// Fracao da largura da tela que o arrasto precisa cobrir para trocar de janela.
const SWITCH_THRESHOLD = 0.12;
// A partir de onde a borda comeca a puxar (0.86 = os 7% externos de cada lado).
const EDGE_START = 0.86;
// Janelas por segundo quando o mouse esta encostado na borda.
const EDGE_SPEED = 0.7;
// Quanto a vista inclina so acompanhando o mouse, em fracao de janela.
const LEAN = 0.05;
const MAX_ROTATION = 38;
const MAX_DEPTH = 200;

// A cadeira tem peso: em vez de correr direto para o alvo, o giro vira uma mola
// amortecida. Ela acelera, desacelera e encosta macio, sem o repique de mola
// solta que faria a leitura tremer no fim.
const SPRING = 42;
const DAMPING = 12.4;
// Abaixo disso o movimento nao e mais visivel e a mola desliga, para nao ficar
// um rAF vivo a toa recalculando um deslocamento de decimo de pixel.
const REST_POSITION = 0.0004;
const REST_VELOCITY = 0.0025;

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function CockpitDeck({ panels, initial = 1 }: { panels: CockpitPanel[]; initial?: number }) {
  const [index, setIndex] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const panRef = useRef(initial);
  const targetRef = useRef(initial);
  const leanRef = useRef(0);
  const lookRef = useRef(0);
  const velocityRef = useRef(0);
  // O giro por borda so arma depois de um movimento de verdade. Sem isso, abrir
  // a pagina com o cursor em repouso na lateral ja tirava o piloto do mapa.
  const armedRef = useRef(false);
  const firstPointRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startPan: number;
    lastX: number;
    lastTime: number;
    velocity: number;
  } | null>(null);

  const lastIndex = panels.length - 1;

  const applyFrame = useCallback(() => {
    // A inclinacao entra so no visual: o `pan` continua inteiro para o encaixe.
    const pan = panRef.current + leanRef.current;
    const track = trackRef.current;
    if (track) track.style.setProperty('--pan', pan.toFixed(4));
    panelRefs.current.forEach((panel, panelIndex) => {
      if (!panel) return;
      const offset = panelIndex - pan;
      const clamped = Math.max(-1.6, Math.min(1.6, offset));
      panel.style.setProperty('--rotate', `${(-clamped * MAX_ROTATION).toFixed(2)}deg`);
      panel.style.setProperty('--depth', `${(-Math.abs(clamped) * MAX_DEPTH).toFixed(1)}px`);
      panel.style.setProperty('--dim', Math.max(0, 1 - Math.abs(offset) * 0.85).toFixed(3));
      // So a janela de frente recebe clique e hover, senao o painel vizinho
      // rouba o ponteiro na beirada da tela.
      panel.style.pointerEvents = Math.abs(offset) < 0.5 ? 'auto' : 'none';
    });
  }, []);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(lastIndex, next));
      targetRef.current = clamped;
      setIndex(clamped);
    },
    [lastIndex],
  );

  useEffect(() => {
    const reduced = prefersReducedMotion();
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const delta = Math.min(64, now - last);
      last = now;

      const look = armedRef.current ? lookRef.current : 0;
      if (!dragRef.current && !reduced) {
        // Borda da tela puxa a cadeira para a janela vizinha.
        const past = (Math.abs(look) - EDGE_START) / (1 - EDGE_START);
        if (past > 0) {
          const next = targetRef.current + Math.sign(look) * past * EDGE_SPEED * (delta / 1000);
          targetRef.current = Math.max(0, Math.min(lastIndex, next));
          setIndex((current) => {
            const rounded = Math.round(targetRef.current);
            return rounded === current ? current : rounded;
          });
        }
        leanRef.current += (look * LEAN - leanRef.current) * (1 - Math.exp(-delta / 180));
      } else {
        leanRef.current += (0 - leanRef.current) * (1 - Math.exp(-delta / 180));
      }

      if (dragRef.current) {
        // Durante o arrasto a janela segue o dedo, sem mola no meio.
        velocityRef.current = 0;
      } else {
        // Mola amortecida, integrada em passos fixos para o resultado nao mudar
        // conforme a taxa de quadros do monitor.
        let restante = delta / 1000;
        while (restante > 0) {
          const passo = Math.min(1 / 120, restante);
          restante -= passo;
          const desvio = targetRef.current - panRef.current;
          const aceleracao = desvio * SPRING - velocityRef.current * DAMPING;
          velocityRef.current += aceleracao * passo;
          panRef.current += velocityRef.current * passo;
        }
        if (
          Math.abs(targetRef.current - panRef.current) < REST_POSITION &&
          Math.abs(velocityRef.current) < REST_VELOCITY
        ) {
          panRef.current = targetRef.current;
          velocityRef.current = 0;
        }
      }

      applyFrame();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [applyFrame, lastIndex]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPan: panRef.current,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
    };
    // Capturar o ponteiro mantem o giro vivo mesmo se o mouse sair da janela.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const width = event.currentTarget.clientWidth || 1;
    // -1 na borda esquerda, +1 na direita.
    lookRef.current = ((event.clientX - event.currentTarget.getBoundingClientRect().left) / width) * 2 - 1;

    // Um ponteiro parado tambem emite pointermove no carregamento. So armamos o
    // giro depois que ele andar de fato.
    if (!armedRef.current) {
      if (firstPointRef.current === null) firstPointRef.current = event.clientX;
      else if (Math.abs(event.clientX - firstPointRef.current) > 24) armedRef.current = true;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Arrastar para a direita aumenta o pan: a cadeira vira para a janela da direita.
    const next = drag.startPan + (event.clientX - drag.startX) / width;
    panRef.current = Math.max(-0.2, Math.min(lastIndex + 0.2, next));

    // Guarda a velocidade do gesto para a mola continuar o movimento na soltura,
    // que e o que faz o giro parecer lancado com a mao e nao teleportado.
    const now = performance.now();
    const elapsed = now - drag.lastTime;
    if (elapsed > 8) {
      drag.velocity = (event.clientX - drag.lastX) / width / (elapsed / 1000);
      drag.lastX = event.clientX;
      drag.lastTime = now;
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = event.currentTarget.clientWidth || 1;
    const travelled = (event.clientX - drag.startX) / width;
    const base = Math.round(drag.startPan);
    // Um lance rapido troca de janela mesmo sem percorrer a distancia toda.
    const lancado = Math.abs(drag.velocity) > 0.8;
    const next =
      Math.abs(travelled) > SWITCH_THRESHOLD || lancado
        ? base + Math.sign(travelled || drag.velocity)
        : base;
    velocityRef.current = drag.velocity;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    goTo(next);
  };

  // Sobre os botoes o giro por borda precisa soltar, senao a cadeira continua
  // virando enquanto voce mira no controle.
  const stopLook = useCallback(() => {
    lookRef.current = 0;
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goTo(Math.round(targetRef.current) + 1);
      if (event.key === 'ArrowLeft') goTo(Math.round(targetRef.current) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo]);

  return (
    <div
      className={`sala-deck ${dragging ? 'is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        lookRef.current = 0;
      }}
    >
      <div className="sala-track" ref={trackRef}>
        {panels.map((panel, panelIndex) => (
          <div
            key={panel.id}
            className="sala-panel"
            ref={(node) => {
              panelRefs.current[panelIndex] = node;
            }}
            aria-hidden={panelIndex !== index}
          >
            <div className="sala-viewport">
              <div className="sala-viewport-content">{panel.content}</div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="sala-turn is-left"
        onClick={() => goTo(index - 1)}
        onPointerEnter={stopLook}
        disabled={index === 0}
        aria-label={index > 0 ? `Virar para ${panels[index - 1].label}` : 'Sem janela a esquerda'}
      >
        <ChevronLeft size={26} />
      </button>
      <button
        type="button"
        className="sala-turn is-right"
        onClick={() => goTo(index + 1)}
        onPointerEnter={stopLook}
        disabled={index === lastIndex}
        aria-label={index < lastIndex ? `Virar para ${panels[index + 1].label}` : 'Sem janela a direita'}
      >
        <ChevronRight size={26} />
      </button>

      <nav
        className="sala-compass"
        aria-label="Janelas da cabine"
        onPointerEnter={stopLook}
      >
        {panels.map((panel, panelIndex) => (
          <button
            key={panel.id}
            type="button"
            className={panelIndex === index ? 'is-active' : ''}
            onClick={() => goTo(panelIndex)}
            aria-current={panelIndex === index}
          >
            <i aria-hidden="true" />
            <span>{panel.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
