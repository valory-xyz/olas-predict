import { Dropdown, Flex } from 'antd';
import { ArrowRight, Menu as MenuIcon, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import styled from 'styled-components';

import { MENU_MAX_WIDTH } from 'constants/index';
import { LEADERBOARD_PATH } from 'constants/leaderboard';
import { COLOR, MEDIA_QUERY } from 'constants/theme';
import { useDropdown } from 'hooks/useDropdown';
import type { RunYourOwnAgentLocation } from 'utils/analytics';

import { RunYourOwnAgentLink } from './RunYourOwnAgentLink';

const Card = styled(Flex)`
  max-width: ${MENU_MAX_WIDTH}px;
  border-radius: 12px;
  background: ${COLOR.BLACK_TRANSPARENT_20};
  backdrop-filter: blur(3px);
  will-change: backdrop-filter;
  padding: 24px;
`;

const MobileCard = styled(Flex).withConfig({
  shouldForwardProp: (prop) => !['isOpen'].includes(prop),
})<{ isOpen?: boolean }>`
  max-width: 100%;
  border-radius: ${({ isOpen }) => (isOpen ? '12px 12px 0 0' : '12px')};
  transition: border-radius 0.3s ease;
  background: ${COLOR.BLACK_TRANSPARENT_30};
  backdrop-filter: blur(3px);
  will-change: backdrop-filter;
  padding: 12px 24px;
  margin: 56px 0 40px;
  position: relative;
  z-index: 1050;
`;

const MobileCardContent = styled(MobileCard)`
  margin: -4px 0 0;
  border-radius: 0 0 12px 12px;

  ${MEDIA_QUERY.laptop} {
    font-size: 20px;
  }
`;

const Backdrop = styled.div.withConfig({
  shouldForwardProp: (prop) => !['isOpen'].includes(prop),
})<{ isOpen: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: ${COLOR.BLACK_TRANSPARENT_50};
  opacity: ${({ isOpen }) => (isOpen ? 1 : 0)};
  pointer-events: ${({ isOpen }) => (isOpen ? 'auto' : 'none')};
  backdrop-filter: ${({ isOpen }) => (isOpen ? 'blur(10px)' : 'none')};
  -webkit-backdrop-filter: ${({ isOpen }) => (isOpen ? 'blur(10px)' : 'none')};
  will-change: backdrop-filter;
  transition: opacity 0.3s ease;
  z-index: 1000;
`;

const TopCard = styled(Flex)`
  align-self: center;
  margin: 56px 0 40px;
  padding: 8px 8px 8px 16px;
  border-radius: 12px;
  background: ${COLOR.BLACK_TRANSPARENT_20};
  backdrop-filter: blur(3px);
  will-change: backdrop-filter;

  .run-your-own-agent {
    padding: 6px 12px;
    border-radius: 8px;
    background: ${COLOR.WHITE_TRANSPARENT_10};
  }
`;

const MenuContent = ({
  location,
  closeDropdown,
}: {
  location: RunYourOwnAgentLocation;
  closeDropdown?: () => void;
}) => (
  <>
    <Link href={'/questions'} onClick={closeDropdown}>
      Questions
    </Link>
    <Link href={'/agents'} onClick={closeDropdown}>
      Agents
    </Link>
    <Link href={LEADERBOARD_PATH} onClick={closeDropdown}>
      Leaderboard
    </Link>
    <RunYourOwnAgentLink
      location={location}
      target="_blank"
      className="flex items-center"
      href=" https://olas.network/operate"
      onClick={closeDropdown}
    >
      Run your own agent <ArrowRight className="ml-4" size={20} />
    </RunYourOwnAgentLink>
  </>
);

export const Menu = () => {
  return (
    <Card vertical gap={16}>
      <Image src={'/images/predict.svg'} width={40} height={40} alt="Predict icon" />
      <MenuContent location="side_menu" />
    </Card>
  );
};

/** Horizontal desktop menu, used by pages laid out without the side menu (the leaderboard) */
export const TopMenu = () => (
  <TopCard align="center" gap={24} wrap="wrap" justify="center">
    <Image src={'/images/predict.svg'} width={32} height={32} alt="Predict icon" />
    <Link href={'/questions'}>Questions</Link>
    <Link href={'/agents'}>Agents</Link>
    <Link href={LEADERBOARD_PATH}>Leaderboard</Link>
    <RunYourOwnAgentLink
      location="top_menu"
      target="_blank"
      className="flex items-center run-your-own-agent"
      href="https://olas.network/operate"
    >
      Run your own agent <ArrowRight className="ml-4" size={16} />
    </RunYourOwnAgentLink>
  </TopCard>
);

export const MobileMenu = () => {
  const { isOpen, toggleDropdown, closeDropdown } = useDropdown();

  return (
    <>
      <Dropdown
        open={isOpen}
        onOpenChange={toggleDropdown}
        dropdownRender={() => (
          <MobileCardContent vertical gap={16}>
            <MenuContent location="mobile_menu" closeDropdown={closeDropdown} />
          </MobileCardContent>
        )}
      >
        <MobileCard vertical gap={16} isOpen={isOpen}>
          <Flex align="center" justify="space-between">
            <Image src={'/images/predict.svg'} width={40} height={40} alt="Predict icon" />
            {isOpen ? <X /> : <MenuIcon />}
          </Flex>
        </MobileCard>
      </Dropdown>
      <Backdrop isOpen={isOpen} onClick={closeDropdown} />
    </>
  );
};
