import TeamRoleListPage from '@/components/admin/TeamRoleListPage';

export default function AdminAccountsPage() {
  return (
    <TeamRoleListPage
      role="account_manager"
      title="Accounts"
      description="Gerencie os acessos do time de relacionamento, inbox e relatórios rápidos."
      newLabel="Novo Account"
      emptyTitle="Nenhum account encontrado"
      emptyDescription="Cadastre um account para acompanhar comunicação e interações."
      panelHref="/account"
    />
  );
}
