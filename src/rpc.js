const RPC = 'https://mainnet.megaeth.com/rpc';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(body, attempt = 0) {
  try {
    const res = await fetch(RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(30_000),
    });
    const j = await res.json();

    if (j.error) {
      const msg = j.error.message ?? '';
      if (msg.includes('Rate limit') || msg.includes('rate limit')) {
        if (attempt >= 10) throw new Error(`Rate limit persistent after ${attempt} retries`);
        const delay = Math.min(300 * 2 ** attempt, 60_000);
        await sleep(delay);
        return post(body, attempt + 1);
      }
      if (msg.includes('more than 50000') || msg.includes('result limit')) {
        throw Object.assign(new Error('RANGE_TOO_LARGE'), { code: 'RANGE_TOO_LARGE' });
      }
      throw new Error(msg);
    }
    return j.result;
  } catch (e) {
    if (e.code === 'RANGE_TOO_LARGE') throw e;
    if (attempt >= 5) throw e;
    await sleep(1000 * (attempt + 1));
    return post(body, attempt + 1);
  }
}

// Fetch all event logs from one or more contract addresses over a block range.
// Returns raw RPC log objects.
export async function getLogs(addresses, fromBlock, toBlock) {
  const addr = Array.isArray(addresses) ? addresses : [addresses];
  return post({
    jsonrpc: '2.0', id: 1,
    method:  'eth_getLogs',
    params:  [{ address: addr, fromBlock: hex(fromBlock), toBlock: hex(toBlock) }],
  });
}

export async function getBlockNumber() {
  return parseInt(await post({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), 16);
}

function hex(n) { return '0x' + n.toString(16); }
