import { setup } from './db.js';
import { run }   from './sync.js';

console.log('[offshore-indexer] starting');

setup()
  .then(run)
  .catch(err => { console.error('[fatal]', err); process.exit(1); });
