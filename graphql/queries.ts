import { gql, request } from 'graphql-request';

import {
  BROKEN_MARKETS,
  CONDITIONAL_TOKENS_SUBGRAPH_URL,
  CREATOR_ADDRESSES,
  GNOSIS_STAKING_SUBGRAPH_URL,
  INVALID_ANSWER_HEX,
  OLAS_AGENTS_SUBGRAPH_URL,
  OLAS_MECH_SUBGRAPH_URL,
  OMEN_SUBGRAPH_URL,
  OMEN_THUMBNAIL_MAPPING_SUBGRAPH_URL,
  POLYMARKET_SUBGRAPH_URL,
  XDAI_BLOCKS_SUBGRAPH_URL,
} from 'constants/index';
import { PolymarketBetResponse } from 'types/polymarket';

import {
  AgentsGlobal,
  CreatorAgents,
  FixedProductMarketMaker,
  FixedProductMarketMaker_Filter,
  FpmmTrade_Filter,
  GetMechSenderParams,
  MechAgents,
  MechSender,
  OmenThumbnailMapping,
  OpenMarketsQuestion,
  OutcomeTokenMarginalPricesResponse,
  Query,
  QueryConditionArgs,
  QueryFixedProductMarketMakerArgs,
  QueryFixedProductMarketMakersArgs,
  QueryFpmmLiquiditiesArgs,
  QueryFpmmTradesArgs,
  QueryUserPositionArgs,
  QueryUserPositionsArgs,
  Service,
  TraderAgent,
  TraderAgentBets,
  TraderAgents,
  UserPosition,
} from './types';

const marketDataFragment = gql`
  fragment marketData on FixedProductMarketMaker {
    id
    collateralVolume
    collateralToken
    creationTimestamp
    answerFinalizedTimestamp
    creator
    lastActiveDay
    outcomeTokenAmounts
    runningDailyVolumeByHour
    scaledLiquidityParameter
    title
    outcomes
    openingTimestamp
    arbitrator
    category
    templateId
    scaledLiquidityParameter
    curatedByDxDao
    klerosTCRregistered
    outcomeTokenMarginalPrices
    currentAnswer
    condition {
      id
      oracle
      scalarLow
      scalarHigh
      __typename
    }
    question {
      id
      data
      currentAnswer
      outcomes
      answers {
        answer
        bondAggregate
        __typename
      }
      __typename
    }
    outcomes
    outcomeTokenMarginalPrices
    usdVolume
    __typename
  }
`;

const getMarketsQuery = (
  params: QueryFixedProductMarketMakersArgs & FixedProductMarketMaker_Filter,
) => gql`
  query GetMarkets(
    $first: Int!
    $skip: Int!
    $openingTimestamp_gt: Int
    $answerFinalizedTimestamp_lt: Int
    $scaledLiquidityParameter_gt: Int
    $usdVolume_gt: Int
    $orderBy: String
    $orderDirection: String
  ) {
    fixedProductMarketMakers(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: {
        outcomeSlotCount: 2
        id_not_in: [${BROKEN_MARKETS.map((address) => `"${address}"`)}]
        creator_in: [${CREATOR_ADDRESSES.map((address) => `"${address}"`)}]
        ${params.openingTimestamp_gt ? 'openingTimestamp_gt: $openingTimestamp_gt' : ''}
        ${params.usdVolume_gt ? 'usdVolume_gt: $usdVolume_gt' : ''}
        ${
          params.answerFinalizedTimestamp_lt
            ? `
          answerFinalizedTimestamp_lt: $answerFinalizedTimestamp_lt,
          currentAnswer_not: "${INVALID_ANSWER_HEX}"
          `
            : ''
        }
        ${params.scaledLiquidityParameter_gt !== undefined ? 'scaledLiquidityParameter_gt: $scaledLiquidityParameter_gt' : ''}
      }
    ) {
      ...marketData
      __typename
    }
  }

  ${marketDataFragment}
`;

const getMarketTradesQuery = gql`
  query GetMarketUserTrades(
    $first: Int!
    $fpmm: ID!
    $skip: Int
    $orderBy: String
    $orderDirection: String
  ) {
    fpmmTrades(
      where: { fpmm: $fpmm }
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      creationTimestamp
      id
      outcomeIndex
      outcomeTokensTraded
      transactionHash
      collateralAmountUSD
      feeAmount
      type
      fpmm {
        outcomes
      }
      creator {
        id
      }
    }
  }
`;

