import { useRouter } from 'next/router';
import { useCallback } from 'react';

import { RunYourOwnAgentLocation, useTrackEvent } from 'utils/analytics';

/** Click handler for a "Run your own agent" link: tracks where it was and on which page */
export const useTrackRunYourOwnAgent = (location: RunYourOwnAgentLocation) => {
  const { pathname } = useRouter();
  const trackEvent = useTrackEvent();
  return useCallback(
    () => trackEvent('Run Your Own Agent', { location, page: pathname }),
    [trackEvent, location, pathname],
  );
};
