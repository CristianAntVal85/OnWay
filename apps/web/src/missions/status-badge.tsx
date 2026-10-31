import { useTranslation } from 'react-i18next';
import type { MissionStatus } from '@onway/contracts';

/** Estado de la misión en texto (nunca solo con color) y con una marca de color por estado. */
export function StatusBadge({ status }: { status: MissionStatus }) {
  const { t } = useTranslation();
  return (
    <span className="status-badge" data-status={status}>
      {t(`missions.status.${status}`)}
    </span>
  );
}
