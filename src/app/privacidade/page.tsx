import type { Metadata } from 'next';
import LegalPage from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Política de Privacidade | Orion Track',
  description: 'Política de Privacidade da plataforma Orion Track.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      description="Este documento explica como a ORION ASSESSORIA DIGITAL LTDA coleta, utiliza, protege e elimina dados pessoais tratados pela plataforma Orion Track."
    >
      <h2>1. Quem somos</h2>
      <p>
        A <strong>ORION ASSESSORIA DIGITAL LTDA</strong> é responsável pela plataforma Orion Track, utilizada para organizar operações comerciais, atendimento, campanhas, leads, tarefas, relatórios e integrações autorizadas pelos clientes.
      </p>

      <h2>2. Dados que podemos tratar</h2>
      <p>De acordo com o recurso utilizado, podemos tratar:</p>
      <ul>
        <li>dados de identificação e contato, como nome, e-mail e telefone;</li>
        <li>dados profissionais, empresa, cargo, equipe e responsável pelo atendimento;</li>
        <li>informações fornecidas em formulários, cadastros, conversas e solicitações;</li>
        <li>histórico de atendimento, tarefas, anotações, arquivos e etapas do funil;</li>
        <li>dados de campanhas e contas de anúncios autorizadas, incluindo métricas de desempenho;</li>
        <li>dados técnicos e de segurança, como registros de acesso, data, horário, endereço IP e informações do navegador.</li>
      </ul>

      <h2>3. Como utilizamos os dados</h2>
      <p>Os dados são utilizados para:</p>
      <ul>
        <li>fornecer, manter e proteger as funcionalidades do Orion Track;</li>
        <li>gerenciar leads, atendimentos, campanhas, tarefas, relatórios e aprovações;</li>
        <li>integrar serviços solicitados pelo cliente, como Meta, WhatsApp, Google Drive e provedores de infraestrutura;</li>
        <li>prevenir fraudes, investigar falhas e manter a segurança da plataforma;</li>
        <li>cumprir obrigações legais, regulatórias e contratuais;</li>
        <li>melhorar a qualidade e o desempenho dos serviços.</li>
      </ul>

      <h2>4. Bases legais</h2>
      <p>
        O tratamento ocorre conforme as bases previstas na Lei Geral de Proteção de Dados Pessoais — LGPD, incluindo execução de contrato, cumprimento de obrigação legal, legítimo interesse e consentimento, quando aplicável.
      </p>

      <h2>5. Integrações com a Meta</h2>
      <p>
        Quando uma conta Meta é conectada, o Orion Track acessa somente os dados e permissões autorizados pelo usuário e necessários à funcionalidade solicitada. Esses dados podem incluir contas de anúncios, campanhas, conjuntos, anúncios, páginas, formulários e métricas. O acesso pode ser revogado nas configurações da Meta ou mediante solicitação à Orion.
      </p>

      <h2>6. Compartilhamento</h2>
      <p>
        Podemos compartilhar dados com operadores tecnológicos indispensáveis ao funcionamento do serviço, sempre de forma limitada à finalidade contratada. Não comercializamos dados pessoais. Também poderemos compartilhar informações quando exigido por lei, autoridade competente ou para proteção de direitos e segurança.
      </p>

      <h2>7. Armazenamento e segurança</h2>
      <p>
        Adotamos medidas técnicas e administrativas razoáveis para proteger os dados contra acesso não autorizado, perda, alteração ou divulgação indevida. Os dados são mantidos pelo período necessário à prestação dos serviços, ao cumprimento de obrigações legais e ao exercício regular de direitos.
      </p>

      <h2>8. Direitos do titular</h2>
      <p>O titular pode solicitar, quando aplicável:</p>
      <ul>
        <li>confirmação e acesso aos dados;</li>
        <li>correção de informações incompletas ou desatualizadas;</li>
        <li>anonimização, bloqueio ou eliminação;</li>
        <li>informações sobre compartilhamento e portabilidade;</li>
        <li>revogação do consentimento e revisão de decisões automatizadas.</li>
      </ul>

      <h2>9. Exclusão de dados</h2>
      <p>
        As instruções para solicitar a exclusão estão disponíveis na página de{' '}
        <a href="/exclusao-de-dados">Exclusão de Dados</a>.
      </p>

      <h2>10. Contato</h2>
      <p>
        Dúvidas ou solicitações relacionadas à privacidade podem ser enviadas para{' '}
        <a href="mailto:ewerttonherculano@gmail.com">ewerttonherculano@gmail.com</a>.
      </p>
    </LegalPage>
  );
}
