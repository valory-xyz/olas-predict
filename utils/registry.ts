import { getDailyPredictAgentsPerformancesQuery } from 'graphql/queries';

import { getMidnightUtcTimestampDaysAgo } from './time';

const REGISTRY_GRAPH_URL = process.env.NEXT_PUBLIC_REGISTRY_GRAPH_URL;

export const PREDICT_AGENT_IDS_FLAT: number[] = [13, 14, 25, 9, 26, 29, 37, 36, 33, 44, 46, 45];

export type DailyAgentPerformance = {
  dayTimestamp: string;
  activeMultisigCount: string | null;
};

const calculate7DayAverage = (items: Array<{ count: number }>) => {
  if (!items || items.length === 0) return 0;
  const total = items.reduce((sum, item) => sum + (item.count ?? 0), 0);
  return total / 7;
};

export type DailyPredictPerformancesResponse = {
  dailyAgentPerformances: DailyAgentPerformance[] | null;
};

export const fetchPredictDaa7dAvg = async (): Promise<number | null> => {
  try {
    if (!REGISTRY_GRAPH_URL) {
      throw new Error('GraphQL client URL is not configured');
    }

    const timestamp_lt = getMidnightUtcTimestampDaysAgo(0);
    const timestamp_gt = getMidnightUtcTimestampDaysAgo(8);

    const response = await fetch(REGISTRY_GRAPH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: getDailyPredictAgentsPerformancesQuery,
        variables: {
          agentIds: PREDICT_AGENT_IDS_FLAT,
          timestamp_gt,
          timestamp_lt,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GraphQL request failed with status ${response.status}: ${errorText}`);
    }

    if (response.status === 204) {
      throw new Error('GraphQL endpoint returned 204 No Content');
    }

    const json = await response.json();

    if (json.message && !json.data && !json.errors) {
      throw new Error(`GraphQL endpoint error: ${json.message}`);
    }

    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    const data = json.data as DailyPredictPerformancesResponse;

    if (!data || !data.dailyAgentPerformances) {
      return 0;
    }

    const rows = data.dailyAgentPerformances;
    const totalsByDay = new Map<string, number>();

    rows.forEach((r) => {
      const key = new Date(Number(r.dayTimestamp) * 1000).toISOString().slice(0, 10);
      const prev = totalsByDay.get(key) || 0;
      totalsByDay.set(key, prev + Number(r.activeMultisigCount || 0));
    });

    const dayKeys = Array.from({ length: 7 }, (_, i) => {
      const ts = timestamp_lt - (7 - i) * 24 * 60 * 60;
      return new Date(ts * 1000).toISOString().slice(0, 10);
    });

    const dailyTotals = dayKeys.map((dayKey) => ({
      count: totalsByDay.get(dayKey) || 0,
    }));

    const average = calculate7DayAverage(dailyTotals);

    return Math.floor(average);
  } catch (error) {
    console.error('Error fetching predict DAA 7d avg:', error);
    return null;
  }
};
