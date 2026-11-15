import { D1Database, WorkerEnv } from './types';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function randomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPasswordWorker(password: string, existingSaltHex?: string): Promise<string> {
  const saltHex = existingSaltHex || randomHex(16);
  const saltBytes = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return `pbkdf2$${saltHex}$${toHex(new Uint8Array(bits))}`;
}

export async function verifyPasswordWorker(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith('pbkdf2$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, saltHex, expectedHex] = parts;
  const computed = await hashPasswordWorker(password, saltHex);
  const computedHex = computed.split('$')[2] || '';
  return timingSafeEqualBytes(fromHex(computedHex), fromHex(expectedHex));
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS service_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    default_price REAL,
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (area_id) REFERENCES service_areas(id),
    UNIQUE (area_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_date TEXT NOT NULL,
    area_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    quantity REAL,
    unit_price REAL,
    total_amount REAL NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ativo',
    void_reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (area_id) REFERENCES service_areas(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
  )`,
  `CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_date TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    area_id INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ativo',
    void_reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES expense_categories(id),
    FOREIGN KEY (area_id) REFERENCES service_areas(id)
  )`,
  `CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deposit_date TEXT NOT NULL,
    amount REAL NOT NULL,
    bank_name TEXT NOT NULL,
    reference_code TEXT NOT NULL DEFAULT '',
    related_period TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'realizado',
    void_reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role_title TEXT NOT NULL DEFAULT 'Funcionário',
    phone TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    hired_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS commission_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    confirmed_deposits_total REAL NOT NULL,
    commission_rate REAL NOT NULL,
    eligible_employees_count INTEGER NOT NULL,
    per_employee_amount REAL NOT NULL,
    total_commissions_amount REAL NOT NULL,
    company_remaining_amount REAL NOT NULL,
    closed_by TEXT NOT NULL,
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS commission_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    cycle_id INTEGER,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'banco',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ativo',
    void_reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (cycle_id) REFERENCES commission_cycles(id)
  )`,
  `CREATE TABLE IF NOT EXISTS daily_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closing_date TEXT NOT NULL UNIQUE,
    area_breakdown_json TEXT NOT NULL,
    total_sales REAL NOT NULL,
    total_expenses REAL NOT NULL,
    net_after_expenses REAL NOT NULL,
    total_deposited REAL NOT NULL,
    expected_cash REAL NOT NULL,
    counted_cash REAL NOT NULL,
    difference_amount REAL NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    closed_by TEXT NOT NULL,
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    summary TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_date_status ON sales(sale_date, status)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_date_status ON expenses(expense_date, status)`,
  `CREATE INDEX IF NOT EXISTS idx_deposits_date_status ON deposits(deposit_date, status)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)`,
];

let initDone = false;

export async function ensureD1Initialized(env: WorkerEnv): Promise<void> {
  if (initDone) return;
  const db = env.DB;

  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));

  const existingSecret = await db
    .prepare(`SELECT value FROM app_settings WHERE key = 'session_secret'`)
    .first<{ value: string }>();
  if (!existingSecret) {
    await db
      .prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`)
      .bind('session_secret', randomHex(32))
      .run();
  }

  const existingPwd = await db
    .prepare(`SELECT value FROM app_settings WHERE key = 'admin_password_hash'`)
    .first<{ value: string }>();
  if (!existingPwd) {
    const initialPwd = env.ADMIN_INITIAL_PASSWORD || 'NovoPlaneta2026';
    const hashed = await hashPasswordWorker(initialPwd);
    await db.batch([
      db
        .prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`)
        .bind('admin_password_hash', hashed),
      db
        .prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`)
        .bind('is_default_password', '1'),
    ]);
  }

  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('company_name', 'NOVO PLANETA')`),
    db
      .prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('logo_url', '')`),
    db
      .prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('commission_rate', '10')`),
  ]);

  const areaCount = await db
    .prepare(`SELECT COUNT(*) AS count FROM service_areas`)
    .first<{ count: number }>();

  if ((areaCount?.count || 0) === 0) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO service_areas (name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, 1)`
        )
        .bind('CABINE', 'cabine', 'Carregamentos e serviços digitais', 1),
      db
        .prepare(
          `INSERT INTO service_areas (name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, 1)`
        )
        .bind('CASA DE JOGOS', 'casa-de-jogos', 'Consolas e entretenimento', 2),
      db
        .prepare(
          `INSERT INTO service_areas (name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, 1)`
        )
        .bind('GRÁFICA E DESIGN', 'grafica-e-design', 'Impressões, cópias e design gráfico', 3),
    ]);

    const areas = await db
      .prepare(`SELECT id, slug FROM service_areas`)
      .all<{ id: number; slug: string }>();
    const areaMap = new Map(areas.results.map((a) => [a.slug, a.id]));

    const cabineId = areaMap.get('cabine');
    const jogosId = areaMap.get('casa-de-jogos');
    const graficaId = areaMap.get('grafica-e-design');

    const svcInserts: { areaId: number; name: string }[] = [];
    if (cabineId) {
      [
        'Carregamento de telefones',
        'Carregamento de rádios',
        'Carregamento de baterias',
        'Carregamento de outros equipamentos eletrónicos',
        'Envio de músicas',
        'Envio de filmes',
        'Outros serviços',
      ].forEach((name) => svcInserts.push({ areaId: cabineId, name }));
    }
    if (jogosId) {
      ['PlayStation 2', 'PlayStation 3', 'PlayStation 4', 'Outros jogos ou serviços'].forEach(
        (name) => svcInserts.push({ areaId: jogosId, name })
      );
    }
    if (graficaId) {
      [
        'Fotocópias',
        'Impressões',
        'Digitalizações',
        'Plastificações',
        'Encadernações',
        'Criação de websites',
        'Fotografias tipo passe',
        'Cartões de visita',
        'Cartões de passe',
        'Criação de logótipos',
        'Design gráfico',
        'Outros serviços de design',
      ].forEach((name) => svcInserts.push({ areaId: graficaId, name }));
    }

    if (svcInserts.length > 0) {
      await db.batch(
        svcInserts.map((s) =>
          db
            .prepare(`INSERT OR IGNORE INTO services (area_id, name, default_price, active) VALUES (?, ?, NULL, 1)`)
            .bind(s.areaId, s.name)
        )
      );
    }
  }

  const catCount = await db
    .prepare(`SELECT COUNT(*) AS count FROM expense_categories`)
    .first<{ count: number }>();
  if ((catCount?.count || 0) === 0) {
    await db.batch(
      ['Alimentação', 'Combustível', 'Transporte', 'Água', 'Outras despesas'].map((name) =>
        db.prepare(`INSERT OR IGNORE INTO expense_categories (name, active) VALUES (?, 1)`).bind(name)
      )
    );
  }

  initDone = true;
}

export async function getSettingD1(db: D1Database, key: string, fallback = ''): Promise<string> {
  const row = await db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row ? row.value : fallback;
}

export async function setSettingD1(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(key, value)
    .run();
}

export async function recordAuditD1(
  db: D1Database,
  params: {
    actor: string;
    action: string;
    entityType: string;
    entityId?: string | number | null;
    summary: string;
    before?: unknown;
    after?: unknown;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (actor, action, entity_type, entity_id, summary, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.actor,
      params.action,
      params.entityType,
      params.entityId !== undefined && params.entityId !== null ? String(params.entityId) : null,
      params.summary,
      params.before !== undefined ? JSON.stringify(params.before) : null,
      params.after !== undefined ? JSON.stringify(params.after) : null
    )
    .run();
}
