'use client';

import InternalLayout from '@/components/layout/InternalLayout';
import { mockMaterials } from '@/data/mock';
import { FileText, Download, PlayCircle, BookOpen, ExternalLink, Search } from 'lucide-react';

export default function MaterialsPage() {
  return (
    <InternalLayout>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Materiais</h1>
          <p className="text-gray-500">Recursos para ajudar você a converter mais leads.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input 
            type="text" 
            placeholder="Buscar material..." 
            className="bg-white border border-gray-200 pl-10 pr-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {mockMaterials.map((material) => (
          <div key={material.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-lg transition-all flex flex-col group">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                {material.category === 'Vendas' ? <FileText size={24} /> :
                 material.category === 'Treinamento' ? <PlayCircle size={24} /> :
                 <BookOpen size={24} />}
              </div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{material.category}</span>
            </div>
            
            <h3 className="text-lg font-bold text-gray-900 mb-2">{material.title}</h3>
            <p className="text-sm text-gray-500 mb-6 flex-1 leading-relaxed">
              {material.description}
            </p>
            
            <div className="flex gap-2">
              <button className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all">
                <Download size={14} />
                Baixar PDF
              </button>
              <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all">
                <ExternalLink size={14} />
                Ver Agora
              </button>
            </div>
          </div>
        ))}
      </div>
    </InternalLayout>
  );
}
