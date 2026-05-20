import TeamRoleListPage from '@/components/admin/TeamRoleListPage';

export default function AdminDesignersPage() {
  return (
    <TeamRoleListPage
      role="designer"
      title="Designers"
      description="Gerencie os acessos da equipe criativa e demandas de criativos."
      newLabel="Novo Designer"
      emptyTitle="Nenhum designer encontrado"
      emptyDescription="Cadastre um designer para organizar as demandas criativas."
      panelHref="/designer"
    />
  );
}
