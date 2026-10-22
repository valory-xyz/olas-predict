import { usePlausible } from 'next-plausible';
import { useCallback } from 'react';

import { AnalyticsEventName, AnalyticsEvents, PlausibleFn, trackEvent } from 'utils/analytics';

/** `trackEvent` bound to next-plausible's `usePlausible` and the current page */
export const useTrackEvent = () => {
  const plausible = usePlausible();
  return useCallback(
    <E extends AnalyticsEventName>(eventName: E, props: AnalyticsEvents[E]) =>
      trackEvent(plausible as PlausibleFn, eventName, props, window.location),
    [plausible],
  );
};
