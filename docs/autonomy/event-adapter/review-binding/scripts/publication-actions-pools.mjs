// Inactive pool composition. Callers supply an audited pg Pool constructor and
// dedicated credentials; no environment lookup, package loading, or startup.
import tls from 'node:tls';

const HOST = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const ROLE_KEYS = ['reservation', 'senderRecord', 'sendRecordRead'];
const ERROR = 'PUBLICATION_POOLS_UNAVAILABLE';
const ownKeys = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

function checked(config) {
  if (!ownKeys(config, ['host', 'database', ...ROLE_KEYS]) || config.host !== HOST ||
      typeof config.database !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(config.database)) {
    throw new Error(ERROR);
  }
  const users = new Set(), passwords = new Set();
  for (const key of ROLE_KEYS) {
    const role = config[key];
    if (!ownKeys(role, ['user', 'password']) || typeof role.user !== 'string' ||
        !/^[a-z][a-z0-9_]{2,62}$/.test(role.user) ||
        /admin|owner|superuser|postgres|root/.test(role.user) || role.user.startsWith('pg_') ||
        typeof role.password !== 'string' || role.password.length === 0 ||
        role.password.length > 4096 || /[\x00\r\n]/.test(role.password) ||
        users.has(role.user) || passwords.has(role.password)) throw new Error(ERROR);
    users.add(role.user); passwords.add(role.password);
  }
  // Names and distinct credentials do NOT establish database grants. Actual
  // privileges must be independently verified on the dedicated test database.
  return ROLE_KEYS.map(key => ({host: HOST, port: 5432, database: config.database,
    user: config[key].user, password: config[key].password,
    ssl: {rejectUnauthorized: true, servername: HOST, minVersion: 'TLSv1.2',
      checkServerIdentity: tls.checkServerIdentity},
    max: 1, connectionTimeoutMillis: 1500, statement_timeout: 2000,
    query_timeout: 2500, lock_timeout: 1000, idleTimeoutMillis: 1000,
    // Nonempty options also prevent pg's truthy-fallback lookup of PGOPTIONS.
    allowExitOnIdle: true, options: '-c statement_timeout=2000 -c lock_timeout=1000',
    application_name: 'meridian-publication-test'}));
}

async function endAll(pools) {
  let timer;
  try {
    await Promise.race([
      Promise.allSettled(pools.map(async pool => { await pool.end(); })).then(results => {
        if (results.some(result => result.status === 'rejected')) throw new Error(ERROR);
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(ERROR)), 2000); }),
    ]);
  } catch { throw new Error(ERROR); }
  finally { clearTimeout(timer); }
}

export async function openPublicationPools(config, {Pool} = {}) {
  const pools = [];
  try {
    const options = checked(config);
    if (typeof Pool !== 'function') throw new Error(ERROR);
    for (const option of options) {
      const pool = new Pool(option);
      pools.push(pool);
      if (typeof pool.query !== 'function' || typeof pool.end !== 'function' ||
          typeof pool.on !== 'function') throw new Error(ERROR);
      // Idle connection errors must not terminate the process or log secrets.
      // Active query errors remain visible through each query's promise.
      pool.on('error', () => {});
    }
    let closing;
    return Object.freeze({reservationPool: pools[0], senderRecordPool: pools[1],
      sendRecordReadPool: pools[2], close() {
        return closing ??= endAll(pools);
      }});
  } catch {
    try { await endAll(pools.filter(pool => typeof pool?.end === 'function')); } catch {}
    throw new Error(ERROR);
  }
}
