'use client';

import { useState, type ReactNode } from 'react';
import { Check, ChevronRight, CircleCheckBig, Clock3 } from 'lucide-react';
import './tasks.css';

export type GoogleTaskItem = {
  id: string;
  titulo: string;
  /** Linha cinza embaixo do titulo: lead, descricao ou responsavel. */
  nota?: string | null;
  /** Texto da etiqueta de prazo. Sem prazo, nao mostra etiqueta. */
  prazo?: string | null;
  /** Etiqueta em vermelho, do jeito que o Google marca o atrasado. */
  atrasada?: boolean;
  concluida?: boolean;
  /** Canto direito da linha: responsavel, prioridade, o que a tela precisar. */
  lateral?: ReactNode;
  /** Conteudo extra embaixo da nota: anexo, botoes de mover, o que a tela usar. */
  extra?: ReactNode;
};

type Props = {
  titulo: string;
  itens: GoogleTaskItem[];
  /** Concluidas ficam recolhidas no rodape, como no Google Tasks. */
  concluidas?: GoogleTaskItem[];
  contagem?: number;
  onAdicionar?: () => void;
  rotuloAdicionar?: string;
  onAlternar?: (item: GoogleTaskItem) => void;
  onAbrir?: (item: GoogleTaskItem) => void;
  vazio?: { titulo: string; descricao?: string };
  acoes?: ReactNode;
  /** Arrastar e soltar continua com a tela: aqui so marcamos a linha. */
  arrastavel?: boolean;
  aoIniciarArraste?: (item: GoogleTaskItem) => void;
  aoTerminarArraste?: () => void;
};

function Linha({
  item,
  onAlternar,
  onAbrir,
  arrastavel,
  aoIniciarArraste,
  aoTerminarArraste,
}: {
  item: GoogleTaskItem;
  onAlternar?: (item: GoogleTaskItem) => void;
  onAbrir?: (item: GoogleTaskItem) => void;
  arrastavel?: boolean;
  aoIniciarArraste?: (item: GoogleTaskItem) => void;
  aoTerminarArraste?: () => void;
}) {
  return (
    <div
      draggable={arrastavel}
      onDragStart={arrastavel ? () => aoIniciarArraste?.(item) : undefined}
      onDragEnd={arrastavel ? () => aoTerminarArraste?.() : undefined}
      className={`gt-item ${item.concluida ? 'done' : ''}`}
      role={onAbrir ? 'button' : undefined}
      tabIndex={onAbrir ? 0 : undefined}
      onClick={onAbrir ? () => onAbrir(item) : undefined}
      onKeyDown={
        onAbrir
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onAbrir(item);
              }
            }
          : undefined
      }
    >
      <button
        type="button"
        className={`gt-check ${item.concluida ? 'done' : ''}`}
        aria-label={item.concluida ? `Reabrir ${item.titulo}` : `Concluir ${item.titulo}`}
        onClick={(event) => {
          event.stopPropagation();
          onAlternar?.(item);
        }}
        disabled={!onAlternar}
      >
        {item.concluida && <Check size={13} strokeWidth={3} />}
      </button>

      <div className="gt-item-body">
        <span className="gt-item-title">{item.titulo}</span>
        {item.nota && <span className="gt-item-note">{item.nota}</span>}
        {item.prazo && (
          <span className={`gt-chip ${item.atrasada ? 'late' : ''}`}>
            <Clock3 size={11} /> {item.prazo}
          </span>
        )}
        {item.extra}
      </div>

      {item.lateral && <div className="gt-item-side">{item.lateral}</div>}
    </div>
  );
}

export default function GoogleTaskList({
  titulo,
  itens,
  concluidas = [],
  contagem,
  onAdicionar,
  rotuloAdicionar = 'Adicionar uma tarefa',
  onAlternar,
  onAbrir,
  vazio,
  acoes,
  arrastavel,
  aoIniciarArraste,
  aoTerminarArraste,
}: Props) {
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);

  return (
    <section className="gt-list">
      <header className="gt-list-head">
        <h2>{titulo}</h2>
        <div className="gt-list-head-side">
          {acoes}
          <span className="gt-list-count">{contagem ?? itens.length}</span>
        </div>
      </header>

      {onAdicionar && (
        <button type="button" className="gt-add" onClick={onAdicionar}>
          <CircleCheckBig size={18} /> {rotuloAdicionar}
        </button>
      )}

      <div className="gt-items">
        {itens.map((item) => (
          <Linha
            key={item.id}
            item={item}
            onAlternar={onAlternar}
            onAbrir={onAbrir}
            arrastavel={arrastavel}
            aoIniciarArraste={aoIniciarArraste}
            aoTerminarArraste={aoTerminarArraste}
          />
        ))}
      </div>

      {!itens.length && (
        <div className="gt-empty">
          <CircleCheckBig size={26} color="#8ab4f8" />
          <strong>{vazio?.titulo || 'Todas as tarefas concluídas'}</strong>
          <span>{vazio?.descricao || 'Bom trabalho!'}</span>
        </div>
      )}

      {concluidas.length > 0 && (
        <>
          <button
            type="button"
            className="gt-done-toggle"
            onClick={() => setMostrarConcluidas((valor) => !valor)}
            aria-expanded={mostrarConcluidas}
          >
            <ChevronRight size={16} className={`gt-caret ${mostrarConcluidas ? 'open' : ''}`} />
            Concluídas ({concluidas.length})
          </button>
          {mostrarConcluidas && (
            <div className="gt-items">
              {concluidas.map((item) => (
                <Linha key={item.id} item={item} onAlternar={onAlternar} onAbrir={onAbrir} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
