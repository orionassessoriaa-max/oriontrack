import { Lead, Corretor, SolicitacaoSuporte, Material } from '../types';

export const mockLeads: Lead[] = [];

export const mockBrokers: Corretor[] = [
  {
    id: '1',
    nome: 'Gabriel Martins',
    email: 'gabriel@orion.com.br',
    telefone: '(11) 98765-4321',
    status: 'active',
    created_at: new Date().toISOString()
  },
  {
    id: '2',
    nome: 'Juliana Silva',
    email: 'juliana@orion.com.br',
    telefone: '(11) 91234-5678',
    status: 'active',
    created_at: new Date().toISOString()
  }
];

export const mockSupportRequests: SolicitacaoSuporte[] = [];
export const mockMaterials: Material[] = [];
