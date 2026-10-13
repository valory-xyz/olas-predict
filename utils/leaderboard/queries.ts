/**
 * GraphQL documents of the leaderboard builder (server-side only, used by `sources.ts`). Kept
 * apart from `graphql/queries.ts` so the builder loads under the test runner without the
 * generated GraphQL types.
 *
 * Omen queries use the subgraph dialect against the agent's predict-omen deployment;
 * Polymarket queries use the squid's OpenReader dialect.
 */
import { gql } from 'graphql-request';

export const leaderboardOmenTraderAgentsQuery = gql`
  query LeaderboardOmenTraderAgents($idGt: Bytes!) {
    traderAgents(first: 1000, orderBy: id, orderDirection: asc, where: { id_gt: $idGt }) {
      id
      serviceId
    }
    _meta {
      block {
        number
      }
    }
  }
`;

export const leaderboardOmenDailyStatisticsQuery = gql`
  query LeaderboardOmenDailyStatistics($dateGte: BigInt!, $dateLt: BigInt!, $idGt: ID!) {
    dailyProfitStatistics(
      first: 1000
      orderBy: id
      orderDirection: asc
      where: { date_gte: $dateGte, date_lt: $dateLt, id_gt: $idGt }
    ) {
      id
      date
      traderAgent {
        id
      }
      totalBets
      totalTraded
      dailyTradedSettled
      dailyFeesSettled
      dailyProfit
      brierSum
      brierCount
      profitParticipants {
        id
        question
      }
    }
  }
`;

export const leaderboardOmenBetsQuery = gql`
  query LeaderboardOmenBets($bettor: String!, $markets: [String!]!, $idGt: ID!) {
    bets(
      first: 1000
      orderBy: id
      orderDirection: asc
      where: { bettor: $bettor, fixedProductMarketMaker_in: $markets, id_gt: $idGt }
    ) {
      id
      outcomeIndex
      amount
      feeAmount
      fixedProductMarketMaker {
        id
      }
    }
  }
`;

export const leaderboardOmenFinalizationQuery = gql`
  query LeaderboardOmenFinalization($ids: [ID!]!) {
    fixedProductMarketMakers(first: 1000, where: { id_in: $ids }) {
      id
      currentAnswer
      answerFinalizedTimestamp
      isPendingArbitration
    }
  }
`;

export const leaderboardPolymarketTraderAgentsQuery = gql`
  query LeaderboardPolymarketTraderAgents($idGt: String!) {
    traderAgents(limit: 1000, orderBy: id_ASC, where: { id_gt: $idGt }) {
      id
      serviceId
    }
    squidStatus {
      height
    }
  }
`;

export const leaderboardPolymarketDailyStatisticsQuery = gql`
  query LeaderboardPolymarketDailyStatistics($dateGte: BigInt!, $idGt: String!) {
    dailyProfitStatistics(
      limit: 1000
      orderBy: id_ASC
      where: { date_gte: $dateGte, id_gt: $idGt }
    ) {
      id
      date
      traderAgentId
      totalBets
      totalTraded
      dailyTradedSettled
      dailyProfit
      brierSum
      brierCount
      profitParticipants
    }
  }
`;

export const leaderboardPolymarketQuestionsQuery = gql`
  query LeaderboardPolymarketQuestions($ids: [String!]!) {
    questions(limit: 1000, where: { id_in: $ids }) {
      id
      metadata {
        title
      }
      resolution {
        winningIndex
      }
    }
  }
`;

export const leaderboardPolymarketBetsQuery = gql`
  query LeaderboardPolymarketBets($bettor: String!, $questions: [String!]!, $idGt: String!) {
    bets(
      limit: 1000
      orderBy: id_ASC
      where: { bettorId_eq: $bettor, questionId_in: $questions, id_gt: $idGt }
    ) {
      id
      outcomeIndex
      amount
      questionId
    }
  }
`;

export const leaderboardMechRequestsQuery = gql`
  query LeaderboardMechRequests($sender: String!, $timestampGt: BigInt!) {
    requests(
      first: 1000
      orderBy: blockTimestamp
      orderDirection: asc
      where: { sender: $sender, blockTimestamp_gt: $timestampGt }
    ) {
      id
      blockTimestamp
      parsedRequest {
        questionTitle
      }
    }
  }
`;

/** The rest of one timestamp's requests, for a page that ended inside that timestamp */
export const leaderboardMechRequestsAtQuery = gql`
  query LeaderboardMechRequestsAt($sender: String!, $timestamp: BigInt!, $idGt: ID!) {
    requests(
      first: 1000
      orderBy: id
      orderDirection: asc
      where: { sender: $sender, blockTimestamp: $timestamp, id_gt: $idGt }
    ) {
      id
      blockTimestamp
      parsedRequest {
        questionTitle
      }
    }
  }
`;
