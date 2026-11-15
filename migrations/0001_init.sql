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
