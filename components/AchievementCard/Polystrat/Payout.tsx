import { Button as AntdButton, Card as AntdCard, Divider, Flex, Spin, Typography } from 'antd';
import { useRouter } from 'next/router';
import styled from 'styled-components';

import { ExternalLinkIcon } from 'components/shared/ExternalLinkIcon';
import { PEARL_WEBSITE_URL, POLYGON_SCAN_URL } from 'constants/index';
import { ACHIEVEMENT_COLORS } from 'constants/theme';
import { usePolymarketBet } from 'hooks/usePolymarketBet';

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
`;

const AchievementCard = styled(AntdCard)`
  background: ${ACHIEVEMENT_COLORS.BACKGROUND} !important;
  border: 1px solid ${ACHIEVEMENT_COLORS.BORDER} !important;
  border-radius: 20px !important;
  max-width: 624px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
`;

const MarketCard = styled(AntdCard)`
  background: ${ACHIEVEMENT_COLORS.BACKGROUND_DARK};
  border: 1px solid ${ACHIEVEMENT_COLORS.BORDER};
  border-radius: 14px;
  margin-bottom: 24px;
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

const StatItem = ({ label, value }: { label: string; value: string }) => (
  <Flex vertical gap={4} style={{ maxWidth: 155, flex: 1 }}>
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
  </Flex>
);

export const Payout = () => {
  const router = useRouter();
  const betId = router.query.betId as string;
  const { data, isLoading, error } = usePolymarketBet(betId);

  if (!router.isReady || !betId) return null;

  if (isLoading) {
    return (
      <AchievementContainer>
        <AchievementCard
          style={{
            padding: 0,
            minHeight: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spin size="large" />
        </AchievementCard>
      </AchievementContainer>
    );
  }

  if (error || !data) {
    return (
      <AchievementContainer>
        <AchievementCard style={{ padding: 24 }}>
          <Text style={{ color: ACHIEVEMENT_COLORS.TEXT_PRIMARY }}>
            {error ? 'Failed to load achievement data' : 'No data available'}
          </Text>
        </AchievementCard>
      </AchievementContainer>
    );
  }

  return (
    <AchievementContainer>
      <AchievementCard style={{ padding: 0 }} styles={{ body: { padding: 24 } }}>
        <Flex justify="space-between" align="flex-start" style={{ marginBottom: 18 }}>
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
              href={`${POLYGON_SCAN_URL}/tx/${data.transactionHash}`}
              target="_blank"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                color: ACHIEVEMENT_COLORS.TEXT_SECONDARY,
              }}
            >
              Made by Polystrat AI agent on Polymarket <ExternalLinkIcon size={14} />
            </Link>
          </Flex>

          <div
            style={{
              background: ACHIEVEMENT_COLORS.ACCENT_LIGHT,
              color: ACHIEVEMENT_COLORS.ACCENT,
              fontSize: 32,
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 10,
            }}
          >
            {data.multiplier}x
          </div>
        </Flex>

        <MarketCard styles={{ body: { padding: 0 } }}>
          <Text
            style={{
              display: 'block',
              padding: 20,
              fontSize: 16,
              fontWeight: 450,
              lineHeight: 1.5,
              color: ACHIEVEMENT_COLORS.TEXT_PRIMARY,
            }}
          >
            {data.question}
          </Text>

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
          <Button type="default" size="large" href={PEARL_WEBSITE_URL} target="_blank">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/polystrat-icon.png"
              alt="Polystrat"
              style={{ width: 28, height: 28, borderRadius: 6 }}
            />
            Get your own Polystrat <ExternalLinkIcon size={16} />
          </Button>
        </Flex>
      </AchievementCard>
    </AchievementContainer>
  );
};