const getMarketUserTradesQuery = gql`
  query GetMarketUserTrades($creator: ID!, $fpmm: ID!, $outcomeIndex_in: [BigInt!]) {
    fpmmTrades(where: { fpmm: $fpmm, creator: $creator, outcomeIndex_in: $outcomeIndex_in }) {
      creator {
        id
      }
      title
      outcomeIndex
      id
      feeAmount
      collateralAmount
      collateralAmountUSD
      collateralToken
      outcomeTokenMarginalPrice
      outcomeTokensTraded
      oldOutcomeTokenMarginalPrice
      transactionHash
      creationTimestamp
      type
    }
  }
`;

const getUserTradesQuery = gql`
  query GetUserTrades(
    $creator: ID!
    $first: Int!
    $skip: Int
    $orderBy: String
    $orderDirection: String
  ) {
    fpmmTrades(
      where: { creator: $creator }
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      creator {
        id
      }
      fpmm {
        id
        outcomes
      }
      title
      outcomeIndex
      id
      feeAmount
      collateralAmount
      collateralAmountUSD
      collateralToken
      outcomeTokenMarginalPrice
      outcomeTokensTraded
      oldOutcomeTokenMarginalPrice
      transactionHash
      creationTimestamp
      type
    }
  }
`;

const getMarketLiquidityQuery = gql`
  query GetMarketLiquidity(
    $first: Int!
    $fpmm: ID!
    $skip: Int
    $orderBy: String
    $orderDirection: String
  ) {
    fpmmLiquidities(
      where: { fpmm: $fpmm }
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      id
      outcomeTokenAmounts
      creationTimestamp
    }
  }
`;

const getMarginalPriceQuery = (blockNumbers: number[]) => gql`
  query MarginalPricesByBlockNumber($id: ID!, $block: Int) {
    ${blockNumbers.map(
      (block) => `_${block}: fixedProductMarketMaker(id: $id, block: { number: ${block} }) {
        outcomeTokenMarginalPrices
      }`,
    )}
  }
`;

const getMarketThumbnailQuery = gql`
  query GetOmenThumbnail($id: ID) {
    omenThumbnailMapping(id: $id) {
      image_hash
    }
  }
`;

const getMarketQuery = gql`
  query GetMarket($id: ID!) {
    fixedProductMarketMaker(id: $id) {
      ...marketData
      __typename
    }
  }

  ${marketDataFragment}
`;

const getBlocksQuery = (timestamps: number[]) => gql`
  query GetBlocks {
    ${timestamps.map(
      (timestamp) => `_${timestamp}: blocks(where: {timestamp: ${timestamp}}, first: 1) {
        number
      }`,
    )}
  }

  ${marketDataFragment}
`;

const getGlobalQuery = gql`
  query GetAgentsGlobal {
    global(id: "") {
      id
      totalActiveTraderAgents
    }
  }
`;

const getTraderAgentsQuery = gql`
  query GetOlasTraderAgents($first: Int!, $skip: Int!) {
    traderAgents(
      first: $first
      skip: $skip
      orderBy: totalBets
      orderDirection: desc
      where: { totalBets_gt: 0 }
    ) {
      id
      totalBets
    }
  }
`;

const getCreatorAgentsQuery = gql`
  query GetOlasCreatorAgents {
    creatorAgents(orderBy: totalQuestions, orderDirection: desc) {
      id
      totalQuestions
      blockTimestamp
    }
  }
`;

const getMechAgentsQuery = gql`
  {
    createMeches(first: 10, orderBy: agentId, order: ASC) {
      id
      mech
      agentId
    }
  }
`;

const getTraderAgentQuery = gql`
  query GetOlasTraderAgent($id: ID!) {
    traderAgent(id: $id) {
      id
      serviceId
      blockTimestamp
      firstParticipation
      totalBets
      totalTraded
      totalPayout
      totalFees
      bets(first: 1, orderBy: timestamp, orderDirection: desc) {
        timestamp
      }
    }
  }
`;

const getAgentLastTradeTimestampQuery = gql`
  query GetAgentLastTradeTimestamp($creator: ID!) {
    fpmmTrades(
      where: { creator: $creator }
      first: 1
      orderBy: creationTimestamp
      orderDirection: desc
    ) {
      id
      creationTimestamp
    }
  }
`;

