import { encodeAbiParameters, getAddress, keccak256, toBytes } from 'viem';

import { SERVICE_REGISTRY_ADDRESSES } from 'constants/leaderboard';
import { phoneticSyllables } from 'utils/agents';

/**
 * Port of Pearl's `computeAgentId` (olas-operate-app `frontend/utils/generateAgentName`):
 * keccak256(abi.encode(keccak256("eip155:<chainId>"), serviceRegistry, serviceId)).
 */
export const computeAgentId = (chainId: number, serviceId: number | bigint): `0x${string}` => {
  const registry = SERVICE_REGISTRY_ADDRESSES[chainId];
  if (!registry) throw new Error(`Unsupported chainId ${chainId} for computeAgentId`);

  const caip2Hash = keccak256(toBytes(`eip155:${chainId}`));
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [caip2Hash, getAddress(registry), BigInt(serviceId)],
    ),
  );
};

const generatePhoneticName = (seed: string, startIndex: number, syllables: number) =>
  Array.from({ length: syllables }, (_, i) => {
    const seedValue = parseInt(seed.slice(startIndex + i * 8, startIndex + (i + 1) * 8), 16);
    return Number.isFinite(seedValue)
      ? phoneticSyllables[seedValue % phoneticSyllables.length]
      : phoneticSyllables[0];
  })
    .join('')
    .toLowerCase();

/**
 * Port of Pearl's `generateAgentName(chainId, serviceId)`, so the leaderboard shows the name
 * the user sees in Pearl. Unlike `generateName(address)`, the seed is the service-derived
 * agent id and the slices start at 0 and 16.
 */
export const generateAgentName = (chainId: number, serviceId: number | bigint): string => {
  const seed = computeAgentId(chainId, serviceId).slice(2).toLowerCase();
  const firstName = generatePhoneticName(seed, 0, 2);
  const lastNamePrefix = generatePhoneticName(seed, 16, 2);
  const lastNameNumber = parseInt(seed.slice(-4), 16) % 100;

  return `${firstName}-${lastNamePrefix}${String(lastNameNumber).padStart(2, '0')}`;
};
