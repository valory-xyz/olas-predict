import {
  ACHIEVEMENT_TYPES,
  AGENTS,
  POLYGON_SCAN_URL,
  getPearlAgentUrlWithUTM,
} from 'constants/index';
import { usePolystratBet } from 'hooks/usePolystratBet';

import { PayoutCard } from '../shared/PayoutCard';

type PayoutInnerProps = {
  betId: string;
};

export const PayoutInner = ({ betId }: PayoutInnerProps) => {
  const { data, isLoading, error } = usePolystratBet(betId);

  return (
    <PayoutCard
      data={data}
      error={!!error}
      loading={isLoading}
      agentName="Polystrat"
      venueName="Polymarket"
      explorerUrl={POLYGON_SCAN_URL}
      pearlUrl={getPearlAgentUrlWithUTM(AGENTS.POLYSTRAT, ACHIEVEMENT_TYPES.PAYOUT)}
      iconPath="/images/polystrat-icon.png"
      iconAlt="Polystrat"
      plausibleEventName="Get+Your+Polystrat+Agent"
    />
  );
};

export const Payout = ({ betId }: PayoutInnerProps) => <PayoutInner betId={betId} />;
