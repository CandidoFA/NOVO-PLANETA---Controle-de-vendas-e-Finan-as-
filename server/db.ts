import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'novo_planeta.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string, existingSalt?: string): string {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const hashBuf = Buffer.from(hash, 'hex');
  if (derived.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(derived, hashBuf);
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      default_price REAL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (area_id) REFERENCES service_areas(id),
      UNIQUE (area_id, name)
    );

    CREATE TABLE IF NOT EXISTS sales (
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
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS expenses (
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
    );

    CREATE TABLE IF NOT EXISTS deposits (
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
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role_title TEXT NOT NULL DEFAULT 'Funcionário',
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      hired_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS commission_cycles (
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
    );

    CREATE TABLE IF NOT EXISTS commission_payments (
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
    );

    CREATE TABLE IF NOT EXISTS daily_closings (
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
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date_status ON sales(sale_date, status);
    CREATE INDEX IF NOT EXISTS idx_expenses_date_status ON expenses(expense_date, status);
    CREATE INDEX IF NOT EXISTS idx_deposits_date_status ON deposits(deposit_date, status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  const getSetting = db.prepare('SELECT value FROM app_settings WHERE key = ?');
  const setSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');

  if (!getSetting.get('session_secret')) {
    setSetting.run('session_secret', crypto.randomBytes(32).toString('hex'));
  }
  if (!getSetting.get('admin_password_hash')) {
    setSetting.run('admin_password_hash', hashPassword('NovoPlaneta2026'));
    setSetting.run('is_default_password', '1');
  }
  setSetting.run('company_name', 'NOVO PLANETA');
  setSetting.run('logo_url', '');
  setSetting.run('commission_rate', '10');

  const areaCount = db.prepare('SELECT COUNT(*) AS count FROM service_areas').get() as { count: number };
  if (areaCount.count === 0) {
    const insertArea = db.prepare(
      'INSERT INTO service_areas (name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, 1)'
    );
    const insertService = db.prepare(
      'INSERT INTO services (area_id, name, default_price, active) VALUES (?, ?, NULL, 1)'
    );

    const seedCatalog = db.transaction(() => {
      const cabineId = Number(
        insertArea.run('CABINE', 'cabine', 'Carregamentos e serviços digitais', 1).lastInsertRowid
      );
      [
        'Carregamento de telefones',
        'Carregamento de rádios',
        'Carregamento de baterias',
        'Carregamento de outros equipamentos eletrónicos',
        'Envio de músicas',
        'Envio de filmes',
        'Outros serviços',
      ].forEach((s) => insertService.run(cabineId, s));

      const jogosId = Number(
        insertArea.run('CASA DE JOGOS', 'casa-de-jogos', 'Consolas e entretenimento', 2).lastInsertRowid
      );
      [
        'PlayStation 2',
        'PlayStation 3',
        'PlayStation 4',
        'Outros jogos ou serviços',
      ].forEach((s) => insertService.run(jogosId, s));

      const graficaId = Number(
        insertArea.run('GRÁFICA E DESIGN', 'grafica-e-design', 'Impressões, cópias e design gráfico', 3).lastInsertRowid
      );
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
      ].forEach((s) => insertService.run(graficaId, s));
    });

    seedCatalog();
  }

  const catCount = db.prepare('SELECT COUNT(*) AS count FROM expense_categories').get() as { count: number };
  if (catCount.count === 0) {
    const insertCategory = db.prepare('INSERT INTO expense_categories (name, active) VALUES (?, 1)');
    ['Alimentação', 'Combustível', 'Transporte', 'Água', 'Outras despesas'].forEach((c) =>
      insertCategory.run(c)
    );
  }
}

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  );
}

export function recordAudit(params: {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, summary, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.actor,
    params.action,
    params.entityType,
    params.entityId !== undefined && params.entityId !== null ? String(params.entityId) : null,
    params.summary,
    params.before !== undefined ? JSON.stringify(params.before) : null,
    params.after !== undefined ? JSON.stringify(params.after) : null
  );
}
