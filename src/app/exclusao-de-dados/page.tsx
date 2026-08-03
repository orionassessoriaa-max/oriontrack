import type { Metadata } from 'next';
import LegalPage from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Exclusão de Dados | Orion Track',
  description: 'Instruções para solicitar a exclusão de dados do Orion Track.',
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Exclusão de Dados"
      description="O titular pode solicitar a exclusão dos dados associados ao Orion Track e às integrações autorizadas seguindo as instruções abaixo."
    >
      <h2>Como solicitar</h2>
      <ol>
        <li>
          Envie um e-mail para{' '}
          <a href="mailto:ewerttonherculano@gmail.com?subject=Solicitação%20de%20exclusão%20de%20dados%20-%20Orion%20Track">
            ewerttonherculano@gmail.com
          </a>{' '}
          com o assunto <strong>“Solicitação de exclusão de dados — Orion Track”</strong>.
        </li>
        <li>Informe seu nome completo e o e-mail ou telefone utilizado na plataforma.</li>
        <li>Se a solicitação estiver relacionada à Meta, informe também o nome da conta, Página ou empresa conectada. Não envie senhas nem tokens de acesso.</li>
        <li>Aguarde a confirmação de recebimento e, se necessário, conclua a validação de identidade solicitada para proteger seus dados.</li>
      </ol>

      <h2>O que acontece depois</h2>
      <p>
        Após a validação, localizaremos os dados associados à solicitação e realizaremos a exclusão ou anonimização das informações elegíveis. Também revogaremos vínculos e credenciais de integrações sob nosso controle quando isso fizer parte do pedido.
      </p>
      <p>
        Alguns registros poderão ser preservados quando necessários para cumprimento de obrigação legal, prevenção de fraude, segurança, auditoria ou exercício regular de direitos. Nesse caso, o titular será informado sobre a justificativa aplicável.
      </p>

      <h2>Prazo e confirmação</h2>
      <p>
        A solicitação será tratada nos prazos aplicáveis da LGPD. Ao final do processo, enviaremos uma confirmação ao canal de contato validado pelo titular.
      </p>

      <h2>Desconectar a Meta</h2>
      <p>
        Além da solicitação acima, o usuário pode remover o acesso do Orion Track nas configurações de integrações comerciais da própria Meta. A desconexão impede novos acessos, mas não substitui uma solicitação de exclusão de dados já armazenados no Orion Track.
      </p>

      <h2>Privacidade</h2>
      <p>
        Para entender quais dados são tratados e para quais finalidades, consulte nossa{' '}
        <a href="/privacidade">Política de Privacidade</a>.
      </p>
    </LegalPage>
  );
}
