# offshore-indexer

A raw event-log indexer for **Offshore Protocol** on MegaETH. One dependency, under 600 lines of source, and five Postgres views that decode drug deals, arms deals, and extortion straight out of hex.

## What this is

Offshore Protocol is a crime-themed on-chain game on MegaETH. Players deploy *company* contracts from a factory and run timed criminal operations — drug deals, arms deals, extortion — spending INFLUENCE and earning DIRTY, the game's two tokens. A vault contract (the "Swiss Vault") pays out USDM, a stablecoin, to eligible players on a fixed cycle, and DIRTY trades against USDM on the protocol's own AMM. None of it ships with a published ABI.

This indexer is an unofficial, read-only observer — it holds no keys, sends no transactions, and is not affiliated with the protocol. It records every event log the protocol's contracts emit into Postgres and exposes them through decoded SQL views. It is the data layer behind [offshore-dashboard](https://github.com/exas-3/offshore-dashboard)'s price charts, farmer leaderboards, player trade logs, and vault-cycle history.

A production run captured **6.04M logs** from the eight protocol singletons plus **3,685 auto-discovered company contracts**, across blocks **15,000,000 – 16,263,663** (≈5 GB in Postgres, May 2026 capture).

## How it works

Two lanes: a head-chase over the eight fixed protocol contracts, and a backfill over factory-discovered company contracts. Both write raw logs; all decoding lives in SQL views.

```mermaid
flowchart LR
    RPC["MegaETH RPC<br/>eth_getLogs"]
    subgraph indexer [offshore-indexer]
        HEAD[singleton<br/>head-chase]
        BACK[company backfill<br/>50 addrs/batch]
        HEAD -- factory discovery --> BACK
    end
    subgraph pg [Postgres]
        LOGS[("idx_logs<br/>raw hex")]
        VIEWS[5 SQL views<br/>hex_word decode]
        LOGS --> VIEWS
    end
    RPC --> HEAD --> LOGS
    RPC --> BACK --> LOGS
    VIEWS --> DASH[offshore-dashboard]
```

**Store raw, decode late.** Every topic0 in [`src/contracts.js`](src/contracts.js) was identified by watching live logs and correlating them with in-game behavior — there is no ABI to import. So the indexer never decodes at ingest: `eth_getLogs` filters by address only, never by topic, and every log lands undecoded in `idx_logs` (`block_num, tx_hash, log_index, address, topic0–topic3, data` — topics and data kept as raw hex text). Interpretation happens at query time in five SQL views, built on a small plpgsql `hex_word()` helper that slices 32-byte ABI words out of the data hex. When an interpretation turns out wrong — with a reverse-engineered protocol, some do — the fix is editing a view, never re-indexing six million rows. Unrecognized events aren't lost either; they sit in `idx_logs` waiting for a name (50 distinct signatures captured, ~30 catalogued so far).

**Contracts discover themselves.** Eight singleton contracts are watched from launch. Each factory `COMPANY_CREATED` log registers a new player company in `idx_contracts`, and a backfill lane pulls history for up to 50 companies per `eth_getLogs` call, interleaved with the singleton head-chase so discovery and catch-up make progress together. 3,685 companies were found this way; zero were configured.

**Time is block height.** MegaETH mints one block per second — genesis timestamp plus block height matches the live chain tip exactly — so the views compute `ts = 1762797011 + block_num` instead of fetching headers. There isn't a single `eth_getBlock*` call in the codebase.

**Boring reliability.** Ranges are fetched in ~2,000-block chunks; when the RPC's 50,000-result cap trips, the range recursively halves until it fits. Rate limits back off exponentially (capped at 60 s). Inserts are idempotent — `PRIMARY KEY (tx_hash, log_index)` with `ON CONFLICT DO NOTHING` — and progress persists in Postgres (`idx_state.head` for the singleton lane, a per-company `indexed_to` cursor for the backfill lane), so a `kill -9` costs at most one chunk. Once caught up, it polls for new blocks every few seconds.

## Watched contracts

No ABI or address registry has been published for Offshore, so this table doubles as a public reference for the protocol's on-chain footprint — these are the same address constants [offshore-dashboard](https://github.com/exas-3/offshore-dashboard) runs on.

| Contract | Address |
|---|---|
| Factory (deploys companies, op lifecycle) | `0x619814a203ca441611cee02abf31986ca265dd35` |
| Swiss Vault (USDM distribution cycles) | `0x955a4addc17114c36726c12af9c73e23e497c2bd` |
| DIRTY (ERC-20) | `0xc2f34f8849a8607fd73e06d6849bda07c2b7de38` |
| INFLUENCE (ERC-20) | `0x403de0893f0bc66139592ba2fd254672f2db933a` |
| USDM (ERC-20 stablecoin) | `0xfafddbb3fc7688494971a79cc65dca3ef82079e7` |
| Batch resolver | `0x6e43f31b2c160a3672c681114696667ef219d4c3` |
| DEX — main DIRTY/USDM pool (custom AMM) | `0xf9f676066eb7baeeed93e859bc26a41663f277a8` |
| DEX — legacy pool (Uniswap V3) | `0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1` |

Company contracts (3,685 and counting) are discovered at runtime and tracked in `idx_contracts` with their owner and backfill progress.

## Views

Created automatically at startup by [`src/db.js`](src/db.js):

