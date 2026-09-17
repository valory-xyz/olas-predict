// Bet ids reaching the achievement page come from Pearl, which still emits the id
// format of the retired `predict-polymarket-agents` subgraph: the transaction hash
// with the log index appended as four little-endian bytes (The Graph's `concatI32`),
// e.g. `0x90…6c07` + `b4050000` for log index 1460.
//
// The SQD squid keys bets as `{txHash}_{logIndex}` with a decimal log index, so the
// legacy form has to be rewritten before it is used as a squid id. Ids that already
// arrive in the squid form are passed through, so this keeps working once Pearl
// switches over.
const LEGACY_BET_ID = /^0x([0-9a-fA-F]{64})([0-9a-fA-F]{8})$/;
const SQUID_BET_ID = /^0x[0-9a-fA-F]{64}_\d+$/;

export const toSquidBetId = (betId: string): string | null => {
  if (!betId) return null;

  if (SQUID_BET_ID.test(betId)) return betId.toLowerCase();

  const legacy = LEGACY_BET_ID.exec(betId);
  if (!legacy) return null;

  const [, transactionHash, logIndexBytes] = legacy;
  const logIndex = parseInt((logIndexBytes.match(/../g) as string[]).reverse().join(''), 16);

  return `0x${transactionHash.toLowerCase()}_${logIndex}`;
};
