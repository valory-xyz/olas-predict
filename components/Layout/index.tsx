import { Layout as AntdLayout } from 'antd';
import { useRouter } from 'next/router';
import { ReactNode } from 'react';
import styled from 'styled-components';

import { MENU_MAX_WIDTH } from 'constants/index';
import { LEADERBOARD_PATH } from 'constants/leaderboard';
import { BREAK_POINT, COLOR, MEDIA_QUERY } from 'constants/theme';
import { useScreen } from 'hooks/useScreen';

import { Footer } from './Footer';
import { Menu, MobileMenu } from './Menu';

const { Content, Sider } = AntdLayout;

export const CustomLayout = styled(AntdLayout).withConfig({
  shouldForwardProp: (prop) => !['isWide'].includes(prop),
})<{ isWide?: boolean }>`
  min-height: 100vh;
  padding: 0 24px;
  overflow: auto;
  background-color: ${COLOR.BACKGROUND};
  background-image: url('/images/background.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;

  .ant-layout {
    position: relative;
    background: transparent;
  }

  .ant-layout-sider {
    background: transparent;
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;
  }

  .ant-layout-content {
    display: flex;
    flex-direction: column;
  }

  .ant-layout.ant-layout-has-sider .ant-layout-content {
    left: -${MENU_MAX_WIDTH}px;
    margin-left: ${MENU_MAX_WIDTH}px;
    width: 100%;
    /* padding: 40px 0px; */ // uncomment when the beta banner is removed
    padding: 56px 0px 40px;
    min-height: 100vh;
    position: absolute;
  }

  ${MEDIA_QUERY.mobile} {
    padding: 0 16px;
  }

  /*
   * Without the sider the window scrolls, not this element; as a scroll container it would
   * still be the box sticky elements stick to, so the leaderboard's sticky header and pinned
   * rows would never stick. Clipping keeps the horizontal clipping without that.
   */
  ${({ isWide }) =>
    isWide &&
    `
    @media (max-width: ${parseInt(BREAK_POINT.xl, 10) - 1}px) {
      overflow: visible;
      overflow-x: clip;
    }
  `}
`;

const LEADERBOARD_MAX_WIDTH = 1200;
/** Space kept on the left of the leaderboard for the fixed menu, from the content box edge */
const MENU_CLEARANCE = MENU_MAX_WIDTH + 16;

const ContentInner = styled.div.withConfig({
  shouldForwardProp: (prop) => !['isWide', 'hasSider'].includes(prop),
})<{ isWide: boolean; hasSider: boolean }>`
  display: flex;
  flex-direction: column;
  flex: auto;
  margin: 0 auto;
  max-width: ${({ isWide }) => (isWide ? `${LEADERBOARD_MAX_WIDTH}px` : '720px')};
  width: 100%;

  /* The wide leaderboard is centred when there is room, otherwise it keeps clear of the menu */
  ${({ isWide, hasSider }) =>
    isWide &&
    hasSider &&
    `
    max-width: none;
    width: min(${LEADERBOARD_MAX_WIDTH}px, calc(100% - ${MENU_CLEARANCE}px));
    margin-left: max(${MENU_CLEARANCE}px, calc((100% - ${LEADERBOARD_MAX_WIDTH}px) / 2));
    margin-right: 0;
  `}
`;

const BetaBanner = styled.div`
  background: ${COLOR.WHITE_TRANSPARENT_20};
  padding: 10px;
  text-align: center;
  position: absolute;
  top: 0;
  left: -24px;
  right: -24px;
`;

type LayoutProps = {
  children?: ReactNode;
};

export const Layout = ({ children }: LayoutProps) => {
  const { isDesktop } = useScreen();
  const { pathname } = useRouter();
  const isWide = pathname === LEADERBOARD_PATH;

  return (
    <CustomLayout isWide={isWide}>
      <AntdLayout hasSider={isDesktop}>
        {isDesktop && (
          <Sider width={MENU_MAX_WIDTH}>
            <Menu />
          </Sider>
        )}
        <Content>
          <ContentInner isWide={isWide} hasSider={!!isDesktop}>
            <BetaBanner>Beta</BetaBanner>
            {!isDesktop && <MobileMenu />}
            {children}
          </ContentInner>
          <Footer />
        </Content>
      </AntdLayout>
    </CustomLayout>
  );
};
