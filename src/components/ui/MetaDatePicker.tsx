'use client';

import { useState, useEffect, useRef } from 'react';
import { CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';

interface MetaDatePickerProps {
  startDate: string; // Formato: "YYYY-MM-DD"
  endDate: string; // Formato: "YYYY-MM-DD"
  onChange: (startDate: string, endDate: string, presetLabel: string) => void;
  className?: string;
  preset?: string;
}

export default function MetaDatePicker({
  startDate,
  endDate,
  onChange,
  className = '',
  preset = 'Este mês',
}: MetaDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempStart, setTempStart] = useState(startDate);
  const [tempEnd, setTempEnd] = useState(endDate);
  const [activePreset, setActivePreset] = useState(preset);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sincronizar estados se as propriedades externas mudarem
  useEffect(() => {
    setTempStart(startDate);
    setTempEnd(endDate);
  }, [startDate, endDate]);

  // Fechar popover ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const applyPreset = (presetName: string) => {
    if (presetName === 'todo_periodo') {
      const d = new Date();
      const tzOffset = d.getTimezoneOffset() * 60000;
      const startStr = '2025-01-01'; // Default system start
      const endStr = new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
      
      setTempStart(startStr);
      setTempEnd(endStr);
      setActivePreset('Todo o período');
      onChange(startStr, endStr, 'Todo o período');
      setIsOpen(false);
      return;
    }

    const d = new Date();
    let start = new Date();
    let end = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;

    let label = 'Este mês';

    switch (presetName) {
      case 'hoje':
        label = 'Hoje';
        break;
      case 'ontem':
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
        end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
        label = 'Ontem';
        break;
      case '7dias':
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6);
        label = 'Últimos 7 dias';
        break;
      case '30dias':
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29);
        label = 'Últimos 30 dias';
        break;
      case 'este_mes':
        start = new Date(d.getFullYear(), d.getMonth(), 1);
        end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        label = 'Este mês';
        break;
      case 'mes_passado':
        start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        end = new Date(d.getFullYear(), d.getMonth(), 0);
        label = 'Mês passado';
        break;
      default:
        break;
    }

    const startStr = new Date(start.getTime() - tzOffset).toISOString().slice(0, 10);
    const endStr = new Date(end.getTime() - tzOffset).toISOString().slice(0, 10);

    setTempStart(startStr);
    setTempEnd(endStr);
    setActivePreset(label);
    onChange(startStr, endStr, label);
    setIsOpen(false);
  };

  const handleApplyCustom = () => {
    setActivePreset('Personalizado');
    onChange(tempStart, tempEnd, 'Personalizado');
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-between gap-3 bg-white/5 border border-white/5 hover:bg-white/10 transition px-5 py-3.5 rounded-2xl text-xs font-black text-white cursor-pointer select-none outline-none w-full md:w-auto"
      >
        <div className="flex items-center gap-2.5">
          <CalendarDays size={16} className="text-blue-400 shrink-0" />
          <span className="font-extrabold text-slate-100">
            {activePreset} {startDate && endDate ? `(${formatDateDisplay(startDate)} a ${formatDateDisplay(endDate)})` : ''}
          </span>
        </div>
        {isOpen ? (
          <ChevronUp size={14} className="text-slate-400 shrink-0 ml-2" />
        ) : (
          <ChevronDown size={14} className="text-slate-400 shrink-0 ml-2" />
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-15 z-50 flex flex-col md:flex-row gap-4 p-5 rounded-3xl bg-[#0b1324] border border-white/5 shadow-2xl shadow-slate-950/80 w-[95vw] sm:w-[480px] animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Presets List */}
          <div className="flex flex-col gap-1 md:w-44 border-r border-white/5 pr-3 shrink-0">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 pl-2">Atalhos rápidos</p>
            {[
              { id: 'todo_periodo', label: 'Todo o período' },
              { id: 'hoje', label: 'Hoje' },
              { id: 'ontem', label: 'Ontem' },
              { id: '7dias', label: 'Últimos 7 dias' },
              { id: '30dias', label: 'Últimos 30 dias' },
              { id: 'este_mes', label: 'Este mês' },
              { id: 'mes_passado', label: 'Mês passado' },
            ].map((presetItem) => (
              <button
                key={presetItem.id}
                type="button"
                onClick={() => applyPreset(presetItem.id)}
                className={`text-left w-full text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer ${
                  activePreset === presetItem.label
                    ? 'text-blue-400 bg-white/5'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                {presetItem.label}
              </button>
            ))}
          </div>

          {/* Custom Date Input Fields */}
          <div className="flex-1 flex flex-col justify-between gap-4">
            <div>
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Período Personalizado</p>
              <div className="grid gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400">Data de Início</span>
                  <div className="relative bg-white/5 border border-white/5 px-4 py-3 rounded-2xl flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      {formatDateDisplay(tempStart) || 'Selecione...'}
                    </span>
                    <CalendarDays size={14} className="text-slate-500" />
                    <input
                      type="date"
                      value={tempStart}
                      onChange={(e) => {
                        setTempStart(e.target.value);
                        setActivePreset('Personalizado');
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400">Data de Fim</span>
                  <div className="relative bg-white/5 border border-white/5 px-4 py-3 rounded-2xl flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      {formatDateDisplay(tempEnd) || 'Selecione...'}
                    </span>
                    <CalendarDays size={14} className="text-slate-500" />
                    <input
                      type="date"
                      value={tempEnd}
                      onChange={(e) => {
                        setTempEnd(e.target.value);
                        setActivePreset('Personalizado');
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-white/5 pt-3 mt-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApplyCustom}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition shadow-lg shadow-blue-600/10 cursor-pointer"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
