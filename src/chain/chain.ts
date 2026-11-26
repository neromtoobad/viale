import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';

export const GRPC_HOST = process.env.CCD_GRPC_HOST ?? 'grpc.testnet.concordium.com';
export const GRPC_PORT = Number(process.env.CCD_GRPC_PORT ?? 20000);
export const EXPLORER = 'https://ccdexplorer.io/testnet';

export function client() {
  return new ConcordiumGRPCNodeClient(GRPC_HOST, GRPC_PORT, credentials.createSsl());
}

export const txUrl = (hash: string) => `${EXPLORER}/transaction/${hash}`;

/** Retries a node read when the public testnet node says to slow down (HTTP 429 / UNAVAILABLE). */
export async function withRetry<T>(read: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await read(); } catch (err: any) {
      if (i >= tries || !/429|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(`${err.code} ${err.message}`)) throw err;
      await new Promise((r) => setTimeout(r, i * 1000));
    }
  }
}
