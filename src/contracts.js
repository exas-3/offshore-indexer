// Known protocol contracts and all discovered event topic signatures.

export const LAUNCH_BLOCK = 15_000_000;

// Singleton contracts — always watched from LAUNCH_BLOCK
export const SINGLETONS = [
  { address: '0xc2f34f8849a8607fd73e06d6849bda07c2b7de38', type: 'dirty'     },
  { address: '0x403de0893f0bc66139592ba2fd254672f2db933a', type: 'influence' },
  { address: '0xfafddbb3fc7688494971a79cc65dca3ef82079e7', type: 'usdm'      },
  { address: '0x955a4addc17114c36726c12af9c73e23e497c2bd', type: 'vault'     },
  { address: '0x619814a203ca441611cee02abf31986ca265dd35', type: 'factory'   },
  { address: '0x6e43f31b2c160a3672c681114696667ef219d4c3', type: 'resolver'  },
  { address: '0xf9f676066eb7baeeed93e859bc26a41663f277a8',  type: 'dex'       },
  { address: '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1', type: 'dex'       },
];

// ─── Factory ──────────────────────────────────────────────────────────────────
// topic1 = company address (newly deployed)
export const FACTORY_COMPANY_CREATED  = '0xa0369ed1d1c5cd392c59436c94ab898fef562e234dfc4db8ed8fda761b719b3f';
// topic1 = company, topic2 = owner; data = uint256 (influence cost?)
export const FACTORY_INFLUENCE_BOUGHT = '0x55458b8d3210ff0a2d3612a4b3639021fd38d66d563562a98ca8b7d5e7930f70';
// topic1 = company, topic2 = owner; data = uint256 dirty amount
export const FACTORY_DIRTY_PAID       = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';
// topic1 = company, topic2 = owner; data = uint256
export const FACTORY_OP_REWARD        = '0x767d03cd29c82cd4501c62502b07069d2c1158df0c0ed0f73b8565cb1bfadc19';
// topic1 = company; no data
export const FACTORY_OP_COMPLETE      = '0x83e6931d35fae494bec7bde30064c99cd08af7b51e2db4ce62030d2dbaeddd4d';
// topic1 = company; no data (frequent - possibly trade-started on factory level)
export const FACTORY_TRADE_STARTED    = '0xf2e6f9ff1bb92acf0aa0482b4b3bfcae9dba702e56425d8fd66b311b9206f57b';
// topic1 = company; data = 2x uint256 (ids/params)
export const FACTORY_TRADE_PARAMS     = '0xd47648dbe74844d41eea0e3e6bf1d3f6f03cd31691e10e6edc7376d52b934dbd';
// topic1 = seller, topic2 = buyer; data = uint256 price
export const FACTORY_COMPANY_SOLD     = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';
// topic1 = company; no data (company closed/deactivated?)
export const FACTORY_COMPANY_CLOSED   = '0x6c2d26b220fa6fabc2afa5a4be2462af0d3c98c1db388463701e2595f1a713ed';
// topic1 = company; data = uint256 level, uint256 cost
export const FACTORY_LEVEL_UP         = '0x2ca3c57c4517cd4f224f85fc4cb74ad719dfec5650f8dc7cf193c6d6207e8de9';
// topic1 = company, topic2 = owner; data = 2x uint256 (both 0 in samples)
export const FACTORY_UNKNOWN_A        = '0x6a246aa8ae6c3f23b16e88521d3b4a34d69a84eb98f49f9e2149c801758c8693';

// ─── Company contracts ────────────────────────────────────────────────────────
// topic1 = owner, topic2 = company; no data
export const COMPANY_INITIALIZED    = '0x4d24f1a59c2c1da28de5eff94bdfc76e516ac369b15b5c52758bd4834547cd93';
// topic1 = owner, topic2 = company; data = uint256 mode
export const COMPANY_MODE_SET       = '0x45bbfdba894613978e2020519389850b832e46047255c75de8039b91d5406608';
// topic1 = owner, topic2 = company; data = uint256 dirtyCost, uint256 influenceCost
export const COMPANY_TRADE_STARTED  = '0x35c06e2c02cc93628588ec67d74925fa30de5c693ea264ec67458bb0b65c3bf1';
// topic1 = owner, topic2 = company; data = uint256 reward, uint256 something
export const COMPANY_TRADE_RESOLVED = '0xc9d569cd353baa00aba278d825e5ea5d5a8070868c5cbbf713cc7daed65f137f';
// topic1 = owner, topic2 = company; data = uint256 dirtyAmount
export const COMPANY_DIRTY_PAID     = '0x9310ccfcb8de723f578a9e4282ea9f521f05ae40dc08f3068dfad528a65ee3c7';
// topic1 = company, topic2 = owner; no data
export const COMPANY_COMPLETED      = '0xc09b4bf502d683987e0e400f600bb8b326ec2a36a4327f244422eb3522db97f8';
// topic1 = resolver, topic2 = owner, topic3 = company; data = uint256 reward, uint256 something
export const COMPANY_BATCH_RESOLVED = '0xbc95a830b1019b9734680ca35152c5632ef54d080bfa3a55531b755867397678';

// ─── Vault ────────────────────────────────────────────────────────────────────
// topic1 = user; data = uint256 usdmAmount, uint256 something
export const VAULT_CLAIMED    = '0xe315715dd66b70c8b73f5dc2fbb908d19585149b6d5d3b701d8baa7ba2f2f33e';
// topic1 = user; data = uint256
export const VAULT_DEPOSITED  = '0x22016a449f75d794c27402681d5b7900983eefba1391a4bd4e93c4b39c0ba3e7';
// topic1 = user; data = uint256
export const VAULT_WITHDRAWN  = '0xfc30cddea38e2bf4d6ea7d3f9ed3b6ad7f176419f4963bd81318067a4aee73fe';
// no indexed; data = uint256 totalDistributed, uint256 cumulativeTotal
export const VAULT_CYCLE_END  = '0x3995a007ded60c4c9d11a0271043f6e5d33ceb539aee64e56b82cd7f3662559b';

// ─── ERC-20 (DIRTY / INFLUENCE / USDM) ───────────────────────────────────────
export const ERC20_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ERC20_APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

// ─── DEX Main (custom AMM) ────────────────────────────────────────────────────
// topic1 = recipient; data = uint256 x4 (amountIn0, amountIn1, amountOut0, amountOut1)
export const DEX_SWAP      = '0x490fdc1c23c0f3a84bf80a0384eaadcb9188c9ef71b9430da391a0e4c4c39bf6';
// topic1 = recipient; data = uint256 x4 (liquidity event?)
export const DEX_LIQUIDITY = '0x27330bd7589580547b6437e08f9c60653de63691d2d2b2c13bff9ee67da2a68d';

// ─── DEX Legacy (Uniswap V3) ─────────────────────────────────────────────────
export const V3_SWAP  = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
export const V3_MINT  = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde';
export const V3_BURN  = '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c';
export const V3_FLASH = '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0';
