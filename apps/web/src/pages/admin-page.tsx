import { useTranslation } from 'react-i18next';
import { InviteCodeSection } from '../admin/invite-code-section';
import { SignupInbox } from '../admin/signup-inbox';
import { usePageTitle } from '../components/use-page-title';

/**
 * Administración (boceto 13, doc 02 §3.10), primer trozo de `H5-acceso`: solicitudes de alta y código de invitación.
 * La lista de usuarios y los datos sensibles llegan con el resto de H5. Solo el administrador la abre (`RoleGate`); el servidor decide igualmente.
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
      <InviteCodeSection />
    </>
  );
}
