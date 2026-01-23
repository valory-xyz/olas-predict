import { Button, Card, Divider, Flex, Typography } from 'antd';
import { useRouter } from 'next/router';
import styled from 'styled-components';

const { Title, Text, Link } = Typography;

const ACHIEVEMENT_COLORS = {
  background: '#3F2565',
  backgroundDark: '#2B194A',
  border: 'rgba(255, 255, 255, 0.1)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.5)',
  accent: '#1AFF7B',
  accentLight: 'rgba(26, 255, 123, 0.1)',
  softLight: 'rgba(255, 255, 255, 0.8)',
};

const ExternalLinkIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    fill="none"
    viewBox="0 0 16 16"
  >
    <path
      fill="currentColor"
      d="M1.334 12.667V3.333a2 2 0 0 1 2-2h4a.667.667 0 0 1 0 1.334h-4a.667.667 0 0 0-.667.666v9.334a.666.666 0 0 0 .667.666h9.333a.666.666 0 0 0 .667-.666v-4a.667.667 0 0 1 1.333 0v4a2 2 0 0 1-2 2H3.334a2 2 0 0 1-2-2M14.667 6a.667.667 0 1 1-1.333 0V3.61L8.472 8.47a.667.667 0 1 1-.943-.942l4.862-4.862H10a.667.667 0 1 1 0-1.334h4c.367 0 .666.299.666.667z"
    />
  </svg>
);

const AchievementContainer = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background-color: ${ACHIEVEMENT_COLORS.backgroundDark};
  background-image: url('/images/background.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
`;

const DUMMY_ACHIEVEMENT_DATA = {
  title: 'Successful prediction',
  agentName: 'Polystrat',
  platform: 'Polymarket',
  platformUrl: 'https://polymarket.com',
  question: 'Does Google have the best AI model end of January?',
  position: 'Yes',
  amount: '$1.0',
  won: '$2.4',
  multiplier: '2.4x',
  ctaUrl: 'https://olas.network/operate',
};

const StatItem = ({ label, value }: { label: string; value: string }) => (
  <Flex vertical gap={4} style={{ maxWidth: 155, flex: 1 }}>
    <Text style={{ fontSize: 14, color: ACHIEVEMENT_COLORS.textSecondary }}>{label}</Text>
    <Text style={{ fontSize: 20, fontWeight: 600, color: ACHIEVEMENT_COLORS.textPrimary }}>
      {value}
    </Text>
  </Flex>
);

export const Payout = () => {
  const router = useRouter();
  const betId = router.query.betId as string;
  const data = DUMMY_ACHIEVEMENT_DATA;

  if (!router.isReady || !betId) return null;

  return (
    <AchievementContainer>
      <Card
        style={{
          background: ACHIEVEMENT_COLORS.background,
          border: `1px solid ${ACHIEVEMENT_COLORS.border}`,
          borderRadius: 20,
          padding: 0,
          maxWidth: 624,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}
        styles={{ body: { padding: 24 } }}
      >
        <Flex justify="space-between" align="flex-start" style={{ marginBottom: 18 }}>
          <Flex vertical gap={4}>
            <Title
              level={3}
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 500,
                color: ACHIEVEMENT_COLORS.textPrimary,
              }}
            >
              {data.title}
            </Title>
            <Link
              href={data.platformUrl}
              target="_blank"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14,
                color: ACHIEVEMENT_COLORS.textSecondary,
              }}
            >
              Made by Polystrat AI agent on {data.platform} <ExternalLinkIcon size={14} />
            </Link>
          </Flex>

          <div
            style={{
              background: ACHIEVEMENT_COLORS.accentLight,
              color: ACHIEVEMENT_COLORS.accent,
              fontSize: 32,
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 10,
            }}
          >
            {data.multiplier}
          </div>
        </Flex>

        <Card
          style={{
            background: ACHIEVEMENT_COLORS.backgroundDark,
            border: `1px solid ${ACHIEVEMENT_COLORS.border}`,
            borderRadius: 14,
            marginBottom: 24,
          }}
          styles={{ body: { padding: 0 } }}
        >
          <Text
            style={{
              display: 'block',
              padding: 20,
              fontSize: 16,
              fontWeight: 450,
              lineHeight: 1.5,
              color: ACHIEVEMENT_COLORS.textPrimary,
            }}
          >
            {data.question}
          </Text>

          <Divider style={{ margin: 0, marginBottom: 0, borderColor: ACHIEVEMENT_COLORS.border }} />

          <Flex gap={24} style={{ padding: 20 }}>
            <StatItem label="Position" value={data.position} />
            <StatItem label="Amount" value={data.amount} />
            <StatItem label="Won" value={data.won} />
          </Flex>
        </Card>

        <Flex justify="center">
          <Button
            type="default"
            size="large"
            href={data.ctaUrl}
            target="_blank"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 'auto',
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: 8,
              color: ACHIEVEMENT_COLORS.softLight,
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/polystrat-icon.png"
              alt="Polystrat"
              style={{ width: 28, height: 28, borderRadius: 6 }}
            />
            Get your own Polystrat <ExternalLinkIcon size={16} />
          </Button>
        </Flex>
      </Card>
    </AchievementContainer>
  );
};
