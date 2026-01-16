/**
 *
 * @param ms timestamp in ms
 * @returns time in format "10:15 am July 26, 2024"
 */
export const formatTimestamp = (ms: number) => {
  const date = new Date(ms);

  // get hours and minutes, and determine AM/PM
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12; // convert to 12-hour format

  const formattedDate = date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `${hours}:${minutes} ${ampm} ${formattedDate}`;
};

/**
 *
 * @param ms timestamp in ms
 * @returns time in format "12 days ago" or "5 hours ago"
 */
export const getTimeAgo = (ms: number, showPostfix: boolean = true) => {
  const differenceInMs = Date.now() - ms;

  // Calculate time differences
  const differenceInMinutes = Math.floor(differenceInMs / (1000 * 60));
  const differenceInHours = Math.floor(differenceInMinutes / 60);
  const differenceInDays = Math.floor(differenceInHours / 24);
  const differenceInMonths = Math.floor(differenceInDays / 30); // Approximate months

  const postfix = showPostfix ? ` ago` : '';

  if (differenceInMonths > 0) {
    return `${differenceInMonths} month${differenceInMonths > 1 ? 's' : ''}${postfix}`;
  } else if (differenceInDays > 0) {
    return `${differenceInDays} day${differenceInDays > 1 ? 's' : ''}${postfix}`;
  } else if (differenceInHours > 0) {
    return `${differenceInHours} hour${differenceInHours > 1 ? 's' : ''}${postfix}`;
  } else {
    return `${differenceInMinutes} minute${differenceInMinutes > 1 ? 's' : ''}${postfix}`;
  }
};

/** @returns the timestamp for 00:00 UTC N days ago */
export const getMidnightUtcTimestampDaysAgo = (daysAgo: number): number => {
  const now = new Date();
  const utcMidnightToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const timestamp = Math.floor((utcMidnightToday - daysAgo * 24 * 60 * 60 * 1000) / 1000);
  return timestamp;
};