| View | What you get | Notes |
|---|---|---|
| `v_dex_swaps` | Per-swap decode of the main pool: `dirty_sold`, `usdm_gross`, `usdm_fee`, `usdm_net`, `price_usdm_per_dirty` | Gross price is the pre-fee market price |
| `v_v3_swaps` | Legacy Uniswap-V3 pool swaps | Amounts left as raw hex — `hex_word()` doesn't handle signed `int256` |
| `v_vault_cycles` | USDM distributed per vault cycle + running cumulative total | |
| `v_company_trades` | Every op resolution: `company`, `owner`, `reward`, `op_type`, direct vs batch | Companies emit an event when the player picks an operation mode; `op_type` maps the most recent one before the resolution. `FAIL` means the mode was missing or 0 — read it as *unclassified*, not "the op failed" |
| `v_factory_events` | Name-decoded factory feed: `COMPANY_CREATED`, `LEVEL_UP`, `COMPANY_SOLD`, … | |

Daily DIRTY price and volume, straight off `v_dex_swaps`:

```sql
SELECT to_timestamp(ts)::date                        AS day,
       ROUND(AVG(price_usdm_per_dirty)::numeric, 4)  AS avg_price,
       ROUND(SUM(dirty_sold)::numeric)               AS dirty_sold,
       ROUND(SUM(usdm_net)::numeric)                 AS usdm_out,
       COUNT(*)                                      AS swaps
FROM v_dex_swaps
GROUP BY 1 ORDER BY 1 DESC LIMIT 5;
```

```
    day     | avg_price | dirty_sold | usdm_out | swaps
------------+-----------+------------+----------+-------
 2026-05-18 |    0.0353 |      18317 |      615 |    36
 2026-05-17 |    0.0361 |     457122 |    15696 |   560
 2026-05-16 |    0.0407 |     347515 |    13306 |   751
 2026-05-15 |    0.0572 |     431227 |    23536 |   861
 2026-05-14 |    0.0626 |     586082 |    34812 |  1152
```

Top earners by op rewards, with classification coverage made explicit:

```sql
SELECT owner,
       ROUND(SUM(reward)::numeric) AS dirty_earned,
       COUNT(*)                    AS ops,
       COUNT(*) FILTER (WHERE op_type = 'DRUG_DEAL') AS drug,
       COUNT(*) FILTER (WHERE op_type = 'ARMS_DEAL') AS arms,
       COUNT(*) FILTER (WHERE op_type = 'EXTORTION') AS extort,
       COUNT(*) FILTER (WHERE op_type = 'FAIL')      AS unclass
FROM v_company_trades
GROUP BY owner ORDER BY dirty_earned DESC LIMIT 5;
```

```
                   owner                    | dirty_earned | ops  | drug | arms | extort | unclass
--------------------------------------------+--------------+------+------+------+--------+---------
 0xcf0ad40eae14dfbf857856afb794d120a729a751 |     13617689 | 5819 |    0 |    0 |      0 |    5819
 0x9f02e6b0880c6cea46e432c20c4be0182b469383 |     11997625 | 5124 | 1555 |    4 |      0 |    3565
 0x76ffd03fcd1424c372d7530059927b185bbea736 |     10233618 | 4400 | 1891 | 1190 |      0 |    1319
 0x663646d1c8836594f70b987eeaa06b324910576c |      9979993 | 4291 |  960 |  860 |      0 |    2471
 0xdebd183f0edc1297008c4201eee53b219e2c9f4d |      9883580 | 4238 | 2748 |  520 |      0 |     970
```

The `extort` column is all zeros for a reason: mode 3 never occurs anywhere in the capture, so the mode-3 → `EXTORTION` mapping is presumed from the game's op roster, not observed on-chain.

## Running it

Requirements: Node 18+ (native `fetch`; the `--env-file` npm scripts need 20.6+), any reasonably modern Postgres, and a `DATABASE_URL`. The RPC endpoint is the public `https://mainnet.megaeth.com/rpc`, hardcoded — no key needed.

```sh
npm install    # exactly one package
DATABASE_URL=postgres://user:pass@host/db node src/index.js
```

Tables, indexes, `hex_word()`, and all five views are created automatically on boot. Sync starts at block 15,000,000 (the protocol launch era) and prints progress as it chases the head; catching up through the first ~1.26M blocks means roughly 6M logs and ~5 GB on disk.

The `npm start` / `npm run dev` scripts point `--env-file` at a sibling `offshore-dashboard` checkout, because the indexer is designed to share the dashboard's database — or run `node --env-file=path/to/.env src/index.js` directly with any env file that defines `DATABASE_URL`.

Tunables sit at the top of [`src/sync.js`](src/sync.js): `CHUNK` (blocks per `eth_getLogs`), `COMPANY_BATCH` (addresses per backfill call), `LIVE_DELAY_MS` (poll interval once caught up).

## Caveats

- **No reorg handling.** Logs are stored as first seen and cursors only move forward. Inserts are idempotent, so a suspect range can be re-fetched by rewinding `idx_state.head` *and* the affected companies' `idx_contracts.indexed_to` (e.g. `UPDATE idx_contracts SET indexed_to = LEAST(indexed_to, <block>)`), but orphaned logs from a reorged block would linger.
- **Timestamps are derived, not fetched.** `ts = 1762797011 + block_num` relies on MegaETH's exact one-block-per-second cadence — it has held since genesis, but it is an assumption, not a header read.
- **Event semantics are reverse-engineered.** The primary decoded columns (amounts, prices, rewards) are validated daily by a production dashboard; a few auxiliary data words remain unlabeled (marked `?` in `src/contracts.js`), and `v_company_trades.op_type` is an interpretation, not protocol truth.
- **Startup drops the views.** `setup()` runs `DROP VIEW ... CASCADE` before recreating them, so any views you define on top of these five will be dropped on the next restart.
- **One public RPC endpoint.** Backoff is built in, but throughput is bounded by its rate limits.

## Related

- [offshore-dashboard](https://github.com/exas-3/offshore-dashboard) — the Bloomberg-style terminal these views feed (offshoredashboard.xyz).

## License

[MIT](LICENSE)
