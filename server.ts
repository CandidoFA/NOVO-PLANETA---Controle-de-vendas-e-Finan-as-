import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { db, getSetting, hashPassword, initDatabase, recordAudit, setSetting, verifyPassword } from './server/db.ts';
import {
  addDaysISOServer,
  buildDailyClosingPreview,
  buildDashboardData,
  computeGlobalFinancialState,
  getTodayISOServer,
} from './server/financeLogic.ts';

initDatabase();

const PORT = 3000;
const SESSION_COOKIE = 'np_session';

interface SessionPayload {
  role: 'CEO' | 'PCA';
  exp: number;
  nonce: string;
}

interface AuthenticatedRequest extends Request {
  adminRole?: 'CEO' | 'PCA';
}

function getSessionSecret(): string {
  return process.env.SESSION_SECRET || getSetting('session_secret');
}

function signToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || (parsed.role !== 'CEO' && parsed.role !== 'PCA')) return null;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (cookieToken) return cookieToken;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return undefined;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const payload = verifyToken(extractToken(req));
  if (!payload) {
    res.status(401).json({ error: 'Sessão não autenticada ou expirada. Inicie sessão novamente.' });
    return;
  }
  req.adminRole = payload.role;
  next();
}

function isValidISODate(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function toSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `area-${Date.now()}`;
}

