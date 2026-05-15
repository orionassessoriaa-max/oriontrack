import { redirect } from 'next/navigation';

export default function NovoGestorRedirectPage() {
  redirect('/admin/usuarios?tipo=gestor_trafego');
}
