import { print } from 'graphql';
import { gql } from 'graphql-request';

import { getMidnightUtcTimestampDaysAgo } from './time';

const REGISTRY_GRAPH_URL = process.env.NEXT_PUBLIC_REGISTRY_GRAPH_URL;

export const PREDICT_AGENT_IDS_FLAT: number[] = [13, 14, 25, 9, 26, 29, 37, 36, 33, 44, 46, 45];

export type MetricWithStatus<T> = {
  value: T;
  status: 'success' | 'error';
  error?: string;
};

export type DailyAgentPerformance = {
  dayTimestamp: string;
  activeMultisigCount: string | null;
};

export type DailyPredictPerformancesResponse = {
  dailyAgentPerformances: DailyAgentPerformance[] | null;
};

export const dailyPredictAgentsPerformancesQuery = gql`
  query DailyPredictPerformances($agentIds: [Int!]!, $timestamp_gt: Int!, $timestamp_lt: Int!) {
    dailyAgentPerformances(
      where: {
        and: [
          { agentId_in: $agentIds }
          { dayTimestamp_gt: $timestamp_gt }
          { dayTimestamp_lt: $timestamp_lt }
        ]
      }
      orderBy: dayTimestamp
      orderDirection: asc
      first: 1000
    ) {
      dayTimestamp
      activeMultisigCount
    }
    _meta {
      hasIndexingErrors
      block {
        number
      }
    }
  }
`;

export const REGISTRY_GRAPH_CLIENTS = {
  gnosis: {
    url: REGISTRY_GRAPH_URL || '',
  },
};

export async function executeGraphQLQuery<TResponse, TTransformed>(params: {
  client: { url: string };
  query: string | ReturnType<typeof gql>;
  variables: Record<string, unknown>;
  source: string;
  transform: (data: TResponse) => TTransformed;
}): Promise<MetricWithStatus<TTransformed>> {
  try {
    if (!params.client.url) {
      throw new Error('GraphQL client URL is not configured');
    }

    // Use fetch directly to see the raw response
    const queryString = typeof params.query === 'string' ? params.query : print(params.query);
    const response = await fetch(params.client.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: queryString,
        variables: params.variables,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GraphQL request failed with status ${response.status}: ${errorText}`);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      throw new Error('GraphQL endpoint returned 204 No Content');
    }

    const json = await response.json();

    // Check if response is a GraphQL error message (like "Not found")
    if (json.message && !json.data && !json.errors) {
      throw new Error(`GraphQL endpoint error: ${json.message}`);
    }

    // Check for GraphQL errors in the response
    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    // graphql-request returns data directly, but fetch returns { data: ... }
    const data = json.data as TResponse;

    if (data === undefined || data === null) {
      throw new Error('GraphQL query returned undefined or null data');
    }

    const transformed = params.transform(data);
    return {
      value: transformed,
      status: 'success',
    };
  } catch (error) {
    console.error(`Error executing GraphQL query from ${params.source}:`, error);
    return {
      value: null as TTransformed,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export const fetchPredictDaa7dAvg = async (): Promise<MetricWithStatus<number | null>> => {
  const timestamp_lt = getMidnightUtcTimestampDaysAgo(0);
  const timestamp_gt = getMidnightUtcTimestampDaysAgo(8);

  return executeGraphQLQuery<DailyPredictPerformancesResponse, number>({
    client: REGISTRY_GRAPH_CLIENTS.gnosis,
    query: dailyPredictAgentsPerformancesQuery,
    variables: {
      agentIds: PREDICT_AGENT_IDS_FLAT,
      timestamp_gt,
      timestamp_lt,
    },
    source: 'registry:gnosis',
    transform: (data) => {
      if (!data || !data.dailyAgentPerformances) {
        return 0;
      }
      const rows = data.dailyAgentPerformances || [];
      const totalsByDay = new Map<string, number>();

      rows.forEach((r) => {
        const key = new Date(Number(r.dayTimestamp) * 1000).toISOString().slice(0, 10);
        const prev = totalsByDay.get(key) || 0;
        totalsByDay.set(key, prev + Number(r.activeMultisigCount || 0));
      });

      const dayKeys = [];
      for (let i = 7; i >= 1; i -= 1) {
        const ts = timestamp_lt - i * 24 * 60 * 60;
        dayKeys.push(new Date(ts * 1000).toISOString().slice(0, 10));
      }

      const total = dayKeys.reduce((acc, k) => acc + (totalsByDay.get(k) || 0), 0);
      return Math.floor(total / 7);
    },
  });
};
