import type { Metadata } from 'next';
import LegalPage from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Termos de Uso | Orion Track',
  description: 'Termos de Uso da plataforma Orion Track.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      description="Estes termos regulam o acesso e a utilização da plataforma Orion Track e de suas integrações."
    >
      <h2>1. Aceitação</h2>
      <p>
        Ao acessar ou utilizar o Orion Track, o usuário declara que leu e concorda com estes Termos de Uso e com a Política de Privacidade. Caso não concorde, não deverá utilizar a plataforma.
      </p>

      <h2>2. Finalidade da plataforma</h2>
      <p>
        O Orion Track oferece recursos para gestão de operações comerciais, leads, atendimento, campanhas, tarefas, relatórios, criativos e integrações autorizadas. As funcionalidades disponíveis podem variar conforme o perfil de acesso e a contratação realizada.
      </p>

      <h2>3. Conta e acesso</h2>
      <ul>
        <li>o usuário deve fornecer informações corretas e manter suas credenciais protegidas;</li>
        <li>o acesso é pessoal e não deve ser compartilhado sem autorização;</li>
        <li>ações realizadas com uma conta autenticada serão atribuídas ao respectivo usuário;</li>
        <li>a Orion poderá bloquear acessos em caso de risco, fraude, violação destes termos ou exigência legal.</li>
      </ul>

      <h2>4. Integrações e contas de terceiros</h2>
      <p>
        O usuário somente poderá conectar contas, páginas, números, arquivos ou ativos para os quais possua autorização. Integrações como Meta, WhatsApp e Google também estão sujeitas aos termos e políticas dos respectivos fornecedores.
      </p>

      <h2>5. Campanhas e publicações</h2>
      <p>
        O usuário é responsável por revisar públicos, orçamento, conteúdo, destino, permissões e conformidade antes de ativar campanhas ou anúncios. Recursos automatizados e sugestões de inteligência artificial servem como apoio e devem ser conferidos por uma pessoa autorizada antes da publicação.
      </p>

      <h2>6. Uso permitido</h2>
      <p>É proibido utilizar o Orion Track para:</p>
      <ul>
        <li>praticar atos ilícitos, fraudulentos ou discriminatórios;</li>
        <li>violar direitos autorais, privacidade ou regras de plataformas integradas;</li>
        <li>tentar obter acesso indevido, explorar falhas ou prejudicar a disponibilidade do serviço;</li>
        <li>inserir conteúdo malicioso ou utilizar dados sem base legal ou autorização.</li>
      </ul>

      <h2>7. Disponibilidade e alterações</h2>
      <p>
        A Orion busca manter a plataforma disponível e segura, mas atualizações, manutenção, falhas de terceiros ou eventos fora de seu controle podem causar indisponibilidade temporária. Funcionalidades poderão ser modificadas para evolução técnica, segurança ou adequação legal.
      </p>

      <h2>8. Propriedade intelectual</h2>
      <p>
        A tecnologia, identidade visual, código, documentação e demais elementos do Orion Track pertencem à Orion ou a seus licenciadores. O uso da plataforma não transfere direitos de propriedade intelectual ao usuário.
      </p>

      <h2>9. Responsabilidades</h2>
      <p>
        Cada usuário e organização é responsável pela legalidade dos dados inseridos, pelas autorizações concedidas e pelas decisões comerciais tomadas com apoio da plataforma. A Orion não garante resultados de vendas, campanhas ou negociações.
      </p>

      <h2>10. Encerramento e dados</h2>
      <p>
        O acesso poderá ser encerrado conforme a relação contratual ou por violação destes termos. Solicitações relacionadas a dados pessoais seguirão a Política de Privacidade e as instruções da página de{' '}
        <a href="/exclusao-de-dados">Exclusão de Dados</a>.
      </p>

      <h2>11. Contato</h2>
      <p>
        Para assuntos relacionados a estes termos, escreva para{' '}
        <a href="mailto:ewerttonherculano@gmail.com">ewerttonherculano@gmail.com</a>.
      </p>
    </LegalPage>
  );
}
