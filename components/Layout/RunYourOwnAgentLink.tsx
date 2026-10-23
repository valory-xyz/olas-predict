import { useRouter } from 'next/router';
import type { AnchorHTMLAttributes } from 'react';

import { useTrackEvent } from 'hooks/useTrackEvent';
import type { RunYourOwnAgentLocation } from 'utils/analytics';

type RunYourOwnAgentLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  location: RunYourOwnAgentLocation;
};

/** A "Run your own agent" link that tracks the click: where it was and on which page */
export const RunYourOwnAgentLink = ({
  location,
  onClick,
  children,
  ...props
}: RunYourOwnAgentLinkProps) => {
  const { pathname } = useRouter();
  const trackEvent = useTrackEvent();
  return (
    <a
      {...props}
      onClick={(event) => {
        trackEvent('Run Your Own Agent', { location, page: pathname });
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
};
