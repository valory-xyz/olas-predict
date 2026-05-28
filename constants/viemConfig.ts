import { type PublicClient, createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

/**
 * Read-only viem public client for Gnosis Chain.
 *
 * This app does not connect to any wallet — it only reads on-chain data
 * (event logs, view calls) via the public RPC. We use viem directly rather
 * than wagmi because:
 *   - There is no `useConnect` / `useAccount` flow anywhere in the app.
 *   - No `writeContract` calls, no transaction signing.
 *   - Carrying wagmi's connector tree (@wagmi/connectors, @walletconnect/*,
 *     @metamask/sdk, @coinbase/wallet-sdk) added ~18 kB to the shared bundle
 *     (measured 309 → 291 kB), three native install hooks (bufferutil,
 *     keccak, utf-8-validate — now gone), and a long tail of Dependabot
 *     transitive-CVE alerts for code paths this app never invokes.
 *
 * See SUPPLY-CHAIN-SECURITY.md §5a for the migration rationale.
 */
export const publicClient: PublicClient = createPublicClient({
  chain: gnosis,
  transport: http(process.env.NEXT_PUBLIC_GNOSIS_URL ?? gnosis.rpcUrls.default.http[0]),
});
