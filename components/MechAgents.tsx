import { useQuery } from '@tanstack/react-query';
import { Flex, Table, Typography } from 'antd';
import { getMechAgents } from 'graphql/queries';
import { MechAgent } from 'graphql/types';
import Jazzicon, { jsNumberForAddress } from 'react-jazzicon';
import styled from 'styled-components';

import { Card } from 'components/shared/styles';
import { AGENT_REGISTRY_ABI, AGENT_REGISTRY_ADDRESS } from 'constants/contracts/agentRegistry';
import { GNOSIS_SCAN_URL } from 'constants/index';
import { COLOR } from 'constants/theme';
import { publicClient } from 'constants/viemConfig';
import { generateName } from 'utils/agents';
import { getIpfsResponse } from 'utils/ipfs';

const { Title, Paragraph } = Typography;

const Tag = styled.div`
  display: flex;
  padding: 2px 6px;
  border-radius: 6px;
  background: ${COLOR.WHITE_TRANSPARENT_5};
  color: ${COLOR.SECONDARY};
`;

const LONG_HASHES_AGENT_ID = 6;

// TODO: it's impossible to use multicall for all agents, because for some agents
// the result is too long and the request fails. Ideally need to move it
// to the subgraph; using this approach to save time
async function fetchHashes(agents: MechAgent[]) {
  const hashesPromises = agents.map((agent) =>
    agent.agentId === `${LONG_HASHES_AGENT_ID}`
      ? Promise.resolve(null)
      : publicClient.readContract({
          address: AGENT_REGISTRY_ADDRESS,
          abi: AGENT_REGISTRY_ABI,
          functionName: 'getHashes',
          args: [agent.agentId],
        }),
  );

  const hashesResult = await Promise.allSettled(hashesPromises);
  const hashes = hashesResult.map((item) => {
    if (item.status === 'fulfilled' && !!item.value) {
      const [numHashes, agentHashes] = item.value as [bigint, string[]];
      return agentHashes[Number(numHashes) - 1];
    }
    return null;
  });

  let longAgentHash;

  try {
    const logs = await publicClient.getLogs({
      address: AGENT_REGISTRY_ADDRESS,
      event: {
        type: 'event',
        name: 'UpdateAgentHash',
        inputs: [
          {
            indexed: true,
            name: 'agentId',
            type: 'uint256',
          },
          {
            indexed: false,
            name: 'agentHash',
            type: 'bytes32',
          },
        ],
      },
      args: { agentId: BigInt(LONG_HASHES_AGENT_ID) },
      fromBlock: BigInt(35677064),
      toBlock: 'latest',
    });

    longAgentHash = logs[logs.length - 1].args.agentHash;
  } catch (e) {
    console.error(e);
  }

  if (longAgentHash) {
    hashes[LONG_HASHES_AGENT_ID - 1] = longAgentHash;
  }

  return hashes;
}

export const MechAgents = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['getMechAgents'],
    queryFn: async () => {
      const data = await getMechAgents();
      if (data.createMeches.length === 0) return undefined;
      // get ipfs hashes for each agent
      const hashes = await fetchHashes(data.createMeches);

      // request data from ipfs to get the tools
      const ipfsPromises = hashes.map((item) =>
        item ? getIpfsResponse(item) : Promise.resolve(null),
      );
      const ipfsResult = await Promise.allSettled(ipfsPromises);
      const tools = ipfsResult.map((item) => {
        if (item.status === 'fulfilled' && !!item.value) {
          return item.value.tools;
        }
        return null;
      });

      const result: (MechAgent & { tools: string[] })[] = [];
      data.createMeches.forEach((agent, index) => {
        result.push({
          ...agent,
          tools: tools[index],
        });
      });

      return result.filter((item) => Array.isArray(item.tools));
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  return (
    <Card type="ongoing">
      <Flex vertical gap={12}>
        <Title level={4} className="m-0">
          Mech agents
        </Title>
        <Paragraph type="secondary" className="m-0">
          Technically, Market Creators and Traders don&apos;t have direct access to intelligence
          sources themselves. That is, they&apos;re not talking to some Bittensor model, or directly
          pulling onchain data. These agents outsource their intelligence to the Mech agents, making
          them highly adaptable and extensible.
        </Paragraph>
      </Flex>
      <Table
        columns={[
          {
            title: 'Name',
            dataIndex: 'id',
            key: 'name',
            width: 200,
            render: (id) => (
              <a
                href={`${GNOSIS_SCAN_URL}/address/${id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Flex gap={12}>
                  <Jazzicon diameter={24} seed={jsNumberForAddress(id)} />
                  <b>{generateName(id)}</b>
                </Flex>
              </a>
            ),
          },
          {
            title: 'Tools in use',
            dataIndex: 'tools',
            key: 'tools',
            render: (tools) => (
              <Flex gap={12} wrap>
                {tools.map((item: string) => (
                  <Tag key={item}>{item}</Tag>
                ))}
              </Flex>
            ),
          },
        ]}
        loading={isLoading}
        dataSource={data}
        pagination={false}
      />
    </Card>
  );
};