// Simple in-memory login attempt tracking per IP
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'novo-planeta-financas' });
  });

  // Public auth status & branding (does NOT leak any financial data)
  app.get('/api/auth/status', (req, res) => {
    const payload = verifyToken(extractToken(req));
    res.json({
      authenticated: Boolean(payload),
      role: payload ? payload.role : null,
      companyName: getSetting('company_name', 'NOVO PLANETA'),
      logoUrl: getSetting('logo_url', ''),
      isDefaultPassword: getSetting('is_default_password', '0') === '1',
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.lockedUntil > now) {
      const waitSeconds = Math.ceil((attempt.lockedUntil - now) / 1000);
      res.status(429).json({
        error: `Demasiadas tentativas falhadas. Aguarde ${waitSeconds} segundos antes de tentar novamente.`,
      });
      return;
    }

    const { role, password } = req.body as { role?: string; password?: string };
    if (role !== 'CEO' && role !== 'PCA') {
      res.status(400).json({ error: 'Selecione um perfil autorizado (CEO ou PCA).' });
      return;
    }
    if (typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ error: 'Introduza a palavra-passe administrativa.' });
      return;
    }

    const storedHash = getSetting('admin_password_hash');
    if (!verifyPassword(password, storedHash)) {
      const current = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
      const nextCount = current.count + 1;
      loginAttempts.set(ip, {
        count: nextCount,
        lockedUntil: nextCount >= 5 ? now + 60_000 : 0,
      });
      res.status(401).json({ error: 'Palavra-passe incorreta.' });
      return;
    }

    loginAttempts.delete(ip);

    const token = signToken({
      role,
      exp: now + 1000 * 60 * 60 * 24 * 7, // 7 days
      nonce: crypto.randomBytes(8).toString('hex'),
    });

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: '/',
    });

    recordAudit({
      actor: role,
      action: 'LOGIN',
      entityType: 'sessao',
      summary: `Início de sessão autorizado (${role}).`,
    });

    res.json({
      ok: true,
      role,
      token,
      isDefaultPassword: getSetting('is_default_password', '0') === '1',
    });
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    const payload = verifyToken(extractToken(req));
    if (payload) {
      recordAudit({
        actor: payload.role,
        action: 'LOGOUT',
        entityType: 'sessao',
        summary: `Sessão encerrada (${payload.role}).`,
      });
    }
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      path: '/',
    });
    res.json({ ok: true });
  });

  // Protected API routes below
  app.use('/api', requireAuth);

  app.post('/api/auth/change-password', (req: AuthenticatedRequest, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Preencha a palavra-passe atual e a nova palavra-passe.' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'A nova palavra-passe deve ter pelo menos 6 caracteres.' });
      return;
    }
    const storedHash = getSetting('admin_password_hash');
    if (!verifyPassword(currentPassword, storedHash)) {
      res.status(401).json({ error: 'A palavra-passe atual está incorreta.' });
      return;
    }

    setSetting('admin_password_hash', hashPassword(newPassword));
    setSetting('is_default_password', '0');

    recordAudit({
      actor: req.adminRole!,
      action: 'ALTERAR_SENHA',
      entityType: 'seguranca',
      summary: 'Palavra-passe administrativa partilhada (CEO/PCA) alterada.',
    });

    res.json({ ok: true });
  });

  // Settings (logo URL, company name, commission rate)
  app.get('/api/settings', (_req, res) => {
    res.json({
      companyName: getSetting('company_name', 'NOVO PLANETA'),
      logoUrl: getSetting('logo_url', ''),
      commissionRate: Number(getSetting('commission_rate', '10')) || 10,
      isDefaultPassword: getSetting('is_default_password', '0') === '1',
    });
  });

  app.put('/api/settings', (req: AuthenticatedRequest, res) => {
    const { logoUrl, commissionRate, companyName } = req.body as {
      logoUrl?: string;
      commissionRate?: number;
      companyName?: string;
    };
    const before = {
      companyName: getSetting('company_name', 'NOVO PLANETA'),
      logoUrl: getSetting('logo_url', ''),
      commissionRate: Number(getSetting('commission_rate', '10')) || 10,
    };

    if (typeof logoUrl === 'string') {
      const trimmed = logoUrl.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('data:image/')) {
        res.status(400).json({ error: 'O link do logótipo deve começar por http:// ou https://.' });
        return;
      }
      setSetting('logo_url', trimmed);
    }

    if (typeof companyName === 'string' && companyName.trim().length > 0) {
      setSetting('company_name', companyName.trim().slice(0, 80));
    }

    if (commissionRate !== undefined) {
      const rate = Number(commissionRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        res.status(400).json({ error: 'A percentagem de comissão deve estar entre 0% e 100%.' });
        return;
      }
      setSetting('commission_rate', String(rate));
    }

    const after = {
      companyName: getSetting('company_name', 'NOVO PLANETA'),
      logoUrl: getSetting('logo_url', ''),
      commissionRate: Number(getSetting('commission_rate', '10')) || 10,
    };

    recordAudit({
      actor: req.adminRole!,
      action: 'ATUALIZAR_DEFINICOES',
      entityType: 'definicoes',
      summary: 'Configurações do sistema atualizadas.',
      before,
      after,
    });

    res.json(after);
  });

  // Dashboard
  app.get('/api/dashboard', (req, res) => {
    const today = getTodayISOServer();
    const startDate = isValidISODate(req.query.startDate) ? req.query.startDate : today;
    const endDate = isValidISODate(req.query.endDate) ? req.query.endDate : today;
    if (startDate > endDate) {
      res.status(400).json({ error: 'A data inicial não pode ser superior à data final.' });
      return;
    }
    res.json(buildDashboardData(startDate, endDate));
  });

  // Areas & Services Catalog
  app.get('/api/catalog', (_req, res) => {
    const areas = db
      .prepare(
        `SELECT id, name, slug, description, sort_order AS sortOrder, active
         FROM service_areas
         ORDER BY sort_order ASC, id ASC`
      )
      .all();
    const services = db
      .prepare(
        `SELECT s.id, s.area_id AS areaId, sa.name AS areaName, s.name, s.default_price AS defaultPrice, s.active
         FROM services s
         JOIN service_areas sa ON sa.id = s.area_id
         ORDER BY sa.sort_order ASC, s.id ASC`
      )
      .all();
    res.json({ areas, services });
  });

  app.post('/api/areas', (req: AuthenticatedRequest, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    const cleanName = typeof name === 'string' ? name.trim().toUpperCase() : '';
    if (!cleanName) {
      res.status(400).json({ error: 'Indique o nome da nova área de serviços.' });
      return;
    }
    const existing = db.prepare('SELECT id FROM service_areas WHERE LOWER(name) = LOWER(?)').get(cleanName);
    if (existing) {
      res.status(409).json({ error: 'Já existe uma área com esse nome.' });
      return;
    }
    const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM service_areas').get() as { m: number }).m;
    const slug = toSlug(cleanName);
    const info = db
      .prepare('INSERT INTO service_areas (name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, 1)')
      .run(cleanName, slug, typeof description === 'string' ? description.trim() : '', maxOrder + 1);

    const created = db
      .prepare('SELECT id, name, slug, description, sort_order AS sortOrder, active FROM service_areas WHERE id = ?')
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'CRIAR_AREA',
      entityType: 'area',
      entityId: Number(info.lastInsertRowid),
      summary: `Nova área criada: ${cleanName}`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.put('/api/areas/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM service_areas WHERE id = ?').get(id) as
      | { id: number; name: string; description: string; active: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Área não encontrada.' });
      return;
    }
    const { name, description, active } = req.body as {
      name?: string;
      description?: string;
      active?: number;
    };
    const nextName = typeof name === 'string' && name.trim() ? name.trim().toUpperCase() : existing.name;
    const nextDesc = typeof description === 'string' ? description.trim() : existing.description;
    const nextActive = active === 0 || active === 1 ? active : existing.active;

    db.prepare('UPDATE service_areas SET name = ?, description = ?, active = ? WHERE id = ?').run(
      nextName,
      nextDesc,
      nextActive,
      id
    );

    const updated = db
      .prepare('SELECT id, name, slug, description, sort_order AS sortOrder, active FROM service_areas WHERE id = ?')
      .get(id);

    recordAudit({
      actor: req.adminRole!,
      action: 'EDITAR_AREA',
      entityType: 'area',
      entityId: id,
      summary: `Área atualizada: ${nextName}`,
      before: existing,
      after: updated,
    });

    res.json(updated);
  });

  app.delete('/api/areas/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM service_areas WHERE id = ?').get(id) as
      | { id: number; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Área não encontrada.' });
      return;
    }
    const usage = db.prepare('SELECT COUNT(*) AS cnt FROM sales WHERE area_id = ?').get(id) as { cnt: number };
    if (usage.cnt > 0) {
      db.prepare('UPDATE service_areas SET active = 0 WHERE id = ?').run(id);
      recordAudit({
        actor: req.adminRole!,
        action: 'DESATIVAR_AREA',
        entityType: 'area',
        entityId: id,
        summary: `Área desativada (possui histórico de vendas): ${existing.name}`,
      });
      res.json({ ok: true, deactivated: true });
      return;
    }
    db.prepare('DELETE FROM services WHERE area_id = ?').run(id);
    db.prepare('DELETE FROM service_areas WHERE id = ?').run(id);
    recordAudit({
      actor: req.adminRole!,
      action: 'ELIMINAR_AREA',
      entityType: 'area',
      entityId: id,
      summary: `Área eliminada: ${existing.name}`,
      before: existing,
    });
    res.json({ ok: true, deactivated: false });
  });

  app.post('/api/services', (req: AuthenticatedRequest, res) => {
    const { areaId, name, defaultPrice } = req.body as {
      areaId?: number;
      name?: string;
      defaultPrice?: number | null;
    };
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!areaId || !cleanName) {
      res.status(400).json({ error: 'Selecione a área e indique o nome do serviço.' });
      return;
    }
    const area = db.prepare('SELECT id, name FROM service_areas WHERE id = ?').get(Number(areaId)) as
      | { id: number; name: string }
      | undefined;
    if (!area) {
      res.status(404).json({ error: 'Área de serviços inválida.' });
      return;
    }
    const dup = db
      .prepare('SELECT id FROM services WHERE area_id = ? AND LOWER(name) = LOWER(?)')
      .get(area.id, cleanName);
    if (dup) {
      res.status(409).json({ error: 'Este serviço já existe nesta área.' });
      return;
    }
    const priceVal =
      defaultPrice !== undefined && defaultPrice !== null && Number(defaultPrice) > 0
        ? Number(defaultPrice)
        : null;

    const info = db
      .prepare('INSERT INTO services (area_id, name, default_price, active) VALUES (?, ?, ?, 1)')
      .run(area.id, cleanName, priceVal);

    const created = db
      .prepare(
        `SELECT s.id, s.area_id AS areaId, sa.name AS areaName, s.name, s.default_price AS defaultPrice, s.active
         FROM services s JOIN service_areas sa ON sa.id = s.area_id WHERE s.id = ?`
      )
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'CRIAR_SERVICO',
      entityType: 'servico',
      entityId: Number(info.lastInsertRowid),
      summary: `Serviço adicionado em ${area.name}: ${cleanName}`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.put('/api/services/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as
      | { id: number; area_id: number; name: string; default_price: number | null; active: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Serviço não encontrado.' });
      return;
    }
    const { name, areaId, defaultPrice, active } = req.body as {
      name?: string;
      areaId?: number;
      defaultPrice?: number | null;
      active?: number;
    };

    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    const nextAreaId = areaId ? Number(areaId) : existing.area_id;
    const nextPrice =
      defaultPrice === null
        ? null
        : defaultPrice !== undefined && Number(defaultPrice) > 0
          ? Number(defaultPrice)
          : existing.default_price;
    const nextActive = active === 0 || active === 1 ? active : existing.active;

    db.prepare('UPDATE services SET name = ?, area_id = ?, default_price = ?, active = ? WHERE id = ?').run(
      nextName,
      nextAreaId,
      nextPrice,
      nextActive,
      id
    );

    const updated = db
      .prepare(
        `SELECT s.id, s.area_id AS areaId, sa.name AS areaName, s.name, s.default_price AS defaultPrice, s.active
         FROM services s JOIN service_areas sa ON sa.id = s.area_id WHERE s.id = ?`
      )
      .get(id);

    recordAudit({
      actor: req.adminRole!,
      action: 'EDITAR_SERVICO',
      entityType: 'servico',
      entityId: id,
      summary: `Serviço atualizado: ${nextName}`,
      before: existing,
      after: updated,
    });

    res.json(updated);
  });

  app.delete('/api/services/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as
      | { id: number; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Serviço não encontrado.' });
      return;
    }
    const usage = db.prepare('SELECT COUNT(*) AS cnt FROM sales WHERE service_id = ?').get(id) as { cnt: number };
    if (usage.cnt > 0) {
      db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(id);
      recordAudit({
        actor: req.adminRole!,
        action: 'DESATIVAR_SERVICO',
        entityType: 'servico',
        entityId: id,
        summary: `Serviço desativado (possui vendas registadas): ${existing.name}`,
      });
      res.json({ ok: true, deactivated: true });
      return;
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    recordAudit({
      actor: req.adminRole!,
      action: 'ELIMINAR_SERVICO',
      entityType: 'servico',
      entityId: id,
      summary: `Serviço eliminado: ${existing.name}`,
      before: existing,
    });
    res.json({ ok: true, deactivated: false });
  });

  // Sales
  app.get('/api/sales', (req, res) => {
    const { startDate, endDate, areaId, search, includeVoided } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (includeVoided !== 'true') {
      conditions.push(`s.status = 'ativo'`);
    }
    if (isValidISODate(startDate)) {
      conditions.push(`s.sale_date >= ?`);
      params.push(startDate);
    }
    if (isValidISODate(endDate)) {
      conditions.push(`s.sale_date <= ?`);
      params.push(endDate);
    }
    if (areaId && Number(areaId) > 0) {
      conditions.push(`s.area_id = ?`);
      params.push(Number(areaId));
    }
    if (search && search.trim()) {
      conditions.push(`(LOWER(sv.name) LIKE ? OR LOWER(sa.name) LIKE ? OR LOWER(s.notes) LIKE ? OR s.sale_date LIKE ?)`);
      const q = `%${search.trim().toLowerCase()}%`;
      params.push(q, q, q, q);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT
          s.id, s.sale_date AS saleDate, s.area_id AS areaId, sa.name AS areaName,
          s.service_id AS serviceId, sv.name AS serviceName,
          s.quantity, s.unit_price AS unitPrice, s.total_amount AS totalAmount,
          s.notes, s.status, s.void_reason AS voidReason,
          s.created_by AS createdBy, s.created_at AS createdAt, s.updated_at AS updatedAt
         FROM sales s
         JOIN service_areas sa ON sa.id = s.area_id
         JOIN services sv ON sv.id = s.service_id
         ${where}
         ORDER BY s.sale_date DESC, s.id DESC`
      )
      .all(...params);

    res.json(rows);
  });

  app.post('/api/sales', (req: AuthenticatedRequest, res) => {
    const { saleDate, areaId, serviceId, quantity, unitPrice, totalAmount, notes } = req.body as {
      saleDate?: string;
      areaId?: number;
      serviceId?: number;
      quantity?: number | null;
      unitPrice?: number | null;
      totalAmount?: number;
      notes?: string;
    };

    if (!isValidISODate(saleDate)) {
      res.status(400).json({ error: 'Data da venda inválida.' });
      return;
    }
    const service = db
      .prepare('SELECT id, area_id, name FROM services WHERE id = ?')
      .get(Number(serviceId)) as { id: number; area_id: number; name: string } | undefined;
    if (!service) {
      res.status(400).json({ error: 'Selecione um serviço válido.' });
      return;
    }
    const resolvedAreaId = areaId ? Number(areaId) : service.area_id;
    const area = db.prepare('SELECT id, name FROM service_areas WHERE id = ?').get(resolvedAreaId) as
      | { id: number; name: string }
      | undefined;
    if (!area) {
      res.status(400).json({ error: 'Área de serviços inválida.' });
      return;
    }

    const qty = quantity !== null && quantity !== undefined && Number(quantity) > 0 ? Number(quantity) : null;
    const unit = unitPrice !== null && unitPrice !== undefined && Number(unitPrice) > 0 ? Number(unitPrice) : null;
    const total =
      totalAmount !== undefined && Number(totalAmount) > 0
        ? Number(totalAmount)
        : qty !== null && unit !== null
          ? qty * unit
          : 0;

    if (!Number.isFinite(total) || total <= 0) {
      res.status(400).json({ error: 'O valor total da venda deve ser superior a 0 Kz.' });
      return;
    }

    const info = db
      .prepare(
        `INSERT INTO sales (sale_date, area_id, service_id, quantity, unit_price, total_amount, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo', ?)`
      )
      .run(saleDate, resolvedAreaId, service.id, qty, unit, total, typeof notes === 'string' ? notes.trim() : '', req.adminRole!);

    const created = db
      .prepare(
        `SELECT s.id, s.sale_date AS saleDate, s.area_id AS areaId, sa.name AS areaName,
          s.service_id AS serviceId, sv.name AS serviceName,
          s.quantity, s.unit_price AS unitPrice, s.total_amount AS totalAmount,
          s.notes, s.status, s.void_reason AS voidReason,
          s.created_by AS createdBy, s.created_at AS createdAt, s.updated_at AS updatedAt
         FROM sales s
         JOIN service_areas sa ON sa.id = s.area_id
         JOIN services sv ON sv.id = s.service_id
         WHERE s.id = ?`
      )
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'CRIAR_VENDA',
      entityType: 'venda',
      entityId: Number(info.lastInsertRowid),
      summary: `Venda registada em ${area.name} (${service.name}): ${total} Kz em ${saleDate}`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.put('/api/sales/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as
      | {
          id: number;
          sale_date: string;
          area_id: number;
          service_id: number;
          quantity: number | null;
          unit_price: number | null;
          total_amount: number;
          notes: string;
          status: string;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Registo de venda não encontrado.' });
      return;
    }
    if (existing.status === 'anulado') {
      res.status(400).json({ error: 'Não é possível editar uma venda já anulada.' });
      return;
    }

    const { saleDate, areaId, serviceId, quantity, unitPrice, totalAmount, notes } = req.body as {
      saleDate?: string;
      areaId?: number;
      serviceId?: number;
      quantity?: number | null;
      unitPrice?: number | null;
      totalAmount?: number;
      notes?: string;
    };

    const nextDate = isValidISODate(saleDate) ? saleDate : existing.sale_date;
    const nextServiceId = serviceId ? Number(serviceId) : existing.service_id;
    const nextAreaId = areaId ? Number(areaId) : existing.area_id;
    const nextQty = quantity === null ? null : quantity !== undefined ? Number(quantity) : existing.quantity;
    const nextUnit = unitPrice === null ? null : unitPrice !== undefined ? Number(unitPrice) : existing.unit_price;
    const nextTotal = totalAmount !== undefined ? Number(totalAmount) : existing.total_amount;
    if (!Number.isFinite(nextTotal) || nextTotal <= 0) {
      res.status(400).json({ error: 'O valor total da venda deve ser superior a 0 Kz.' });
      return;
    }

    db.prepare(
      `UPDATE sales
       SET sale_date = ?, area_id = ?, service_id = ?, quantity = ?, unit_price = ?, total_amount = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      nextDate,
      nextAreaId,
      nextServiceId,
      nextQty,
      nextUnit,
      nextTotal,
      typeof notes === 'string' ? notes.trim() : existing.notes,
      id
    );

    const updated = db
      .prepare(
        `SELECT s.id, s.sale_date AS saleDate, s.area_id AS areaId, sa.name AS areaName,
          s.service_id AS serviceId, sv.name AS serviceName,
          s.quantity, s.unit_price AS unitPrice, s.total_amount AS totalAmount,
          s.notes, s.status, s.void_reason AS voidReason,
          s.created_by AS createdBy, s.created_at AS createdAt, s.updated_at AS updatedAt
         FROM sales s
         JOIN service_areas sa ON sa.id = s.area_id
         JOIN services sv ON sv.id = s.service_id
         WHERE s.id = ?`
      )
      .get(id);

    recordAudit({
      actor: req.adminRole!,
      action: 'EDITAR_VENDA',
      entityType: 'venda',
      entityId: id,
      summary: `Venda #${id} alterada (${existing.total_amount} Kz -> ${nextTotal} Kz).`,
      before: existing,
      after: updated,
    });

    res.json(updated);
  });

  app.post('/api/sales/:id/void', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body as { reason?: string };
    const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as
      | { id: number; total_amount: number; status: string; sale_date: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Venda não encontrada.' });
      return;
    }
    if (existing.status === 'anulado') {
      res.status(400).json({ error: 'Esta venda já se encontra anulada.' });
      return;
    }
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    db.prepare(
      `UPDATE sales SET status = 'anulado', void_reason = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(cleanReason, id);

    recordAudit({
      actor: req.adminRole!,
      action: 'ANULAR_VENDA',
      entityType: 'venda',
      entityId: id,
      summary: `Venda #${id} (${existing.total_amount} Kz de ${existing.sale_date}) anulada. Motivo: ${cleanReason}`,
      before: existing,
    });

    res.json({ ok: true });
  });

  // Expense categories
  app.get('/api/expense-categories', (_req, res) => {
    const rows = db.prepare('SELECT id, name, active FROM expense_categories ORDER BY id ASC').all();
    res.json(rows);
  });

  app.post('/api/expense-categories', (req: AuthenticatedRequest, res) => {
    const { name } = req.body as { name?: string };
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean) {
      res.status(400).json({ error: 'Indique o nome da categoria de despesa.' });
      return;
    }
    const dup = db.prepare('SELECT id FROM expense_categories WHERE LOWER(name) = LOWER(?)').get(clean);
    if (dup) {
      res.status(409).json({ error: 'Já existe uma categoria com esse nome.' });
      return;
    }
    const info = db.prepare('INSERT INTO expense_categories (name, active) VALUES (?, 1)').run(clean);
    const created = db.prepare('SELECT id, name, active FROM expense_categories WHERE id = ?').get(info.lastInsertRowid);
    recordAudit({
      actor: req.adminRole!,
      action: 'CRIAR_CATEGORIA_DESPESA',
      entityType: 'categoria_despesa',
      entityId: Number(info.lastInsertRowid),
      summary: `Categoria de despesa criada: ${clean}`,
      after: created,
    });
    res.status(201).json(created);
  });

  app.put('/api/expense-categories/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id) as
      | { id: number; name: string; active: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Categoria não encontrada.' });
      return;
    }
    const { name, active } = req.body as { name?: string; active?: number };
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    const nextActive = active === 0 || active === 1 ? active : existing.active;
    db.prepare('UPDATE expense_categories SET name = ?, active = ? WHERE id = ?').run(nextName, nextActive, id);
    const updated = db.prepare('SELECT id, name, active FROM expense_categories WHERE id = ?').get(id);
    recordAudit({
      actor: req.adminRole!,
      action: 'EDITAR_CATEGORIA_DESPESA',
      entityType: 'categoria_despesa',
      entityId: id,
      summary: `Categoria atualizada: ${nextName}`,
      before: existing,
      after: updated,
    });
    res.json(updated);
  });

  app.delete('/api/expense-categories/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id) as
      | { id: number; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Categoria não encontrada.' });
      return;
    }
    const usage = db.prepare('SELECT COUNT(*) AS cnt FROM expenses WHERE category_id = ?').get(id) as { cnt: number };
    if (usage.cnt > 0) {
      db.prepare('UPDATE expense_categories SET active = 0 WHERE id = ?').run(id);
      recordAudit({
        actor: req.adminRole!,
        action: 'DESATIVAR_CATEGORIA_DESPESA',
        entityType: 'categoria_despesa',
        entityId: id,
        summary: `Categoria desativada (possui despesas registadas): ${existing.name}`,
      });
      res.json({ ok: true, deactivated: true });
      return;
    }
    db.prepare('DELETE FROM expense_categories WHERE id = ?').run(id);
    recordAudit({
      actor: req.adminRole!,
      action: 'ELIMINAR_CATEGORIA_DESPESA',
      entityType: 'categoria_despesa',
      entityId: id,
      summary: `Categoria eliminada: ${existing.name}`,
    });
    res.json({ ok: true, deactivated: false });
  });

  // Expenses
  app.get('/api/expenses', (req, res) => {
    const { startDate, endDate, categoryId, includeVoided } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (includeVoided !== 'true') {
      conditions.push(`e.status = 'ativo'`);
    }
    if (isValidISODate(startDate)) {
      conditions.push(`e.expense_date >= ?`);
      params.push(startDate);
    }
    if (isValidISODate(endDate)) {
      conditions.push(`e.expense_date <= ?`);
      params.push(endDate);
    }
    if (categoryId && Number(categoryId) > 0) {
      conditions.push(`e.category_id = ?`);
      params.push(Number(categoryId));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT
          e.id, e.expense_date AS expenseDate, e.category_id AS categoryId, ec.name AS categoryName,
          e.description, e.amount, e.area_id AS areaId, sa.name AS areaName,
          e.notes, e.status, e.void_reason AS voidReason,
          e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt
         FROM expenses e
         JOIN expense_categories ec ON ec.id = e.category_id
         LEFT JOIN service_areas sa ON sa.id = e.area_id
         ${where}
         ORDER BY e.expense_date DESC, e.id DESC`
      )
      .all(...params);
    res.json(rows);
  });

  app.post('/api/expenses', (req: AuthenticatedRequest, res) => {
    const { expenseDate, categoryId, description, amount, areaId, notes } = req.body as {
      expenseDate?: string;
      categoryId?: number;
      description?: string;
      amount?: number;
      areaId?: number | null;
      notes?: string;
    };

    if (!isValidISODate(expenseDate)) {
      res.status(400).json({ error: 'Data da despesa inválida.' });
      return;
    }
    const category = db.prepare('SELECT id, name FROM expense_categories WHERE id = ?').get(Number(categoryId)) as
      | { id: number; name: string }
      | undefined;
    if (!category) {
      res.status(400).json({ error: 'Selecione uma categoria válida.' });
      return;
    }
    const cleanDesc = typeof description === 'string' ? description.trim() : '';
    if (!cleanDesc) {
      res.status(400).json({ error: 'Indique a descrição da despesa.' });
      return;
    }
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      res.status(400).json({ error: 'O valor da despesa deve ser superior a 0 Kz.' });
      return;
    }

    const resolvedAreaId = areaId && Number(areaId) > 0 ? Number(areaId) : null;
    const info = db
      .prepare(
        `INSERT INTO expenses (expense_date, category_id, description, amount, area_id, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?)`
      )
      .run(
        expenseDate,
        category.id,
        cleanDesc,
        val,
        resolvedAreaId,
        typeof notes === 'string' ? notes.trim() : '',
        req.adminRole!
      );

    const created = db
      .prepare(
        `SELECT e.id, e.expense_date AS expenseDate, e.category_id AS categoryId, ec.name AS categoryName,
          e.description, e.amount, e.area_id AS areaId, sa.name AS areaName,
          e.notes, e.status, e.void_reason AS voidReason,
          e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt
         FROM expenses e
         JOIN expense_categories ec ON ec.id = e.category_id
         LEFT JOIN service_areas sa ON sa.id = e.area_id
         WHERE e.id = ?`
      )
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'CRIAR_DESPESA',
      entityType: 'despesa',
      entityId: Number(info.lastInsertRowid),
      summary: `Despesa registada (${category.name} · ${cleanDesc}): ${val} Kz em ${expenseDate}`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.put('/api/expenses/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as
      | {
          id: number;
          expense_date: string;
          category_id: number;
          description: string;
          amount: number;
          area_id: number | null;
          notes: string;
          status: string;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Despesa não encontrada.' });
      return;
    }
    if (existing.status === 'anulado') {
      res.status(400).json({ error: 'Não é possível editar uma despesa anulada.' });
      return;
    }

    const { expenseDate, categoryId, description, amount, areaId, notes } = req.body as {
      expenseDate?: string;
      categoryId?: number;
      description?: string;
      amount?: number;
      areaId?: number | null;
      notes?: string;
    };

    const nextDate = isValidISODate(expenseDate) ? expenseDate : existing.expense_date;
    const nextCat = categoryId ? Number(categoryId) : existing.category_id;
    const nextDesc = typeof description === 'string' && description.trim() ? description.trim() : existing.description;
    const nextAmount = amount !== undefined ? Number(amount) : existing.amount;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      res.status(400).json({ error: 'O valor da despesa deve ser superior a 0 Kz.' });
      return;
    }
    const nextArea = areaId === null ? null : areaId !== undefined ? Number(areaId) : existing.area_id;

    db.prepare(
      `UPDATE expenses SET expense_date = ?, category_id = ?, description = ?, amount = ?, area_id = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      nextDate,
      nextCat,
      nextDesc,
      nextAmount,
      nextArea,
      typeof notes === 'string' ? notes.trim() : existing.notes,
      id
    );

    const updated = db
      .prepare(
        `SELECT e.id, e.expense_date AS expenseDate, e.category_id AS categoryId, ec.name AS categoryName,
          e.description, e.amount, e.area_id AS areaId, sa.name AS areaName,
          e.notes, e.status, e.void_reason AS voidReason,
          e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt
         FROM expenses e
         JOIN expense_categories ec ON ec.id = e.category_id
         LEFT JOIN service_areas sa ON sa.id = e.area_id
         WHERE e.id = ?`
      )
      .get(id);

    recordAudit({
      actor: req.adminRole!,
      action: 'EDITAR_DESPESA',
      entityType: 'despesa',
      entityId: id,
      summary: `Despesa #${id} alterada (${existing.amount} Kz -> ${nextAmount} Kz).`,
      before: existing,
      after: updated,
    });

    res.json(updated);
  });

  app.post('/api/expenses/:id/void', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body as { reason?: string };
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as
      | { id: number; amount: number; description: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Despesa não encontrada.' });
      return;
    }
    if (existing.status === 'anulado') {
      res.status(400).json({ error: 'Esta despesa já se encontra anulada.' });
      return;
    }
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    db.prepare(`UPDATE expenses SET status = 'anulado', void_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(
      cleanReason,
      id
    );

    recordAudit({
      actor: req.adminRole!,
      action: 'ANULAR_DESPESA',
      entityType: 'despesa',
      entityId: id,
      summary: `Despesa #${id} (${existing.description} · ${existing.amount} Kz) anulada. Motivo: ${cleanReason}`,
      before: existing,
    });

    res.json({ ok: true });
  });

  // Deposits
  app.get('/api/deposits', (req, res) => {
    const { startDate, endDate, status, includeVoided } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (includeVoided !== 'true' && status !== 'anulado') {
      conditions.push(`status != 'anulado'`);
    }
    if (status && ['realizado', 'pendente', 'anulado'].includes(status)) {
      conditions.push(`status = ?`);
      params.push(status);
    }
    if (isValidISODate(startDate)) {
      conditions.push(`deposit_date >= ?`);
      params.push(startDate);
    }
    if (isValidISODate(endDate)) {
      conditions.push(`deposit_date <= ?`);
      params.push(endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT
          id, deposit_date AS depositDate, amount, bank_name AS bankName,
          reference_code AS referenceCode, related_period AS relatedPeriod,
          notes, status, void_reason AS voidReason,
          created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
         FROM deposits
         ${where}
         ORDER BY deposit_date DESC, id DESC`
      )
      .all(...params);

    const today = getTodayISOServer();
    const weekStart = addDaysISOServer(today, -6);
    const fourWeeksStart = addDaysISOServer(today, -27);

    const dailyTotal = (
      db
        .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date = ?`)
        .get(today) as { total: number }
    ).total;
    const weeklyTotal = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`
        )
        .get(weekStart, today) as { total: number }
    ).total;
    const fourWeeksTotal = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`
        )
        .get(fourWeeksStart, today) as { total: number }
    ).total;
    const pendingTotal = (
      db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'pendente'`).get() as {
        total: number;
      }
    ).total;

    res.json({
      deposits: rows,
      summary: {
        dailyTotal,
        weeklyTotal,
        fourWeeksTotal,
        pendingTotal,
      },
    });
  });

  app.post('/api/deposits', (req: AuthenticatedRequest, res) => {
    const { depositDate, amount, bankName, referenceCode, relatedPeriod, notes, status } = req.body as {
      depositDate?: string;
      amount?: number;
      bankName?: string;
      referenceCode?: string;
      relatedPeriod?: string;
      notes?: string;
      status?: 'realizado' | 'pendente';
    };

    if (!isValidISODate(depositDate)) {
      res.status(400).json({ error: 'Data do depósito inválida.' });
      return;
    }
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      res.status(400).json({ error: 'O valor depositado deve ser superior a 0 Kz.' });
      return;
    }
    const cleanBank = typeof bankName === 'string' ? bankName.trim() : '';
    if (!cleanBank) {
      res.status(400).json({ error: 'Indique o banco ou instituição financeira.' });
      return;
    }
    const cleanRef = typeof referenceCode === 'string' ? referenceCode.trim() : '';
    if (cleanRef) {
      const dupRef = db
        .prepare(`SELECT id FROM deposits WHERE LOWER(reference_code) = LOWER(?) AND status != 'anulado'`)
        .get(cleanRef);
      if (dupRef) {
        res.status(409).json({
          error: 'Já existe um depósito registado com este número de comprovativo/referência (evitar duplicação).',
        });
        return;
      }
    }

    const nextStatus = status === 'pendente' ? 'pendente' : 'realizado';
    const info = db
      .prepare(
        `INSERT INTO deposits (deposit_date, amount, bank_name, reference_code, related_period, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        depositDate,
        val,
        cleanBank,
        cleanRef,
        typeof relatedPeriod === 'string' ? relatedPeriod.trim() : '',
        typeof notes === 'string' ? notes.trim() : '',
        nextStatus,
        req.adminRole!
      );

    const created = db
      .prepare(
        `SELECT id, deposit_date AS depositDate, amount, bank_name AS bankName,
          reference_code AS referenceCode, related_period AS relatedPeriod,
          notes, status, void_reason AS voidReason,
          created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
         FROM deposits WHERE id = ?`
      )
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'CRIAR_DEPOSITO',
      entityType: 'deposito',
      entityId: Number(info.lastInsertRowid),
      summary: `Depósito (${nextStatus}) em ${cleanBank}: ${val} Kz em ${depositDate}`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.put('/api/deposits/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id) as
      | {
          id: number;
          deposit_date: string;
          amount: number;
          bank_name: string;
          reference_code: string;
          related_period: string;
          notes: string;
          status: string;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Depósito não encontrado.' });
      return;
    }
    if (existing.status === 'anulado') {
      res.status(400).json({ error: 'Não é possível editar um depósito anulado.' });
      return;
    }

    const { depositDate, amount, bankName, referenceCode, relatedPeriod, notes, status } = req.body as {
      depositDate?: string;
      amount?: number;
      bankName?: string;
      referenceCode?: string;
      relatedPeriod?: string;
      notes?: string;
      status?: 'realizado' | 'pendente';
    };

    const nextDate = isValidISODate(depositDate) ? depositDate : existing.deposit_date;
    const nextAmount = amount !== undefined ? Number(amount) : existing.amount;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      res.status(400).json({ error: 'O valor do depósito deve ser superior a 0 Kz.' });
      return;
    }
    const nextBank = typeof bankName === 'string' && bankName.trim() ? bankName.trim() : existing.bank_name;
    const nextRef = typeof referenceCode === 'string' ? referenceCode.trim() : existing.reference_code;
    const nextRelated = typeof relatedPeriod === 'string' ? relatedPeriod.trim() : existing.related_period;
    const nextNotes = typeof notes === 'string' ? notes.trim() : existing.notes;
    const nextStatus = status === 'pendente' || status === 'realizado' ? status : existing.status;

    if (nextRef) {
      const dupRef = db
        .prepare(`SELECT id FROM deposits WHERE LOWER(reference_code) = LOWER(?) AND id != ? AND status != 'anulado'`)
        .get(nextRef, id);
      if (dupRef) {
        res.status(409).json({ error: 'Já existe outro depósito com essa referência.' });
        return;
      }
    }

    db.prepare(
      `UPDATE deposits
       SET deposit_date = ?, amount = ?, bank_name = ?, reference_code = ?, related_period = ?, notes = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(nextDate, nextAmount, nextBank, nextRef, nextRelated, nextNotes, nextStatus, id);

    const updated = db
      .prepare(
        `SELECT id, deposit_date AS depositDate, amount, bank_name AS bankName,
          reference_code AS referenceCode, related_period AS relatedPeriod,
          notes, status, void_reason AS voidReason,
          created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
         FROM deposits WHERE id = ?`
      )
      .get(id);

    recordAudit({
      actor: req.adminRole!,
      action: 'EDITAR_DEPOSITO',
      entityType: 'deposito',
      entityId: id,
      summary: `Depósito #${id} atualizado (${existing.status} -> ${nextStatus}, ${nextAmount} Kz).`,
      before: existing,
      after: updated,
    });

    res.json(updated);
  });

  app.post('/api/deposits/:id/void', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body as { reason?: string };
    const existing = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id) as
      | { id: number; amount: number; bank_name: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Depósito não encontrado.' });
      return;
    }
    if (existing.status === 'anulado') {
      res.status(400).json({ error: 'Este depósito já se encontra anulado.' });
      return;
    }
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    db.prepare(`UPDATE deposits SET status = 'anulado', void_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(
      cleanReason,
      id
    );

    recordAudit({
      actor: req.adminRole!,
      action: 'ANULAR_DEPOSITO',
      entityType: 'deposito',
      entityId: id,
      summary: `Depósito #${id} (${existing.bank_name} · ${existing.amount} Kz) anulado. Motivo: ${cleanReason}`,
      before: existing,
    });

    res.json({ ok: true });
  });

  // Employees & Commissions
  app.get('/api/employees', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt
         FROM employees
         ORDER BY active DESC, name ASC`
      )
      .all();
    res.json(rows);
  });

  app.post('/api/employees', (req: AuthenticatedRequest, res) => {
    const { name, roleTitle, phone, hiredDate } = req.body as {
      name?: string;
      roleTitle?: string;
      phone?: string;
      hiredDate?: string;
    };
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      res.status(400).json({ error: 'Indique o nome do funcionário.' });
      return;
    }
    const date = isValidISODate(hiredDate) ? hiredDate : getTodayISOServer();
    const info = db
      .prepare('INSERT INTO employees (name, role_title, phone, active, hired_date) VALUES (?, ?, ?, 1, ?)')
      .run(
        cleanName,
        typeof roleTitle === 'string' && roleTitle.trim() ? roleTitle.trim() : 'Funcionário',
        typeof phone === 'string' ? phone.trim() : '',
        date
      );

    const created = db
      .prepare(
        `SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt
         FROM employees WHERE id = ?`
      )
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'CRIAR_FUNCIONARIO',
      entityType: 'funcionario',
      entityId: Number(info.lastInsertRowid),
      summary: `Funcionário registado: ${cleanName}`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.put('/api/employees/:id', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as
      | { id: number; name: string; role_title: string; phone: string; active: number; hired_date: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Funcionário não encontrado.' });
      return;
    }
    const { name, roleTitle, phone, active, hiredDate } = req.body as {
      name?: string;
      roleTitle?: string;
      phone?: string;
      active?: number;
      hiredDate?: string;
    };

    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    const nextRole = typeof roleTitle === 'string' && roleTitle.trim() ? roleTitle.trim() : existing.role_title;
    const nextPhone = typeof phone === 'string' ? phone.trim() : existing.phone;
    const nextActive = active === 0 || active === 1 ? active : existing.active;
    const nextHired = isValidISODate(hiredDate) ? hiredDate : existing.hired_date;

    db.prepare('UPDATE employees SET name = ?, role_title = ?, phone = ?, active = ?, hired_date = ? WHERE id = ?').run(
      nextName,
      nextRole,
      nextPhone,
      nextActive,
      nextHired,
      id
    );

    const updated = db
      .prepare(
        `SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt
         FROM employees WHERE id = ?`
      )
      .get(id);

    recordAudit({
      actor: req.adminRole!,
      action: 'EDITAR_FUNCIONARIO',
      entityType: 'funcionario',
      entityId: id,
      summary: `Funcionário atualizado: ${nextName}`,
      before: existing,
      after: updated,
    });

    res.json(updated);
  });

  app.patch('/api/employees/:id/toggle', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as
      | { id: number; name: string; active: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Funcionário não encontrado.' });
      return;
    }
    const nextActive = existing.active === 1 ? 0 : 1;
    db.prepare('UPDATE employees SET active = ? WHERE id = ?').run(nextActive, id);

    recordAudit({
      actor: req.adminRole!,
      action: nextActive === 1 ? 'ATIVAR_FUNCIONARIO' : 'DESATIVAR_FUNCIONARIO',
      entityType: 'funcionario',
      entityId: id,
      summary: `Funcionário ${existing.name} ${nextActive === 1 ? 'ativado' : 'desativado'}.`,
    });

    res.json({ ok: true, active: nextActive });
  });

  app.get('/api/commissions/overview', (req, res) => {
    const today = getTodayISOServer();
    const commissionRate = Number(getSetting('commission_rate', '10')) || 10;

    const lastCycle = db
      .prepare(`SELECT end_date AS endDate FROM commission_cycles ORDER BY end_date DESC LIMIT 1`)
      .get() as { endDate: string } | undefined;

    const defaultStart = lastCycle ? addDaysISOServer(lastCycle.endDate, 1) : addDaysISOServer(today, -27);
    const defaultEnd = lastCycle ? addDaysISOServer(defaultStart, 27) : today;

    const startDate = isValidISODate(req.query.startDate) ? req.query.startDate : defaultStart;
    const endDate = isValidISODate(req.query.endDate) ? req.query.endDate : defaultEnd;

    const confirmedDepositsRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM deposits
         WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`
      )
      .get(startDate, endDate) as { total: number };

    const employees = db
      .prepare(
        `SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt
         FROM employees
         ORDER BY active DESC, name ASC`
      )
      .all() as {
      id: number;
      name: string;
      roleTitle: string;
      phone: string;
      active: number;
      hiredDate: string;
      createdAt: string;
    }[];

    const activeEmployees = employees.filter((e) => e.active === 1);
    const confirmedDepositsTotal = confirmedDepositsRow.total;
    const perEmployeeAmount = confirmedDepositsTotal * (commissionRate / 100);
    const totalCommissionsAmount = perEmployeeAmount * activeEmployees.length;
    const companyRemainingAmount = confirmedDepositsTotal - totalCommissionsAmount;

    const cycles = db
      .prepare(
        `SELECT
          id, start_date AS startDate, end_date AS endDate,
          confirmed_deposits_total AS confirmedDepositsTotal,
          commission_rate AS commissionRate,
          eligible_employees_count AS eligibleEmployeesCount,
          per_employee_amount AS perEmployeeAmount,
          total_commissions_amount AS totalCommissionsAmount,
          company_remaining_amount AS companyRemainingAmount,
          closed_by AS closedBy, closed_at AS closedAt, notes
         FROM commission_cycles
         ORDER BY end_date DESC, id DESC`
      )
      .all();

    const payments = db
      .prepare(
        `SELECT
          cp.id, cp.employee_id AS employeeId, e.name AS employeeName,
          cp.cycle_id AS cycleId, cp.payment_date AS paymentDate,
          cp.amount, cp.source, cp.notes, cp.status, cp.void_reason AS voidReason,
          cp.created_by AS createdBy, cp.created_at AS createdAt
         FROM commission_payments cp
         JOIN employees e ON e.id = cp.employee_id
         ORDER BY cp.payment_date DESC, cp.id DESC`
      )
      .all();

    // Calculate per-employee cumulative paid & global balances
    const paidByEmployeeRows = db
      .prepare(
        `SELECT employee_id AS employeeId, COALESCE(SUM(amount), 0) AS totalPaid
         FROM commission_payments
         WHERE status = 'ativo'
         GROUP BY employee_id`
      )
      .all() as { employeeId: number; totalPaid: number }[];
    const paidMap = new Map(paidByEmployeeRows.map((r) => [r.employeeId, r.totalPaid]));

    const globalState = computeGlobalFinancialState();

    // Also compute each active employee's cumulative accrued across closed cycles + open unclosed deposits
    const closedPerEmpSum = (
      db
        .prepare(`SELECT COALESCE(SUM(per_employee_amount), 0) AS total FROM commission_cycles`)
        .get() as { total: number }
    ).total;
    const openPerEmp = globalState.unclosedConfirmedDeposits * (commissionRate / 100);

    const employeeBalances = employees.map((emp) => {
      const paid = paidMap.get(emp.id) || 0;
      const estimatedEarned = emp.active === 1 ? closedPerEmpSum + openPerEmp : closedPerEmpSum;
      return {
        ...emp,
        periodCommission: emp.active === 1 ? perEmployeeAmount : 0,
        totalEarnedEstimate: estimatedEarned,
        totalPaid: paid,
        pendingEstimate: Math.max(0, estimatedEarned - paid),
      };
    });

    res.json({
      commissionRate,
      currentPeriod: {
        startDate,
        endDate,
        confirmedDepositsTotal,
        eligibleEmployeesCount: activeEmployees.length,
        perEmployeeAmount,
        totalCommissionsAmount,
        companyRemainingAmount,
      },
      globalState,
      employeeBalances,
      cycles,
      payments,
    });
  });

  app.post('/api/commissions/close-cycle', (req: AuthenticatedRequest, res) => {
    const { startDate, endDate, notes } = req.body as {
      startDate?: string;
      endDate?: string;
      notes?: string;
    };
    if (!isValidISODate(startDate) || !isValidISODate(endDate) || startDate > endDate) {
      res.status(400).json({ error: 'Período inválido para encerramento de ciclo.' });
      return;
    }

    const overlap = db
      .prepare(`SELECT id FROM commission_cycles WHERE NOT (end_date < ? OR start_date > ?)`)
      .get(startDate, endDate);
    if (overlap) {
      res.status(409).json({ error: 'Já existe um ciclo de comissões encerrado que abrange estas datas.' });
      return;
    }

    const commissionRate = Number(getSetting('commission_rate', '10')) || 10;
    const confirmedDepositsTotal = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`
        )
        .get(startDate, endDate) as { total: number }
    ).total;

    const eligibleEmployeesCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM employees WHERE active = 1`).get() as { cnt: number }
    ).cnt;

    const perEmployeeAmount = confirmedDepositsTotal * (commissionRate / 100);
    const totalCommissionsAmount = perEmployeeAmount * eligibleEmployeesCount;
    const companyRemainingAmount = confirmedDepositsTotal - totalCommissionsAmount;

    const info = db
      .prepare(
        `INSERT INTO commission_cycles (
          start_date, end_date, confirmed_deposits_total, commission_rate,
          eligible_employees_count, per_employee_amount, total_commissions_amount,
          company_remaining_amount, closed_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        startDate,
        endDate,
        confirmedDepositsTotal,
        commissionRate,
        eligibleEmployeesCount,
        perEmployeeAmount,
        totalCommissionsAmount,
        companyRemainingAmount,
        req.adminRole!,
        typeof notes === 'string' ? notes.trim() : ''
      );

    const created = db
      .prepare(
        `SELECT id, start_date AS startDate, end_date AS endDate,
          confirmed_deposits_total AS confirmedDepositsTotal,
          commission_rate AS commissionRate,
          eligible_employees_count AS eligibleEmployeesCount,
          per_employee_amount AS perEmployeeAmount,
          total_commissions_amount AS totalCommissionsAmount,
          company_remaining_amount AS companyRemainingAmount,
          closed_by AS closedBy, closed_at AS closedAt, notes
         FROM commission_cycles WHERE id = ?`
      )
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'ENCERRAR_CICLO_COMISSOES',
      entityType: 'ciclo_comissoes',
      entityId: Number(info.lastInsertRowid),
      summary: `Ciclo de comissões encerrado (${startDate} a ${endDate}): ${totalCommissionsAmount} Kz para ${eligibleEmployeesCount} funcionários.`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.post('/api/commissions/payments', (req: AuthenticatedRequest, res) => {
    const { employeeId, cycleId, paymentDate, amount, source, notes } = req.body as {
      employeeId?: number;
      cycleId?: number | null;
      paymentDate?: string;
      amount?: number;
      source?: 'banco' | 'caixa';
      notes?: string;
    };

    const emp = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(Number(employeeId)) as
      | { id: number; name: string }
      | undefined;
    if (!emp) {
      res.status(400).json({ error: 'Selecione um funcionário válido.' });
      return;
    }
    if (!isValidISODate(paymentDate)) {
      res.status(400).json({ error: 'Data de pagamento inválida.' });
      return;
    }
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      res.status(400).json({ error: 'O valor do pagamento deve ser superior a 0 Kz.' });
      return;
    }
    const src = source === 'caixa' ? 'caixa' : 'banco';

    const info = db
      .prepare(
        `INSERT INTO commission_payments (employee_id, cycle_id, payment_date, amount, source, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?)`
      )
      .run(
        emp.id,
        cycleId ? Number(cycleId) : null,
        paymentDate,
        val,
        src,
        typeof notes === 'string' ? notes.trim() : '',
        req.adminRole!
      );

    const created = db
      .prepare(
        `SELECT cp.id, cp.employee_id AS employeeId, e.name AS employeeName,
          cp.cycle_id AS cycleId, cp.payment_date AS paymentDate,
          cp.amount, cp.source, cp.notes, cp.status, cp.void_reason AS voidReason,
          cp.created_by AS createdBy, cp.created_at AS createdAt
         FROM commission_payments cp
         JOIN employees e ON e.id = cp.employee_id
         WHERE cp.id = ?`
      )
      .get(info.lastInsertRowid);

    recordAudit({
      actor: req.adminRole!,
      action: 'PAGAR_COMISSAO',
      entityType: 'pagamento_comissao',
      entityId: Number(info.lastInsertRowid),
      summary: `Comissão paga a ${emp.name}: ${val} Kz via ${src} em ${paymentDate}`,
      after: created,
    });

    res.status(201).json(created);
  });

  app.post('/api/commissions/payments/:id/void', (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body as { reason?: string };
    const existing = db.prepare('SELECT * FROM commission_payments WHERE id = ?').get(id) as
      | { id: number; amount: number; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Pagamento não encontrado.' });
      return;
    }
    if (existing.status === 'anulado') {
      res.status(400).json({ error: 'Este pagamento já se encontra anulado.' });
      return;
    }
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    db.prepare(`UPDATE commission_payments SET status = 'anulado', void_reason = ? WHERE id = ?`).run(cleanReason, id);

    recordAudit({
      actor: req.adminRole!,
      action: 'ANULAR_PAGAMENTO_COMISSAO',
      entityType: 'pagamento_comissao',
      entityId: id,
      summary: `Pagamento de comissão #${id} (${existing.amount} Kz) anulado. Motivo: ${cleanReason}`,
      before: existing,
    });

    res.json({ ok: true });
  });

  // Daily Closing
  app.get('/api/daily-closings/preview', (req, res) => {
    const date = isValidISODate(req.query.date) ? req.query.date : getTodayISOServer();
    res.json(buildDailyClosingPreview(date));
  });

  app.get('/api/daily-closings', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT
          id, closing_date AS closingDate, area_breakdown_json AS areaBreakdownJson,
          total_sales AS totalSales, total_expenses AS totalExpenses,
          net_after_expenses AS netAfterExpenses, total_deposited AS totalDeposited,
          expected_cash AS expectedCash, counted_cash AS countedCash,
          difference_amount AS differenceAmount, notes, closed_by AS closedBy,
          closed_at AS closedAt, updated_at AS updatedAt
         FROM daily_closings
         ORDER BY closing_date DESC`
      )
      .all();
    res.json(rows);
  });

  app.post('/api/daily-closings', (req: AuthenticatedRequest, res) => {
    const { closingDate, countedCash, notes, correctionReason } = req.body as {
      closingDate?: string;
      countedCash?: number;
      notes?: string;
      correctionReason?: string;
    };

    if (!isValidISODate(closingDate)) {
      res.status(400).json({ error: 'Data de fecho inválida.' });
      return;
    }
    const counted = Number(countedCash);
    if (!Number.isFinite(counted) || counted < 0) {
      res.status(400).json({ error: 'Indique o valor apurado em caixa (0 Kz ou superior).' });
      return;
    }

    const preview = buildDailyClosingPreview(closingDate);
    const differenceAmount = counted - preview.expectedCash;
    const areaBreakdownJson = JSON.stringify(preview.areaBreakdown);
    const existing = db.prepare('SELECT * FROM daily_closings WHERE closing_date = ?').get(closingDate) as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      const reason = typeof correctionReason === 'string' ? correctionReason.trim() : '';
      if (!reason) {
        res.status(400).json({
          error: 'Este dia já está fechado. Indique o motivo da correção para registar na auditoria.',
        });
        return;
      }
      db.prepare(
        `UPDATE daily_closings
         SET area_breakdown_json = ?, total_sales = ?, total_expenses = ?, net_after_expenses = ?,
             total_deposited = ?, expected_cash = ?, counted_cash = ?, difference_amount = ?,
             notes = ?, closed_by = ?, updated_at = datetime('now')
         WHERE closing_date = ?`
      ).run(
        areaBreakdownJson,
        preview.totalSales,
        preview.totalExpenses,
        preview.netAfterExpenses,
        preview.totalDeposited,
        preview.expectedCash,
        counted,
        differenceAmount,
        typeof notes === 'string' ? notes.trim() : '',
        req.adminRole!,
        closingDate
      );

      const updated = buildDailyClosingPreview(closingDate).existingClosing;
      recordAudit({
        actor: req.adminRole!,
        action: 'CORRIGIR_FECHO_DIARIO',
        entityType: 'fecho_diario',
        entityId: closingDate,
        summary: `Fecho diário de ${closingDate} corrigido. Motivo: ${reason}. Diferença: ${differenceAmount} Kz.`,
        before: existing,
        after: updated,
      });
      res.json(updated);
      return;
    }

    const info = db
      .prepare(
        `INSERT INTO daily_closings (
          closing_date, area_breakdown_json, total_sales, total_expenses,
          net_after_expenses, total_deposited, expected_cash, counted_cash,
          difference_amount, notes, closed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        closingDate,
        areaBreakdownJson,
        preview.totalSales,
        preview.totalExpenses,
        preview.netAfterExpenses,
        preview.totalDeposited,
        preview.expectedCash,
        counted,
        differenceAmount,
        typeof notes === 'string' ? notes.trim() : '',
        req.adminRole!
      );

    const created = buildDailyClosingPreview(closingDate).existingClosing;
    recordAudit({
      actor: req.adminRole!,
      action: 'FECHAR_DIA',
      entityType: 'fecho_diario',
      entityId: Number(info.lastInsertRowid),
      summary: `Fecho diário de ${closingDate} confirmado. Vendas: ${preview.totalSales} Kz | Diferença: ${differenceAmount} Kz.`,
      after: created,
    });

    res.status(201).json(created);
  });

  // Financial Calendar
  app.get('/api/calendar', (req, res) => {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1; // 1-12
    const mm = String(month).padStart(2, '0');
    const startDate = `${year}-${mm}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

    const salesRows = db
      .prepare(
        `SELECT sale_date AS date, COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
         FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?
         GROUP BY sale_date`
      )
      .all(startDate, endDate) as { date: string; total: number; count: number }[];

    const expensesRows = db
      .prepare(
        `SELECT expense_date AS date, COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ?
         GROUP BY expense_date`
      )
      .all(startDate, endDate) as { date: string; total: number }[];

    const depositsRows = db
      .prepare(
        `SELECT deposit_date AS date, COALESCE(SUM(amount), 0) AS total
         FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?
         GROUP BY deposit_date`
      )
      .all(startDate, endDate) as { date: string; total: number }[];

    const closingsRows = db
      .prepare(
        `SELECT closing_date AS date, difference_amount AS difference
         FROM daily_closings WHERE closing_date >= ? AND closing_date <= ?`
      )
      .all(startDate, endDate) as { date: string; difference: number }[];

    res.json({
      year,
      month,
      salesByDay: Object.fromEntries(salesRows.map((r) => [r.date, r])),
      expensesByDay: Object.fromEntries(expensesRows.map((r) => [r.date, r.total])),
      depositsByDay: Object.fromEntries(depositsRows.map((r) => [r.date, r.total])),
      closingsByDay: Object.fromEntries(closingsRows.map((r) => [r.date, r.difference])),
    });
  });

  // Audit Logs
  app.get('/api/audit-logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 150, 500);
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : '';
    const rows = entityType
      ? db
          .prepare(
            `SELECT id, actor, action, entity_type AS entityType, entity_id AS entityId,
              summary, before_json AS beforeJson, after_json AS afterJson, created_at AS createdAt
             FROM audit_logs WHERE entity_type = ? ORDER BY id DESC LIMIT ?`
          )
          .all(entityType, limit)
      : db
          .prepare(
            `SELECT id, actor, action, entity_type AS entityType, entity_id AS entityId,
              summary, before_json AS beforeJson, after_json AS afterJson, created_at AS createdAt
             FROM audit_logs ORDER BY id DESC LIMIT ?`
          )
          .all(limit);
    res.json(rows);
  });

  // Backup Export & Restore
  app.get('/api/backup/export', (req: AuthenticatedRequest, res) => {
    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.adminRole,
      version: 1,
      data: {
        settings: db
          .prepare(`SELECT key, value FROM app_settings WHERE key NOT IN ('admin_password_hash', 'session_secret')`)
          .all(),
        service_areas: db.prepare('SELECT * FROM service_areas').all(),
        services: db.prepare('SELECT * FROM services').all(),
        sales: db.prepare('SELECT * FROM sales').all(),
        expense_categories: db.prepare('SELECT * FROM expense_categories').all(),
        expenses: db.prepare('SELECT * FROM expenses').all(),
        deposits: db.prepare('SELECT * FROM deposits').all(),
        employees: db.prepare('SELECT * FROM employees').all(),
        commission_cycles: db.prepare('SELECT * FROM commission_cycles').all(),
        commission_payments: db.prepare('SELECT * FROM commission_payments').all(),
        daily_closings: db.prepare('SELECT * FROM daily_closings').all(),
        audit_logs: db.prepare('SELECT * FROM audit_logs').all(),
      },
    };

    recordAudit({
      actor: req.adminRole!,
      action: 'EXPORTAR_BACKUP',
      entityType: 'backup',
      summary: 'Cópia de segurança completa exportada em JSON.',
    });

    res.setHeader('Content-Disposition', `attachment; filename="novo-planeta-backup-${getTodayISOServer()}.json"`);
    res.json(backup);
  });

  app.post('/api/backup/restore', (req: AuthenticatedRequest, res) => {
    const payload = req.body as { version?: number; data?: Record<string, unknown[]> };
    if (!payload || !payload.data || typeof payload.data !== 'object') {
      res.status(400).json({ error: 'Ficheiro de backup inválido.' });
      return;
    }

    const d = payload.data as Record<string, Record<string, unknown>[]>;
    const requiredKeys = [
      'service_areas',
      'services',
      'sales',
      'expense_categories',
      'expenses',
      'deposits',
      'employees',
      'commission_cycles',
      'commission_payments',
      'daily_closings',
    ];
    for (const k of requiredKeys) {
      if (!Array.isArray(d[k])) {
        res.status(400).json({ error: `Backup incompleto: falta a tabela "${k}".` });
        return;
      }
    }

    try {
      const restoreTx = db.transaction(() => {
        db.pragma('foreign_keys = OFF');
        db.exec(`
          DELETE FROM commission_payments;
          DELETE FROM commission_cycles;
          DELETE FROM daily_closings;
          DELETE FROM deposits;
          DELETE FROM expenses;
          DELETE FROM expense_categories;
          DELETE FROM sales;
          DELETE FROM services;
          DELETE FROM service_areas;
          DELETE FROM employees;
        `);

        if (Array.isArray(d.settings)) {
          const upsertSetting = db.prepare(
            'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
          );
          for (const row of d.settings) {
            if (
              row.key &&
              row.key !== 'admin_password_hash' &&
              row.key !== 'session_secret' &&
              row.key !== 'is_default_password'
            ) {
              upsertSetting.run(String(row.key), String(row.value ?? ''));
            }
          }
        }

        const insertArea = db.prepare(
          'INSERT INTO service_areas (id, name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const r of d.service_areas) {
          insertArea.run(r.id, r.name, r.slug, r.description ?? '', r.sort_order ?? 0, r.active ?? 1);
        }

        const insertService = db.prepare(
          'INSERT INTO services (id, area_id, name, default_price, active) VALUES (?, ?, ?, ?, ?)'
        );
        for (const r of d.services) {
          insertService.run(r.id, r.area_id, r.name, r.default_price ?? null, r.active ?? 1);
        }

        const insertSale = db.prepare(
          `INSERT INTO sales (id, sale_date, area_id, service_id, quantity, unit_price, total_amount, notes, status, void_reason, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of d.sales) {
          insertSale.run(
            r.id,
            r.sale_date,
            r.area_id,
            r.service_id,
            r.quantity ?? null,
            r.unit_price ?? null,
            r.total_amount,
            r.notes ?? '',
            r.status ?? 'ativo',
            r.void_reason ?? null,
            r.created_by ?? 'CEO',
            r.created_at ?? new Date().toISOString(),
            r.updated_at ?? new Date().toISOString()
          );
        }

        const insertCat = db.prepare('INSERT INTO expense_categories (id, name, active) VALUES (?, ?, ?)');
        for (const r of d.expense_categories) {
          insertCat.run(r.id, r.name, r.active ?? 1);
        }

        const insertExp = db.prepare(
          `INSERT INTO expenses (id, expense_date, category_id, description, amount, area_id, notes, status, void_reason, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of d.expenses) {
          insertExp.run(
            r.id,
            r.expense_date,
            r.category_id,
            r.description,
            r.amount,
            r.area_id ?? null,
            r.notes ?? '',
            r.status ?? 'ativo',
            r.void_reason ?? null,
            r.created_by ?? 'CEO',
            r.created_at ?? new Date().toISOString(),
            r.updated_at ?? new Date().toISOString()
          );
        }

        const insertDep = db.prepare(
          `INSERT INTO deposits (id, deposit_date, amount, bank_name, reference_code, related_period, notes, status, void_reason, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of d.deposits) {
          insertDep.run(
            r.id,
            r.deposit_date,
            r.amount,
            r.bank_name,
            r.reference_code ?? '',
            r.related_period ?? '',
            r.notes ?? '',
            r.status ?? 'realizado',
            r.void_reason ?? null,
            r.created_by ?? 'CEO',
            r.created_at ?? new Date().toISOString(),
            r.updated_at ?? new Date().toISOString()
          );
        }

        const insertEmp = db.prepare(
          'INSERT INTO employees (id, name, role_title, phone, active, hired_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (const r of d.employees) {
          insertEmp.run(
            r.id,
            r.name,
            r.role_title ?? 'Funcionário',
            r.phone ?? '',
            r.active ?? 1,
            r.hired_date,
            r.created_at ?? new Date().toISOString()
          );
        }

        const insertCycle = db.prepare(
          `INSERT INTO commission_cycles (id, start_date, end_date, confirmed_deposits_total, commission_rate, eligible_employees_count, per_employee_amount, total_commissions_amount, company_remaining_amount, closed_by, closed_at, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of d.commission_cycles) {
          insertCycle.run(
            r.id,
            r.start_date,
            r.end_date,
            r.confirmed_deposits_total,
            r.commission_rate,
            r.eligible_employees_count,
            r.per_employee_amount,
            r.total_commissions_amount,
            r.company_remaining_amount,
            r.closed_by ?? 'CEO',
            r.closed_at ?? new Date().toISOString(),
            r.notes ?? ''
          );
        }

        const insertPay = db.prepare(
          `INSERT INTO commission_payments (id, employee_id, cycle_id, payment_date, amount, source, notes, status, void_reason, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of d.commission_payments) {
          insertPay.run(
            r.id,
            r.employee_id,
            r.cycle_id ?? null,
            r.payment_date,
            r.amount,
            r.source ?? 'banco',
            r.notes ?? '',
            r.status ?? 'ativo',
            r.void_reason ?? null,
            r.created_by ?? 'CEO',
            r.created_at ?? new Date().toISOString()
          );
        }

        const insertClosing = db.prepare(
          `INSERT INTO daily_closings (id, closing_date, area_breakdown_json, total_sales, total_expenses, net_after_expenses, total_deposited, expected_cash, counted_cash, difference_amount, notes, closed_by, closed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of d.daily_closings) {
          insertClosing.run(
            r.id,
            r.closing_date,
            r.area_breakdown_json ?? '[]',
            r.total_sales,
            r.total_expenses,
            r.net_after_expenses,
            r.total_deposited,
            r.expected_cash,
            r.counted_cash,
            r.difference_amount,
            r.notes ?? '',
            r.closed_by ?? 'CEO',
            r.closed_at ?? new Date().toISOString(),
            r.updated_at ?? new Date().toISOString()
          );
        }

        db.pragma('foreign_keys = ON');
      });

      restoreTx();

      recordAudit({
        actor: req.adminRole!,
        action: 'RESTAURAR_BACKUP',
        entityType: 'backup',
        summary: 'Base de dados restaurada a partir de ficheiro de cópia de segurança JSON.',
      });

      res.json({ ok: true });
    } catch (err) {
      db.pragma('foreign_keys = ON');
      res.status(500).json({
        error: `Erro ao restaurar backup: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NOVO PLANETA servidor ativo na porta ${PORT}`);
  });
}

startServer();
