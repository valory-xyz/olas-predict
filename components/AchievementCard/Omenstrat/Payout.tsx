import {
  ACHIEVEMENT_TYPES,
  AGENTS,
  GNOSIS_BLOCKSCOUT_URL,
  getPearlAgentUrlWithUTM,
} from 'constants/index';
import { AchievementData } from 'types/achievement';

import { PayoutCard } from '../shared/PayoutCard';

type PayoutProps = {
  achievementData: AchievementData | null;
  achievementDataError: boolean;
};

export const Payout = ({ achievementData, achievementDataError }: PayoutProps) => (
  <PayoutCard
    data={achievementData}
    error={achievementDataError}
    agentName="Omenstrat"
    venueName="Omen Markets"
    explorerUrl={GNOSIS_BLOCKSCOUT_URL}
    pearlUrl={getPearlAgentUrlWithUTM(AGENTS.OMENSTRAT, ACHIEVEMENT_TYPES.PAYOUT)}
    iconPath="/images/omenstrat-icon.png"
    iconAlt="Omenstrat"
    plausibleEventName="Get+Your+Omenstrat+Agent"
  />
);