const getUserPositionsQuery = gql`
  query OmenGetMyMarkets($id: ID!) {
    userPositions(
      where: { user_: { id: $id } }
      orderBy: position__createTimestamp
      orderDirection: desc
    ) {
      id
      balance
      totalBalance
      wrappedBalance
      user {
        firstParticipation
        lastActive
      }
      position {
        id
        activeValue
        conditionIdsStr
        indexSets
        multiplicities
        wrappedTokenAddress
        collateralTokenAddress
        createTimestamp
        collateralToken {
          activeAmount
          mergedAmount
          redeemedAmount
          splitAmount
        }
        conditions {
          id
          oracle
          outcomes
          outcomeSlotCount
          payouts
          payoutNumerators
          payoutDenominator
          questionId
          resolved
          resolveTimestamp
          resolveTransaction
          createTimestamp
        }
      }
    }
  }
`;

const getConditionMarketQuery = gql`
  query OmenConditionsQuery($id: ID!) {
    conditions(where: { id: $id }) {
      fixedProductMarketMakers {
        ...marketData
      }
    }
  }

  ${marketDataFragment}
`;

const getTraderAgentBetsQuery = gql`
  query GetOlasTraderAgentBets($id: ID!) {
    traderAgent(id: $id) {
      id
      bets(first: 1000, orderBy: timestamp, orderDirection: desc) {
        outcomeIndex
        fixedProductMarketMaker {
          id
          currentAnswer
        }
      }
    }
  }
`;

const getMechSenderQuery = gql`
  query MechSender($id: ID!, $timestamp_gt: Int!) {
    sender(id: $id) {
      totalRequests
      requests(first: 1000, where: { blockTimestamp_gt: $timestamp_gt }) {
        id
        questionTitle
      }
    }
  }
`;

const getOpenMarketsQuery = gql`
  query Fpmms($timestamp_gt: Int!) {
    questions(where: { fixedProductMarketMaker_: { blockTimestamp_gt: $timestamp_gt } }) {
      id
      question
    }
  }
`;

const getStakingServiceQuery = gql`
  query StakingService($id: ID!) {
    service(id: $id) {
      id
      olasRewardsEarned
    }
  }
`;

const getPolymarketBetQuery = gql`
  query GetPolymarketBet($id: ID!) {
    bet(id: $id) {
      transactionHash
      outcomeIndex
      amount
      bettor {
        id
      }
      question {
        id
        metadata {
          title
          outcomes
        }
      }
    }
  }
`;

const getPolymarketMarketParticipantQuery = gql`
  query GetPolymarketMarketParticipant($id: ID!) {
    marketParticipant(id: $id) {
      totalPayout
    }
  }
`;

