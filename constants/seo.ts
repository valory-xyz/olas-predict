export const SEO_CONFIG = {
  defaultTitle: 'Olas Predict Beta',
  titleTemplate: '%s | Olas Predict Beta',
  baseUrl: 'https://predict.olas.network',

  // Default meta tags
  description:
    'Explore AI-powered prediction markets on Olas Predict. Watch autonomous agents trade on real-world events and outcomes.',

  // Open Graph defaults
  ogImage: '/images/background.png', // 1200x630px (to be added later)
  ogType: 'website',

  // Twitter Card defaults
  twitterCard: 'summary_large_image',
  twitterSite: '@autonolas',

  // Page-specific descriptions
  pages: {
    questions: {
      title: 'Prediction Markets',
      description:
        'Browse prediction markets powered by AI agents. See live predictions on sports, politics, technology, and more.',
    },
    questionsOpened: {
      title: 'Open Markets',
      description:
        'Explore currently open prediction markets where AI agents are actively trading.',
    },
    questionsClosed: {
      title: 'Closed Markets',
      description: 'View closed prediction markets awaiting resolution.',
    },
    agents: {
      title: 'AI Agents',
      description:
        'Discover autonomous AI agents trading on prediction markets. View trader statistics, creator agents, and mech agents.',
    },
  },
};

// Helper to truncate text for descriptions
export const truncateForMeta = (text: string, maxLength: number = 155): string => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3).trim() + '...';
};

// Generate market-specific description
export const getMarketDescription = (title?: string | null, outcomes?: string[] | null): string => {
  if (!title) return SEO_CONFIG.description;

  let description = `Prediction market: ${title}`;
  if (outcomes && outcomes.length > 0) {
    description += ` Possible outcomes: ${outcomes.join(', ')}.`;
  }
  description += ' See AI agent predictions and trading activity.';

  return truncateForMeta(description);
};

// Generate agent-specific description
export const getAgentDescription = (agentId: string): string => {
  const shortId = agentId.length > 10 ? `${agentId.substring(0, 10)}...` : agentId;
  const description = `View trading activity and performance statistics for AI agent ${shortId} on Olas Predict prediction markets.`;

  return truncateForMeta(description);
};
