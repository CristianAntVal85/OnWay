import { useTranslation } from 'react-i18next';
import { InviteCodeSection } from '../admin/invite-code-section';
import { SignupInbox } from '../admin/signup-inbox';
import { UsersSection } from '../admin/users-section';
import { usePageTitle } from '../components/use-page-title';

/**
 * Administración (boceto 13, doc 02 §3.10), solicitudes de alta (`H5-acceso`), usuarios (`H5-usuarios`) y código de invitación.
 * Los datos sensibles llegan con el resto de H5. Solo el administrador la abre (`RoleGate`); el servidor decide igualmente.
 */
export function AdminPage() {
  const { t } = useTranslation();
  usePageTitle(t('nav.administration'));
  return (
    <>
      <div className="page-heading">
        <h1>{t('nav.administration')}</h1>
      </div>
      <SignupInbox />
      <UsersSection />
      <InviteCodeSection />
    </>
  );
}
