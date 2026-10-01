import { Button as AntdButton, Card as AntdCard, Divider, Flex, Typography } from 'antd';
import Image from 'next/image';
import styled, { css } from 'styled-components';

import { ExternalLinkIcon } from 'components/shared/ExternalLinkIcon';
import { ACHIEVEMENT_COLORS, MEDIA_QUERY } from 'constants/theme';
import type { AchievementData } from 'types/achievement';

const { Title, Text, Link } = Typography;

const AchievementContainer = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background-color: ${ACHIEVEMENT_COLORS.BACKGROUND_DARK};
  background-image: url('/images/background.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;

  ${MEDIA_QUERY.mobile} {
    padding: 16px;
  }
`;

const achievementCardStyles = css`
  background: ${ACHIEVEMENT_COLORS.BACKGROUND} !important;
  border: 1px solid ${ACHIEVEMENT_COLORS.BORDER} !important;
  border-radius: 20px !important;
  max-width: 624px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
`;

const AchievementCardFrame = styled(AntdCard)`
  ${achievementCardStyles}
`;

const Multiplier = styled.div`
  background: ${ACHIEVEMENT_COLORS.ACCENT_LIGHT};
  color: ${ACHIEVEMENT_COLORS.ACCENT};
  font-size: 32px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 10px;
  white-space: nowrap;

  ${MEDIA_QUERY.mobile} {
    font-size: 24px;
    padding: 4px 10px;
  }
`;

const MarketCard = styled(AntdCard)`
  background: ${ACHIEVEMENT_COLORS.BACKGROUND_DARK};
  border: 1px solid ${ACHIEVEMENT_COLORS.BORDER};
  border-radius: 14px;
  margin-bottom: 24px;
`;

const CardHeader = styled(Flex)`
  margin-bottom: 18px;
  justify-content: space-between;
  align-items: flex-start;

  ${MEDIA_QUERY.mobile} {
    gap: 10px;
    text-align: center;
    align-items: center;
    flex-direction: column-reverse;
  }
`;

const Button = styled(AntdButton)`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: auto;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 8px;
  color: ${ACHIEVEMENT_COLORS.SOFT_LIGHT};
  font-size: 16px;
  font-weight: 500;
`;

const StatItemWrapper = styled(Flex)`
  max-width: 155px;
  flex: 1;

  ${MEDIA_QUERY.mobile} {
    max-width: none;
  }
`;

const StatItem = ({ label, value }: { label: string; value: string }) => (
  <StatItemWrapper vertical gap={4}>
    <Text style={{ fontSize: 14, color: ACHIEVEMENT_COLORS.TEXT_SECONDARY }}>{label}</Text>
    <Text
      style={{
        fontSize: 20,
        fontWeight: 600,
        color: ACHIEVEMENT_COLORS.TEXT_PRIMARY,
      }}
    >
      {value}
    </Text>
  </StatItemWrapper>
);

type PayoutCardProps = {
  data: AchievementData | null;
  error: boolean;
  agentName: string;
  venueName: string;
  explorerUrl: string;
  pearlUrl: string;
  iconPath: string;
  iconAlt: string;
  plausibleEventName: string;
};

export const PayoutCard = ({
  data,
  error,
  agentName,
  venueName,
  explorerUrl,
  pearlUrl,
  iconPath,
  iconAlt,
  plausibleEventName,
}: PayoutCardProps) => {
  if (!data) {
    return (
      <AchievementContainer>
        <AchievementCardFrame style={{ padding: 24 }}>
          <Text style={{ color: ACHIEVEMENT_COLORS.TEXT_PRIMARY }}>
            {error ? 'Failed to load achievement data' : 'No data available'}
          </Text>
        </AchievementCardFrame>
      </AchievementContainer>
    );
  }

  return (
    <AchievementContainer>
      <AchievementCardFrame style={{ padding: 0 }} styles={{ body: { padding: 24 } }}>
        <CardHeader>
          <Flex vertical gap={4}>
            <Title
              level={3}
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 500,
                color: ACHIEVEMENT_COLORS.TEXT_PRIMARY,
              }}
            >
              Successful prediction
            </Title>
            <Link
              href={`${explorerUrl}/tx/${data.transactionHash}`}
              target="_blank"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                color: ACHIEVEMENT_COLORS.TEXT_SECONDARY,
              }}
              rel="noopener noreferrer"
            >
              Made by {agentName} AI agent on {venueName} <ExternalLinkIcon size={14} />
            </Link>
          </Flex>

          <Multiplier>{data.multiplier}x</Multiplier>
        </CardHeader>

        <MarketCard styles={{ body: { padding: 0 } }}>
          <Flex align="center" gap={12} style={{ padding: 20 }}>
            <Text
              style={{
                display: 'block',
                fontSize: 16,
                fontWeight: 450,
                lineHeight: 1.5,
                color: ACHIEVEMENT_COLORS.TEXT_PRIMARY,
              }}
            >
              {data.question}
            </Text>
          </Flex>

          <Divider
            style={{
              margin: 0,
              borderColor: ACHIEVEMENT_COLORS.BORDER,
            }}
          />

          <Flex gap={24} style={{ padding: 20 }}>
            <StatItem label="Position" value={data.position} />
            <StatItem label="Amount" value={data.betAmountFormatted} />
            <StatItem label="Won" value={data.amountWonFormatted} />
          </Flex>
        </MarketCard>

        <Flex justify="center">
          <Button
            type="default"
            size="large"
            href={pearlUrl}
            target="_blank"
            className={`plausible-event-name=${plausibleEventName}`}
            rel="noopener noreferrer"
          >
            <Image
              src={iconPath}
              alt={iconAlt}
              width={28}
              height={28}
              style={{ borderRadius: 6 }}
            />
            Get your own {agentName} <ExternalLinkIcon size={16} />
          </Button>
        </Flex>
      </AchievementCardFrame>
    </AchievementContainer>
  );
};
