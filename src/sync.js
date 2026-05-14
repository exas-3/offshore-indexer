import { db }          from './db.js';
import { getLogs, getBlockNumber } from './rpc.js';
import {
  SINGLETONS, LAUNCH_BLOCK,
  FACTORY_COMPANY_CREATED, COMPANY_INITIALIZED,
} from './contracts.js';

// ─── tunables ────────────────────────────────────────────────────────────────
const CHUNK         = 2_000;  // blocks per getLogs call (reduced on RANGE_TOO_LARGE)
const COMPANY_BATCH = 50;     // company addresses per getLogs call
const LIVE_DELAY_MS = 2_000;  // pause when fully caught up

// ─── helpers ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseLog(l) {
  return {
    block_num: parseInt(l.blockNumber, 16),
    tx_hash:   l.transactionHash.toLowerCase(),
    log_index: parseInt(l.logIndex, 16),
    address:   l.address.toLowerCase(),
    topic0:    l.topics[0]?.toLowerCase() ?? null,
    topic1:    l.topics[1]?.toLowerCase() ?? null,
    topic2:    l.topics[2]?.toLowerCase() ?? null,
    topic3:    l.topics[3]?.toLowerCase() ?? null,
    data:      l.data ?? '0x',
  };
}

// postgres.js parameterized inserts: max 65534 params. Each log row = 9 fields → max ~7281 rows/call.
const INSERT_CHUNK = 5_000;

async function writeLogs(raw) {
  if (!raw?.length) return [];
  const rows = raw.map(parseLog);
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await db()`
      INSERT INTO idx_logs ${db()(chunk)}
      ON CONFLICT (tx_hash, log_index) DO NOTHING
    `;
  }
  return rows;
}

// ─── state ───────────────────────────────────────────────────────────────────

async function getHead() {
  const [r] = await db()`SELECT value FROM idx_state WHERE key = 'head'`;
  return r ? parseInt(r.value) : LAUNCH_BLOCK - 1;
}

async function setHead(block) {
  await db()`
    INSERT INTO idx_state (key, value) VALUES ('head', ${String(block)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

// ─── factory: discover new companies ─────────────────────────────────────────

async function handleFactoryLogs(raw) {
  const created = raw.filter(l => l.topics[0]?.toLowerCase() === FACTORY_COMPANY_CREATED);
  if (!created.length) return;

  const rows = created.map(l => ({
    address:     ('0x' + l.topics[1].slice(26)).toLowerCase(),
    type:        'company',
    first_block: parseInt(l.blockNumber, 16),
    indexed_to:  0,
  }));

  await db()`
    INSERT INTO idx_contracts ${db()(rows)}
    ON CONFLICT (address) DO NOTHING
  `;
  process.stdout.write(`  +${rows.length} companies\n`);
}

// ─── company: extract owner from COMPANY_INITIALIZED ─────────────────────────

async function handleCompanyLogs(raw) {
  const inits = raw.filter(l => l.topics[0]?.toLowerCase() === COMPANY_INITIALIZED && l.topics[2]);
  if (!inits.length) return;

  for (const l of inits) {
    const owner   = ('0x' + l.topics[1].slice(26)).toLowerCase();
    const company = ('0x' + l.topics[2].slice(26)).toLowerCase();
    await db()`
      UPDATE idx_contracts SET owner = ${owner}
      WHERE address = ${company} AND owner IS NULL
    `;
  }
}

// ─── range fetch with automatic halving on 50k limit ─────────────────────────

async function fetchRange(addresses, from, to) {
  try {
    return await getLogs(addresses, from, to);
  } catch (e) {
    if (e.code !== 'RANGE_TOO_LARGE') throw e;
    // Halve and recurse
    const mid = Math.floor((from + to) / 2);
    if (mid === from) throw new Error(`Range too large even for single block ${from}`);
    const [a, b] = await Promise.all([
      fetchRange(addresses, from, mid),
      fetchRange(addresses, mid + 1, to),
    ]);
    return [...a, ...b];
  }
}

// ─── main sync passes ─────────────────────────────────────────────────────────

// Advance singletons from `from` to `to`, discovering companies along the way.
async function syncSingletons(from, to) {
  for (const { address, type } of SINGLETONS) {
    const raw = await fetchRange(address, from, to);
    await writeLogs(raw);
    if (type === 'factory') await handleFactoryLogs(raw);
  }
}

// Advance one batch of behind companies toward `head`.
// Returns true if there are more companies still behind.
async function backfillCompanies(head) {
  const behind = await db()`
    SELECT address, indexed_to, first_block
    FROM   idx_contracts
    WHERE  type = 'company' AND indexed_to < ${head}
    ORDER  BY indexed_to ASC, first_block ASC
    LIMIT  ${COMPANY_BATCH}
  `;
  if (!behind.length) return false;

  // Start from the earliest meaningful block across this batch.
  // Use each company's first_block (deployment block) rather than LAUNCH_BLOCK to
  // skip scanning blocks before any of these contracts existed.
  const minStart = Math.min(...behind.map(c => Number(c.first_block)));
  const from = Math.max(Number(behind[0].indexed_to), minStart);
  const to   = Math.min(from + CHUNK - 1, head);
  const addrs = behind.map(c => c.address);

  const raw = await fetchRange(addrs, from, to);
  await writeLogs(raw);
  await handleCompanyLogs(raw);

  await db()`
    UPDATE idx_contracts
    SET    indexed_to = GREATEST(indexed_to, ${to})
    WHERE  address = ANY(${addrs})
  `;

  return true; // might be more
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function run() {
  // Seed singleton contracts
  for (const { address, type } of SINGLETONS) {
    await db()`
      INSERT INTO idx_contracts (address, type, first_block, indexed_to)
      VALUES (${address}, ${type}, ${LAUNCH_BLOCK}, 0)
      ON CONFLICT (address) DO NOTHING
    `;
  }

  let head = await getHead();
  console.log(`[sync] starting from block ${head + 1}`);

  while (true) {
    const latest = await getBlockNumber();

    // ── 1. Advance singletons one chunk toward latest ─────────────────────────
    if (head < latest - 1) {
      const from = head + 1;
      const to   = Math.min(head + CHUNK - 1, latest - 1);

      process.stdout.write(`\r[sync] ${from}–${to}  (${latest - to} behind)   `);
      await syncSingletons(from, to);
      head = to;
      await setHead(head);
      // Fall through to run one company-backfill batch before looping.
    }

    // ── 2. Backfill one batch of company contracts ────────────────────────────
    const more = await backfillCompanies(head);
    if (more) {
      const [{ count }] = await db()`
        SELECT COUNT(*) FROM idx_contracts WHERE type = 'company' AND indexed_to < ${head}
      `;
      process.stdout.write(`\r[backfill] ${count} companies behind  head=${head}   `);
      continue;
    }

    // ── 3. Fully caught up — wait for new blocks ──────────────────────────────
    if (head >= latest - 1) {
      process.stdout.write(`\r[live] head=${head} latest=${latest}   `);
      await sleep(LIVE_DELAY_MS);
    }
  }
}