export const getDailyPredictAgentsPerformancesQuery = gql`
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

export const getMarkets = async (
  params: QueryFixedProductMarketMakersArgs & FixedProductMarketMaker_Filter,
) =>
  request<Pick<Query, 'fixedProductMarketMakers'>>(
    OMEN_SUBGRAPH_URL,
    getMarketsQuery(params),
    params,
  );

export const getMarketTrades = async (params: QueryFpmmTradesArgs & FpmmTrade_Filter) =>
  request<Pick<Query, 'fpmmTrades'>>(OMEN_SUBGRAPH_URL, getMarketTradesQuery, params);

export const getMarketUserTrades = async (params: QueryFpmmTradesArgs & FpmmTrade_Filter) =>
  request<Pick<Query, 'fpmmTrades'>>(OMEN_SUBGRAPH_URL, getMarketUserTradesQuery, params);

export const getUserTrades = async (params: QueryFpmmTradesArgs & FpmmTrade_Filter) =>
  request<Pick<Query, 'fpmmTrades'>>(OMEN_SUBGRAPH_URL, getUserTradesQuery, params);

export const getMarketLiquidity = async (params: QueryFpmmLiquiditiesArgs & FpmmTrade_Filter) =>
  request<Pick<Query, 'fpmmLiquidities'>>(OMEN_SUBGRAPH_URL, getMarketLiquidityQuery, params);

export const getMarginalPrices = async (params: {
  id: FixedProductMarketMaker['id'];
  blockNumbers: number[];
}) =>
  request<OutcomeTokenMarginalPricesResponse>(
    OMEN_SUBGRAPH_URL,
    getMarginalPriceQuery(params.blockNumbers),
    { id: params.id },
  );

export const getMarketThumbnail = async (params: { id: FixedProductMarketMaker['id'] }) =>
  request<OmenThumbnailMapping>(
    OMEN_THUMBNAIL_MAPPING_SUBGRAPH_URL,
    getMarketThumbnailQuery,
    params,
  );

export const getMarket = async (params: QueryFixedProductMarketMakerArgs) =>
  request<Pick<Query, 'fixedProductMarketMaker'>>(OMEN_SUBGRAPH_URL, getMarketQuery, params);

export const getBlocksByTimestamps = async ({ timestamps }: { timestamps: number[] }) =>
  request<Record<string, { number: string }[]>>(
    XDAI_BLOCKS_SUBGRAPH_URL,
    getBlocksQuery(timestamps),
  );

export const getGlobal = async () =>
  request<AgentsGlobal>(OLAS_AGENTS_SUBGRAPH_URL, getGlobalQuery);

export const getTraderAgents = async (params: { first: number; skip: number }) =>
  request<TraderAgents>(OLAS_AGENTS_SUBGRAPH_URL, getTraderAgentsQuery, params);

export const getCreatorAgents = async () =>
  request<CreatorAgents>(OLAS_AGENTS_SUBGRAPH_URL, getCreatorAgentsQuery);

export const getMechAgents = async () =>
  request<MechAgents>(OLAS_MECH_SUBGRAPH_URL, getMechAgentsQuery);

export const getTraderAgent = async (params: { id: string }) =>
  request<{ traderAgent: TraderAgent | null }>(
    OLAS_AGENTS_SUBGRAPH_URL,
    getTraderAgentQuery,
    params,
  );

export const getAgentLastTradeTimestamp = async (params: { creator: string }) =>
  request<Pick<Query, 'fpmmTrades'>>(OMEN_SUBGRAPH_URL, getAgentLastTradeTimestampQuery, params);

export const getUserPositions = async (params: QueryUserPositionArgs & QueryUserPositionsArgs) =>
  request<{ userPositions: Array<UserPosition> }>(
    CONDITIONAL_TOKENS_SUBGRAPH_URL,
    getUserPositionsQuery,
    params,
  );

export const getConditionMarket = async (params: QueryConditionArgs) =>
  request<Pick<Query, 'conditions'>>(OMEN_SUBGRAPH_URL, getConditionMarketQuery, params);

export const getTraderAgentBets = async (params: { id: string }) =>
  request<{ traderAgent: TraderAgentBets | null }>(
    OLAS_AGENTS_SUBGRAPH_URL,
    getTraderAgentBetsQuery,
    params,
  );

export const getMechSender = async (params: GetMechSenderParams) =>
  request<{ sender: MechSender | null }>(OLAS_MECH_SUBGRAPH_URL, getMechSenderQuery, params);

export const getOpenMarkets = async (params: { timestamp_gt: number }) =>
  request<{ questions: OpenMarketsQuestion[] }>(
    OLAS_AGENTS_SUBGRAPH_URL,
    getOpenMarketsQuery,
    params,
  );

export const getStakingService = async (params: { id: string }) =>
  request<{ service: Service | null }>(GNOSIS_STAKING_SUBGRAPH_URL, getStakingServiceQuery, params);

const getPolyStratQueryHeaders = () => {
  // TODO: Remove this logic once we have the production URL
  if (!process.env.NEXT_PUBLIC_POLYMARKET_SUBGRAPH_API_KEY) {
    throw new Error('NEXT_PUBLIC_POLYMARKET_SUBGRAPH_API_KEY is not defined');
  }

  return {
    Authorization: `Bearer ${process.env.NEXT_PUBLIC_POLYMARKET_SUBGRAPH_API_KEY}`,
  };
};

export const getPolymarketBet = async (params: { id: string }) =>
  request<PolymarketBetResponse>(
    POLYMARKET_SUBGRAPH_URL,
    getPolymarketBetQuery,
    params,
    getPolyStratQueryHeaders(),
  );

export const getPolymarketMarketParticipant = async (params: { id: string }) =>
  request<{
    marketParticipant: {
      totalPayout: string;
    } | null;
  }>(
    POLYMARKET_SUBGRAPH_URL,
    getPolymarketMarketParticipantQuery,
    params,
    getPolyStratQueryHeaders(),
  );
