import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';

export const GRPC_HOST = process.env.CCD_GRPC_HOST ?? 'grpc.testnet.concordium.com';
export const GRPC_PORT = Number(process.env.CCD_GRPC_PORT ?? 20000);
export const EXPLORER = 'https://ccdexplorer.io/testnet';

export function client() {
  return new ConcordiumGRPCNodeClient(GRPC_HOST, GRPC_PORT, credentials.createSsl());
}

export const txUrl = (hash: string) => `${EXPLORER}/transaction/${hash}`;
