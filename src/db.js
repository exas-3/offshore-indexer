import postgres from 'postgres';

let _db;
export function db() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not set');
    _db = postgres(url, {
      max: 5,
      ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
      connect_timeout: 30,
      onnotice: () => {},
    });
  }
  return _db;
}

export async function setup() {
  await db().unsafe(`
    CREATE TABLE IF NOT EXISTS idx_logs (
      block_num  BIGINT   NOT NULL,
      tx_hash    TEXT     NOT NULL,
      log_index  SMALLINT NOT NULL,
      address    TEXT     NOT NULL,
      topic0     TEXT     NOT NULL,
      topic1     TEXT,
      topic2     TEXT,
      topic3     TEXT,
      data       TEXT     NOT NULL DEFAULT '0x',
      PRIMARY KEY (tx_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_logs_block     ON idx_logs (block_num);
    CREATE INDEX IF NOT EXISTS idx_logs_address   ON idx_logs (address);
    CREATE INDEX IF NOT EXISTS idx_logs_topic0    ON idx_logs (topic0);
    CREATE INDEX IF NOT EXISTS idx_logs_tx        ON idx_logs (tx_hash);
    CREATE INDEX IF NOT EXISTS idx_logs_addr_t0   ON idx_logs (address, topic0, block_num DESC, log_index DESC);

    CREATE TABLE IF NOT EXISTS idx_contracts (
      address     TEXT   PRIMARY KEY,
      type        TEXT   NOT NULL,
      owner       TEXT,
      meta        JSONB  NOT NULL DEFAULT '{}',
      first_block BIGINT NOT NULL DEFAULT 0,
      indexed_to  BIGINT NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_contracts_type  ON idx_contracts (type);
    CREATE INDEX IF NOT EXISTS idx_contracts_owner ON idx_contracts (owner);

    CREATE TABLE IF NOT EXISTS idx_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Decode a 32-byte ABI word from a 0x-prefixed hex string at word_idx offset.
  await db().unsafe(`
    CREATE OR REPLACE FUNCTION hex_word(hex TEXT, word_idx INTEGER DEFAULT 0)
    RETURNS NUMERIC AS $$
    DECLARE
      hex64      TEXT;
      word_bytes BYTEA;
      result     NUMERIC := 0;
      i          INTEGER;
    BEGIN
      hex64 := LPAD(
        SUBSTRING(CASE WHEN LEFT(hex, 2) = '0x' THEN SUBSTRING(hex, 3) ELSE hex END,
                  word_idx * 64 + 1, 64),
        64, '0');
      word_bytes := DECODE(hex64, 'hex');
      FOR i IN 0..31 LOOP
        result := result * 256 + GET_BYTE(word_bytes, i);
      END LOOP;
      RETURN result;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  // Drop views before recreating so column renames work cleanly.
  await db().unsafe(`
    DROP VIEW IF EXISTS v_dex_swaps      CASCADE;
    DROP VIEW IF EXISTS v_v3_swaps       CASCADE;
    DROP VIEW IF EXISTS v_vault_cycles   CASCADE;
    DROP VIEW IF EXISTS v_company_trades CASCADE;
    DROP VIEW IF EXISTS v_factory_events CASCADE;
  `);

  await db().unsafe(`
    -- Custom AMM swap events (main DEX pool)
    -- data: [uint256 amountIn0, amountIn1, amountOut0, amountOut1]
    CREATE OR REPLACE VIEW v_dex_swaps AS
    SELECT
      block_num,
      (1762797011 + block_num)                                 AS ts,
      tx_hash,
      log_index,
      '0x' || RIGHT(topic1, 40)                                AS recipient,
      -- word 0: DIRTY sold by user to main pool
      hex_word(data, 0) / 1000000000000000000                  AS dirty_sold,
      -- word 1: gross USDm received by main pool from V3 arbitrage leg
      hex_word(data, 1) / 1000000000000000000                  AS usdm_gross,
      -- word 2: USDm fee sent to protocol treasury
      hex_word(data, 2) / 1000000000000000000                  AS usdm_fee,
      -- word 3: net USDm sent to recipient (user's proceeds)
      hex_word(data, 3) / 1000000000000000000                  AS usdm_net,
      -- effective price of DIRTY in USDm
      CASE WHEN hex_word(data, 0) > 0
        THEN (hex_word(data, 3) / hex_word(data, 0))::FLOAT
        ELSE NULL
      END                                                      AS price_usdm_per_dirty
    FROM idx_logs
    WHERE address = '0xf9f676066eb7baeeed93e859bc26a41663f277a8'
      AND topic0  = '0x490fdc1c23c0f3a84bf80a0384eaadcb9188c9ef71b9430da391a0e4c4c39bf6';

    -- Uniswap V3 legacy pool swaps (amounts are signed int256, returned as raw hex)
    CREATE OR REPLACE VIEW v_v3_swaps AS
    SELECT
      block_num,
      (1762797011 + block_num)  AS ts,
      tx_hash,
      log_index,
      '0x' || RIGHT(topic1, 40) AS sender,
      '0x' || RIGHT(topic2, 40) AS recipient,
      SUBSTRING(data, 3, 64)    AS amount0_hex,
      SUBSTRING(data, 67, 64)   AS amount1_hex
    FROM idx_logs
    WHERE address = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1'
      AND topic0  = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

    -- Vault cycle-end events
    -- data: [uint256 distributed, uint256 cumulativeTotal]
    CREATE OR REPLACE VIEW v_vault_cycles AS
    SELECT
      block_num,
      (1762797011 + block_num)                     AS ts,
      tx_hash,
      hex_word(data, 0) / 1000000000000000000       AS distributed,
      hex_word(data, 1) / 1000000000000000000       AS cumulative_total
    FROM idx_logs
    WHERE address = '0x955a4addc17114c36726c12af9c73e23e497c2bd'
      AND topic0  = '0x3995a007ded60c4c9d11a0271043f6e5d33ceb539aee64e56b82cd7f3662559b';

    -- Company trade resolutions with mode from the preceding COMPANY_MODE_SET.
    -- Both TRADE_RESOLVED and MODE_SET fire from the company contract (address = company).
    -- BATCH_RESOLVED also fires from the company contract; topic1 = resolver, topic2 = owner.
    CREATE OR REPLACE VIEW v_company_trades AS
    WITH trades AS (
      -- direct single-company resolution
      SELECT
        address                                              AS company,
        block_num, log_index, tx_hash,
        '0x' || RIGHT(topic1, 40)                           AS owner,
        hex_word(data, 0) / 1000000000000000000             AS reward,
        'direct'                                            AS source
      FROM idx_logs
      WHERE topic0 = '0xc9d569cd353baa00aba278d825e5ea5d5a8070868c5cbbf713cc7daed65f137f'
      UNION ALL
      -- batch resolution via resolver (topic1=resolver, topic2=owner, address=company)
      SELECT
        address                                              AS company,
        block_num, log_index, tx_hash,
        '0x' || RIGHT(topic2, 40)                           AS owner,
        hex_word(data, 0) / 1000000000000000000             AS reward,
        'batch'                                             AS source
      FROM idx_logs
      WHERE topic0 = '0xbc95a830b1019b9734680ca35152c5632ef54d080bfa3a55531b755867397678'
    )
    SELECT
      t.block_num,
      (1762797011 + t.block_num)                            AS ts,
      t.tx_hash,
      t.log_index,
      t.company,
      t.owner,
      t.reward,
      COALESCE(m.mode, 0)                                   AS mode,
      CASE COALESCE(m.mode, 0)
        WHEN 1 THEN 'DRUG_DEAL'
        WHEN 2 THEN 'ARMS_DEAL'
        WHEN 3 THEN 'EXTORTION'
        ELSE         'FAIL'
      END                                                   AS op_type,
      t.source
    FROM trades t
    LEFT JOIN LATERAL (
      SELECT CASE WHEN LENGTH(data) >= 66 THEN RIGHT(data, 1)::INTEGER ELSE 0 END AS mode
      FROM idx_logs
      WHERE topic0  = '0x45bbfdba894613978e2020519389850b832e46047255c75de8039b91d5406608'
        AND address = t.company
        AND (block_num < t.block_num
             OR (block_num = t.block_num AND log_index < t.log_index))
      ORDER BY block_num DESC, log_index DESC
      LIMIT 1
    ) m ON TRUE;

    -- Factory events with human-readable names
    CREATE OR REPLACE VIEW v_factory_events AS
    SELECT
      block_num,
      (1762797011 + block_num)  AS ts,
      tx_hash,
      log_index,
      CASE topic0
        WHEN '0xa0369ed1d1c5cd392c59436c94ab898fef562e234dfc4db8ed8fda761b719b3f' THEN 'COMPANY_CREATED'
        WHEN '0x55458b8d3210ff0a2d3612a4b3639021fd38d66d563562a98ca8b7d5e7930f70' THEN 'INFLUENCE_BOUGHT'
        WHEN '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502' THEN 'DIRTY_PAID'
        WHEN '0x767d03cd29c82cd4501c62502b07069d2c1158df0c0ed0f73b8565cb1bfadc19' THEN 'OP_REWARD'
        WHEN '0x83e6931d35fae494bec7bde30064c99cd08af7b51e2db4ce62030d2dbaeddd4d' THEN 'OP_COMPLETE'
        WHEN '0xf2e6f9ff1bb92acf0aa0482b4b3bfcae9dba702e56425d8fd66b311b9206f57b' THEN 'TRADE_STARTED'
        WHEN '0xd47648dbe74844d41eea0e3e6bf1d3f6f03cd31691e10e6edc7376d52b934dbd' THEN 'TRADE_PARAMS'
        WHEN '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff' THEN 'COMPANY_SOLD'
        WHEN '0x6c2d26b220fa6fabc2afa5a4be2462af0d3c98c1db388463701e2595f1a713ed' THEN 'COMPANY_CLOSED'
        WHEN '0x2ca3c57c4517cd4f224f85fc4cb74ad719dfec5650f8dc7cf193c6d6207e8de9' THEN 'LEVEL_UP'
        ELSE 'UNKNOWN'
      END                                             AS event_name,
      '0x' || RIGHT(COALESCE(topic1, REPEAT('0', 64)), 40) AS addr1,
      '0x' || RIGHT(COALESCE(topic2, REPEAT('0', 64)), 40) AS addr2,
      data
    FROM idx_logs
    WHERE address = '0x619814a203ca441611cee02abf31986ca265dd35';
  `);

  console.log('[db] schema ready');
}
