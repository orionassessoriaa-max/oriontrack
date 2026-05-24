'use client';

import { Lead } from '@/types';
import { Phone, MapPin, DollarSign, X, MessageSquare, Users, Calendar, Building2, FileText, Smartphone } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getLeadQualification } from '@/lib/leadQualification';
import { TipoCampanha } from '@/types';
import { getLeadStatusStyle } from '@/lib/leadStatus';

function cleanPhone(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

interface LeadCardProps {
  lead: Lead;
  onClick: (lead: Lead) => void;
  tipoCampanha?: TipoCampanha | null;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function LeadCard({ lead, onClick, tipoCampanha, draggable, onDragStart, onDragEnd }: LeadCardProps) {
  const qualification = getLeadQualification(lead, tipoCampanha);
  const statusStyle = getLeadStatusStyle(lead.status);
  const qualificationClass = {
    good: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    neutral: 'bg-slate-50 text-slate-500 border-slate-100',
  }[qualification.tone];

  return (
    <motion.div 
      layoutId={lead.id}
      onClick={() => onClick(lead)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group"
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors text-base">{lead.nome}</h3>
      </div>
      <div className={`mb-4 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${qualificationClass}`}>
        {qualification.label}
      </div>
      
      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Smartphone size={14} className="text-blue-500" />
          <span>{lead.telefone}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <MapPin size={14} className="text-blue-500" />
          <span>{lead.cidade || 'Não informada'}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-bold">
            <Users size={14} className="text-blue-400" />
            <span>{lead.idades || '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-bold">
            <DollarSign size={14} className="text-blue-400" />
            <span>{lead.investimento || '-'}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-gray-50">
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${statusStyle.chip}`}>
          {statusStyle.label}
        </span>
        <span className="text-[10px] text-slate-400 font-bold">
          {lead.data_entrada ? format(new Date(lead.data_entrada), 'dd/MM') : '-'}
        </span>
      </div>
    </motion.div>
  );
}

interface LeadModalProps {
  lead: Lead | null;
  onClose: () => void;
  tipoCampanha?: TipoCampanha | null;
}

export function LeadModal({ lead, onClose, tipoCampanha }: LeadModalProps) {
  if (!lead) return null;
  const qualification = getLeadQualification(lead, tipoCampanha);
  const qualificationClass = {
    good: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    neutral: 'bg-slate-50 text-slate-600 border-slate-100',
  }[qualification.tone];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        />
        <motion.div 
          layoutId={lead.id}
          className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl overflow-hidden relative z-10 border border-white"
        >
          <div className="p-8 border-b border-gray-50 flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-2">Detalhes do Lead</p>
              <h2 className="text-2xl font-bold text-gray-900">{lead.nome}</h2>
              <div className="flex items-center gap-2 mt-1 text-slate-400 text-sm font-medium">
                <Calendar size={14} />
                Registrado em {lead.data_entrada ? format(new Date(lead.data_entrada), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR }) : '-'}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X size={24} className="text-slate-400" />
            </button>
          </div>

          <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
            <div className={`rounded-[1.5rem] border p-5 ${qualificationClass}`}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1">Fit do lead</p>
              <h3 className="text-lg font-black">{qualification.label}</h3>
              <p className="text-sm font-bold mt-1 opacity-80">{qualification.description}</p>
            </div>

            {/* Grid de Informações Principais */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Telefone de Contato</p>
                <div className="flex items-center gap-3 font-bold text-gray-900 text-lg">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                    <Phone size={20} />
                  </div>
                  {lead.telefone}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cidade / Região</p>
                <div className="flex items-center gap-3 font-bold text-gray-900 text-lg">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                    <MapPin size={20} />
                  </div>
                  {lead.cidade || 'Não informada'}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Idades no Perfil</p>
                <div className="flex items-center gap-3 font-bold text-gray-900 text-lg">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                    <Users size={20} />
                  </div>
                  {lead.idades || 'Não informado'}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Investimento / Orçamento</p>
                <div className="flex items-center gap-3 font-bold text-gray-900 text-lg">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                    <DollarSign size={20} />
                  </div>
                  {lead.investimento || 'Não informado'}
                </div>
              </div>
            </div>

            {/* Informações da Planilha */}
            <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Possui CNPJ?</p>
                <div className="flex items-center gap-2 font-bold text-gray-800">
                  <Building2 size={16} className="text-blue-400" />
                  {lead.possui_cnpj}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tem Plano Ativo?</p>
                <div className="flex items-center gap-2 font-bold text-gray-800">
                  <FileText size={16} className="text-blue-400" />
                  {lead.tem_plano_ativo}
                </div>
              </div>
              {lead.plano_atual && (
                <div className="md:col-span-2 space-y-1.5 pt-2 border-t border-slate-200">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Plano Atual / Operadora</p>
                  <p className="font-bold text-gray-800">{lead.plano_atual}</p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status da Negociação</p>
              <div className="flex items-center gap-4">
                <span className="bg-blue-600 text-white px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-600/20">
                  {lead.status}
                </span>
                <button className="text-xs text-blue-600 font-black hover:underline uppercase tracking-widest">Alterar Status</button>
              </div>
            </div>

            {lead.observacoes && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Notas e Observações</p>
                <div className="bg-amber-50 p-6 rounded-2xl text-sm text-amber-900 border border-amber-100 font-medium leading-relaxed">
                  {lead.observacoes}
                </div>
              </div>
            )}
          </div>

          <div className="p-8 bg-slate-50 border-t border-gray-100 flex gap-4">
            <a
              href={`/inbox?lead=${lead.id}&telefone=${cleanPhone(lead.telefone)}`}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-green-600/20 text-lg group"
            >
              <MessageSquare size={24} className="group-hover:scale-110 transition-transform" />
              WhatsApp
            </a>
            <button className="flex-1 bg-white border border-gray-200 text-slate-700 font-black py-5 rounded-2xl hover:bg-gray-50 transition-all text-lg">
              Editar
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
