import {
  ensureD1Initialized,
  getSettingD1,
  hashPasswordWorker,
  randomHex,
  recordAuditD1,
  setSettingD1,
  verifyPasswordWorker,
} from './db';
import {
  addDaysISOWorker,
  buildDailyClosingPreviewD1,
  buildDashboardDataD1,
  computeGlobalFinancialStateD1,
  getTodayISOWorker,
} from './financeLogic';
import { WorkerEnv } from './types';

const SESSION_COOKIE = 'np_session';

interface SessionPayload {
  role: 'CEO' | 'PCA';
  exp: number;
  nonce: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function signTokenWorker(payload: SessionPayload, secret: string): Promise<string> {
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(sig))}`;
}

async function verifyTokenWorker(
  token: string | undefined,
  secret: string
): Promise<SessionPayload | null> {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sig).buffer as ArrayBuffer,
      new TextEncoder().encode(encoded)
    );
    if (!valid) return null;
    const decoded = new TextDecoder().decode(fromBase64Url(encoded));
    const parsed = JSON.parse(decoded) as SessionPayload;
    if (!parsed || (parsed.role !== 'CEO' && parsed.role !== 'PCA')) return null;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const map: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) map[k] = decodeURIComponent(v);
  }
  return map;
}

function extractToken(request: Request): string | undefined {
  const cookies = parseCookies(request.headers.get('Cookie'));
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return undefined;
}

function buildCorsHeaders(request: Request, env: WorkerEnv): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin');
  if (origin) {
    const allowed = env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    if (allowed.length === 0 || allowed.includes('*') || allowed.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
    }
  }
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function json(
  request: Request,
  env: WorkerEnv,
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = buildCorsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function isValidISODate(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function toSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `area-${Date.now()}`
  );
}

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export async function handleApiRequest(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return json(
      request,
      env,
      {
        error:
          'Base de dados D1 (binding "DB") não configurada neste Cloudflare Worker. Associe o binding DB nas definições do Worker.',
      },
      500
    );
  }

  await ensureD1Initialized(env);
  const db = env.DB;
  const secret = env.SESSION_SECRET || (await getSettingD1(db, 'session_secret'));
  const isHttps = url.protocol === 'https:';
  const requestOrigin = request.headers.get('Origin');
  const isCrossOrigin = Boolean(requestOrigin && requestOrigin !== url.origin);
  const sameSiteCookie = isHttps
    ? `${isCrossOrigin ? 'SameSite=None' : 'SameSite=Lax'}; Secure`
    : 'SameSite=Lax';

  if (path === '/api/health') {
    if (method !== 'GET') return json(request, env, { error: 'Método não permitido.' }, 405, { Allow: 'GET, OPTIONS' });
    return json(request, env, { ok: true, service: 'novo-planeta-financas', runtime: 'cloudflare-worker' });
  }

  if (path === '/api/auth/status') {
    if (method !== 'GET') return json(request, env, { error: 'Método não permitido.' }, 405, { Allow: 'GET, OPTIONS' });
    const payload = await verifyTokenWorker(extractToken(request), secret);
    const [companyName, logoUrl, isDef] = await Promise.all([
      getSettingD1(db, 'company_name', 'NOVO PLANETA'),
      getSettingD1(db, 'logo_url', ''),
      getSettingD1(db, 'is_default_password', '0'),
    ]);
    return json(request, env, {
      authenticated: Boolean(payload),
      role: payload ? payload.role : null,
      companyName,
      logoUrl,
      isDefaultPassword: isDef === '1',
    });
  }

  if (path === '/api/auth/login') {
    if (method !== 'POST') {
      return json(request, env, { error: 'Use o método POST para iniciar sessão.' }, 405, {
        Allow: 'POST, OPTIONS',
      });
    }
    const { role, password } = await readJsonBody<{ role?: string; password?: string }>(request);
    if (role !== 'CEO' && role !== 'PCA') {
      return json(request, env, { error: 'Selecione um perfil autorizado (CEO ou PCA).' }, 400);
    }
    if (typeof password !== 'string' || password.length === 0) {
      return json(request, env, { error: 'Introduza a palavra-passe administrativa.' }, 400);
    }

    const storedHash = await getSettingD1(db, 'admin_password_hash');
    const valid = await verifyPasswordWorker(password, storedHash);
    if (!valid) {
      return json(request, env, { error: 'Palavra-passe incorreta.' }, 401);
    }

    const token = await signTokenWorker(
      {
        role,
        exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
        nonce: randomHex(8),
      },
      secret
    );

    await recordAuditD1(db, {
      actor: role,
      action: 'LOGIN',
      entityType: 'sessao',
      summary: `Início de sessão autorizado (${role}).`,
    });

    const isDefaultPassword = (await getSettingD1(db, 'is_default_password', '0')) === '1';
    return json(
      request,
      env,
      { ok: true, role, token, isDefaultPassword },
      200,
      {
        'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=604800; ${sameSiteCookie}`,
      }
    );
  }

  if (path === '/api/auth/logout') {
    if (method !== 'POST') {
      return json(request, env, { error: 'Use o método POST para encerrar sessão.' }, 405, {
        Allow: 'POST, OPTIONS',
      });
    }
    const payload = await verifyTokenWorker(extractToken(request), secret);
    if (payload) {
      await recordAuditD1(db, {
        actor: payload.role,
        action: 'LOGOUT',
        entityType: 'sessao',
        summary: `Sessão encerrada (${payload.role}).`,
      });
    }
    return json(
      request,
      env,
      { ok: true },
      200,
      {
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; ${sameSiteCookie}`,
      }
    );
  }

  // Protected API routes below
  const session = await verifyTokenWorker(extractToken(request), secret);
  if (!session) {
    return json(
      request,
      env,
      { error: 'Sessão não autenticada ou expirada. Inicie sessão novamente.' },
      401
    );
  }
  const actor = session.role;

  // Change password
  if (path === '/api/auth/change-password' && method === 'POST') {
    const { currentPassword, newPassword } = await readJsonBody<{
      currentPassword?: string;
      newPassword?: string;
    }>(request);
    if (!currentPassword || !newPassword) {
      return json(request, env, { error: 'Preencha a palavra-passe atual e a nova palavra-passe.' }, 400);
    }
    if (newPassword.length < 6) {
      return json(request, env, { error: 'A nova palavra-passe deve ter pelo menos 6 caracteres.' }, 400);
    }
    const storedHash = await getSettingD1(db, 'admin_password_hash');
    if (!(await verifyPasswordWorker(currentPassword, storedHash))) {
      return json(request, env, { error: 'A palavra-passe atual está incorreta.' }, 401);
    }
    await setSettingD1(db, 'admin_password_hash', await hashPasswordWorker(newPassword));
    await setSettingD1(db, 'is_default_password', '0');
    await recordAuditD1(db, {
      actor,
      action: 'ALTERAR_SENHA',
      entityType: 'seguranca',
      summary: 'Palavra-passe administrativa partilhada (CEO/PCA) alterada.',
    });
    return json(request, env, { ok: true });
  }

  // Settings
  if (path === '/api/settings') {
    if (method === 'GET') {
      const [companyName, logoUrl, rateStr, isDef] = await Promise.all([
        getSettingD1(db, 'company_name', 'NOVO PLANETA'),
        getSettingD1(db, 'logo_url', ''),
        getSettingD1(db, 'commission_rate', '10'),
        getSettingD1(db, 'is_default_password', '0'),
      ]);
      return json(request, env, {
        companyName,
        logoUrl,
        commissionRate: Number(rateStr) || 10,
        isDefaultPassword: isDef === '1',
      });
    }
    if (method === 'PUT') {
      const { logoUrl, commissionRate, companyName } = await readJsonBody<{
        logoUrl?: string;
        commissionRate?: number;
        companyName?: string;
      }>(request);
      const before = {
        companyName: await getSettingD1(db, 'company_name', 'NOVO PLANETA'),
        logoUrl: await getSettingD1(db, 'logo_url', ''),
        commissionRate: Number(await getSettingD1(db, 'commission_rate', '10')) || 10,
      };
      if (typeof logoUrl === 'string') {
        const trimmed = logoUrl.trim();
        if (trimmed && !/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('data:image/')) {
          return json(request, env, { error: 'O link do logótipo deve começar por http:// ou https://.' }, 400);
        }
        await setSettingD1(db, 'logo_url', trimmed);
      }
      if (typeof companyName === 'string' && companyName.trim().length > 0) {
        await setSettingD1(db, 'company_name', companyName.trim().slice(0, 80));
      }
      if (commissionRate !== undefined) {
        const rate = Number(commissionRate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
          return json(request, env, { error: 'A percentagem de comissão deve estar entre 0% e 100%.' }, 400);
        }
        await setSettingD1(db, 'commission_rate', String(rate));
      }
      const after = {
        companyName: await getSettingD1(db, 'company_name', 'NOVO PLANETA'),
        logoUrl: await getSettingD1(db, 'logo_url', ''),
        commissionRate: Number(await getSettingD1(db, 'commission_rate', '10')) || 10,
      };
      await recordAuditD1(db, {
        actor,
        action: 'ATUALIZAR_DEFINICOES',
        entityType: 'definicoes',
        summary: 'Configurações do sistema atualizadas.',
        before,
        after,
      });
      return json(request, env, after);
    }
  }

  // Dashboard
  if (path === '/api/dashboard' && method === 'GET') {
    const today = getTodayISOWorker();
    const sParam = url.searchParams.get('startDate');
    const eParam = url.searchParams.get('endDate');
    const startDate = isValidISODate(sParam) ? sParam : today;
    const endDate = isValidISODate(eParam) ? eParam : today;
    if (startDate > endDate) {
      return json(request, env, { error: 'A data inicial não pode ser superior à data final.' }, 400);
    }
    const dash = await buildDashboardDataD1(db, startDate, endDate);
    return json(request, env, dash);
  }

  // Catalog
  if (path === '/api/catalog' && method === 'GET') {
    const [areas, services] = await Promise.all([
      db
        .prepare(
          `SELECT id, name, slug, description, sort_order AS sortOrder, active
           FROM service_areas ORDER BY sort_order ASC, id ASC`
        )
        .all(),
      db
        .prepare(
          `SELECT s.id, s.area_id AS areaId, sa.name AS areaName, s.name, s.default_price AS defaultPrice, s.active
           FROM services s JOIN service_areas sa ON sa.id = s.area_id
           ORDER BY sa.sort_order ASC, s.id ASC`
        )
        .all(),
    ]);
    return json(request, env, { areas: areas.results, services: services.results });
  }

  // Areas
  if (path === '/api/areas' && method === 'POST') {
    const { name, description } = await readJsonBody<{ name?: string; description?: string }>(request);
    const cleanName = typeof name === 'string' ? name.trim().toUpperCase() : '';
    if (!cleanName) return json(request, env, { error: 'Indique o nome da nova área de serviços.' }, 400);
    const dup = await db.prepare('SELECT id FROM service_areas WHERE LOWER(name) = LOWER(?)').bind(cleanName).first();
    if (dup) return json(request, env, { error: 'Já existe uma área com esse nome.' }, 409);
    const maxOrder = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM service_areas').first<{ m: number }>())?.m || 0;
    const res = await db
      .prepare('INSERT INTO service_areas (name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, 1)')
      .bind(cleanName, toSlug(cleanName), typeof description === 'string' ? description.trim() : '', maxOrder + 1)
      .run();
    const created = await db
      .prepare('SELECT id, name, slug, description, sort_order AS sortOrder, active FROM service_areas WHERE id = ?')
      .bind(res.meta.last_row_id)
      .first();
    await recordAuditD1(db, {
      actor,
      action: 'CRIAR_AREA',
      entityType: 'area',
      entityId: res.meta.last_row_id,
      summary: `Nova área criada: ${cleanName}`,
      after: created,
    });
    return json(request, env, created, 201);
  }

  const areaMatch = path.match(/^\/api\/areas\/(\d+)$/);
  if (areaMatch) {
    const id = Number(areaMatch[1]);
    const existing = await db.prepare('SELECT * FROM service_areas WHERE id = ?').bind(id).first<{ id: number; name: string; description: string; active: number }>();
    if (!existing) return json(request, env, { error: 'Área não encontrada.' }, 404);

    if (method === 'PUT') {
      const { name, description, active } = await readJsonBody<{ name?: string; description?: string; active?: number }>(request);
      const nextName = typeof name === 'string' && name.trim() ? name.trim().toUpperCase() : existing.name;
      const nextDesc = typeof description === 'string' ? description.trim() : existing.description;
      const nextActive = active === 0 || active === 1 ? active : existing.active;
      await db.prepare('UPDATE service_areas SET name = ?, description = ?, active = ? WHERE id = ?').bind(nextName, nextDesc, nextActive, id).run();
      const updated = await db.prepare('SELECT id, name, slug, description, sort_order AS sortOrder, active FROM service_areas WHERE id = ?').bind(id).first();
      await recordAuditD1(db, { actor, action: 'EDITAR_AREA', entityType: 'area', entityId: id, summary: `Área atualizada: ${nextName}`, before: existing, after: updated });
      return json(request, env, updated);
    }
    if (method === 'DELETE') {
      const usage = await db.prepare('SELECT COUNT(*) AS cnt FROM sales WHERE area_id = ?').bind(id).first<{ cnt: number }>();
      if ((usage?.cnt || 0) > 0) {
        await db.prepare('UPDATE service_areas SET active = 0 WHERE id = ?').bind(id).run();
        await recordAuditD1(db, { actor, action: 'DESATIVAR_AREA', entityType: 'area', entityId: id, summary: `Área desativada (possui histórico de vendas): ${existing.name}` });
        return json(request, env, { ok: true, deactivated: true });
      }
      await db.batch([
        db.prepare('DELETE FROM services WHERE area_id = ?').bind(id),
        db.prepare('DELETE FROM service_areas WHERE id = ?').bind(id),
      ]);
      await recordAuditD1(db, { actor, action: 'ELIMINAR_AREA', entityType: 'area', entityId: id, summary: `Área eliminada: ${existing.name}`, before: existing });
      return json(request, env, { ok: true, deactivated: false });
    }
  }

  // Services
  if (path === '/api/services' && method === 'POST') {
    const { areaId, name, defaultPrice } = await readJsonBody<{ areaId?: number; name?: string; defaultPrice?: number | null }>(request);
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!areaId || !cleanName) return json(request, env, { error: 'Selecione a área e indique o nome do serviço.' }, 400);
    const area = await db.prepare('SELECT id, name FROM service_areas WHERE id = ?').bind(Number(areaId)).first<{ id: number; name: string }>();
    if (!area) return json(request, env, { error: 'Área de serviços inválida.' }, 404);
    const dup = await db.prepare('SELECT id FROM services WHERE area_id = ? AND LOWER(name) = LOWER(?)').bind(area.id, cleanName).first();
    if (dup) return json(request, env, { error: 'Este serviço já existe nesta área.' }, 409);
    const priceVal = defaultPrice !== undefined && defaultPrice !== null && Number(defaultPrice) > 0 ? Number(defaultPrice) : null;
    const res = await db.prepare('INSERT INTO services (area_id, name, default_price, active) VALUES (?, ?, ?, 1)').bind(area.id, cleanName, priceVal).run();
    const created = await db
      .prepare(`SELECT s.id, s.area_id AS areaId, sa.name AS areaName, s.name, s.default_price AS defaultPrice, s.active FROM services s JOIN service_areas sa ON sa.id = s.area_id WHERE s.id = ?`)
      .bind(res.meta.last_row_id)
      .first();
    await recordAuditD1(db, { actor, action: 'CRIAR_SERVICO', entityType: 'servico', entityId: res.meta.last_row_id, summary: `Serviço adicionado em ${area.name}: ${cleanName}`, after: created });
    return json(request, env, created, 201);
  }

  const serviceMatch = path.match(/^\/api\/services\/(\d+)$/);
  if (serviceMatch) {
    const id = Number(serviceMatch[1]);
    const existing = await db.prepare('SELECT * FROM services WHERE id = ?').bind(id).first<{ id: number; area_id: number; name: string; default_price: number | null; active: number }>();
    if (!existing) return json(request, env, { error: 'Serviço não encontrado.' }, 404);

    if (method === 'PUT') {
      const { name, areaId, defaultPrice, active } = await readJsonBody<{ name?: string; areaId?: number; defaultPrice?: number | null; active?: number }>(request);
      const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
      const nextAreaId = areaId ? Number(areaId) : existing.area_id;
      const nextPrice = defaultPrice === null ? null : defaultPrice !== undefined && Number(defaultPrice) > 0 ? Number(defaultPrice) : existing.default_price;
      const nextActive = active === 0 || active === 1 ? active : existing.active;
      await db.prepare('UPDATE services SET name = ?, area_id = ?, default_price = ?, active = ? WHERE id = ?').bind(nextName, nextAreaId, nextPrice, nextActive, id).run();
      const updated = await db
        .prepare(`SELECT s.id, s.area_id AS areaId, sa.name AS areaName, s.name, s.default_price AS defaultPrice, s.active FROM services s JOIN service_areas sa ON sa.id = s.area_id WHERE s.id = ?`)
        .bind(id)
        .first();
      await recordAuditD1(db, { actor, action: 'EDITAR_SERVICO', entityType: 'servico', entityId: id, summary: `Serviço atualizado: ${nextName}`, before: existing, after: updated });
      return json(request, env, updated);
    }
    if (method === 'DELETE') {
      const usage = await db.prepare('SELECT COUNT(*) AS cnt FROM sales WHERE service_id = ?').bind(id).first<{ cnt: number }>();
      if ((usage?.cnt || 0) > 0) {
        await db.prepare('UPDATE services SET active = 0 WHERE id = ?').bind(id).run();
        await recordAuditD1(db, { actor, action: 'DESATIVAR_SERVICO', entityType: 'servico', entityId: id, summary: `Serviço desativado (possui vendas registadas): ${existing.name}` });
        return json(request, env, { ok: true, deactivated: true });
      }
      await db.prepare('DELETE FROM services WHERE id = ?').bind(id).run();
      await recordAuditD1(db, { actor, action: 'ELIMINAR_SERVICO', entityType: 'servico', entityId: id, summary: `Serviço eliminado: ${existing.name}`, before: existing });
      return json(request, env, { ok: true, deactivated: false });
    }
  }

  // Sales
  if (path === '/api/sales') {
    if (method === 'GET') {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (url.searchParams.get('includeVoided') !== 'true') conditions.push(`s.status = 'ativo'`);
      const sDate = url.searchParams.get('startDate');
      const eDate = url.searchParams.get('endDate');
      const aId = url.searchParams.get('areaId');
      const search = url.searchParams.get('search');
      if (isValidISODate(sDate)) { conditions.push(`s.sale_date >= ?`); params.push(sDate); }
      if (isValidISODate(eDate)) { conditions.push(`s.sale_date <= ?`); params.push(eDate); }
      if (aId && Number(aId) > 0) { conditions.push(`s.area_id = ?`); params.push(Number(aId)); }
      if (search && search.trim()) {
        conditions.push(`(LOWER(sv.name) LIKE ? OR LOWER(sa.name) LIKE ? OR LOWER(s.notes) LIKE ? OR s.sale_date LIKE ?)`);
        const q = `%${search.trim().toLowerCase()}%`;
        params.push(q, q, q, q);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await db
        .prepare(
          `SELECT s.id, s.sale_date AS saleDate, s.area_id AS areaId, sa.name AS areaName,
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
        .bind(...params)
        .all();
      return json(request, env, res.results);
    }

    if (method === 'POST') {
      const { saleDate, areaId, serviceId, quantity, unitPrice, totalAmount, notes } = await readJsonBody<{
        saleDate?: string; areaId?: number; serviceId?: number; quantity?: number | null; unitPrice?: number | null; totalAmount?: number; notes?: string;
      }>(request);
      if (!isValidISODate(saleDate)) return json(request, env, { error: 'Data da venda inválida.' }, 400);
      const service = await db.prepare('SELECT id, area_id, name FROM services WHERE id = ?').bind(Number(serviceId)).first<{ id: number; area_id: number; name: string }>();
      if (!service) return json(request, env, { error: 'Selecione um serviço válido.' }, 400);
      const resolvedAreaId = areaId ? Number(areaId) : service.area_id;
      const area = await db.prepare('SELECT id, name FROM service_areas WHERE id = ?').bind(resolvedAreaId).first<{ id: number; name: string }>();
      if (!area) return json(request, env, { error: 'Área de serviços inválida.' }, 400);

      const qty = quantity !== null && quantity !== undefined && Number(quantity) > 0 ? Number(quantity) : null;
      const unit = unitPrice !== null && unitPrice !== undefined && Number(unitPrice) > 0 ? Number(unitPrice) : null;
      const total = totalAmount !== undefined && Number(totalAmount) > 0 ? Number(totalAmount) : qty !== null && unit !== null ? qty * unit : 0;
      if (!Number.isFinite(total) || total <= 0) return json(request, env, { error: 'O valor total da venda deve ser superior a 0 Kz.' }, 400);

      const res = await db
        .prepare(`INSERT INTO sales (sale_date, area_id, service_id, quantity, unit_price, total_amount, notes, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo', ?)`)
        .bind(saleDate, resolvedAreaId, service.id, qty, unit, total, typeof notes === 'string' ? notes.trim() : '', actor)
        .run();

      const created = await db
        .prepare(
          `SELECT s.id, s.sale_date AS saleDate, s.area_id AS areaId, sa.name AS areaName,
            s.service_id AS serviceId, sv.name AS serviceName, s.quantity, s.unit_price AS unitPrice,
            s.total_amount AS totalAmount, s.notes, s.status, s.void_reason AS voidReason,
            s.created_by AS createdBy, s.created_at AS createdAt, s.updated_at AS updatedAt
           FROM sales s JOIN service_areas sa ON sa.id = s.area_id JOIN services sv ON sv.id = s.service_id WHERE s.id = ?`
        )
        .bind(res.meta.last_row_id)
        .first();
      await recordAuditD1(db, {
        actor,
        action: 'CRIAR_VENDA',
        entityType: 'venda',
        entityId: res.meta.last_row_id,
        summary: `Venda registada em ${area.name} (${service.name}): ${total} Kz em ${saleDate}`,
        after: created,
      });
      return json(request, env, created, 201);
    }
  }

  const saleVoidMatch = path.match(/^\/api\/sales\/(\d+)\/void$/);
  if (saleVoidMatch && method === 'POST') {
    const id = Number(saleVoidMatch[1]);
    const { reason } = await readJsonBody<{ reason?: string }>(request);
    const existing = await db.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first<{ id: number; total_amount: number; status: string; sale_date: string }>();
    if (!existing) return json(request, env, { error: 'Venda não encontrada.' }, 404);
    if (existing.status === 'anulado') return json(request, env, { error: 'Esta venda já se encontra anulada.' }, 400);
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    await db.prepare(`UPDATE sales SET status = 'anulado', void_reason = ?, updated_at = datetime('now') WHERE id = ?`).bind(cleanReason, id).run();
    await recordAuditD1(db, { actor, action: 'ANULAR_VENDA', entityType: 'venda', entityId: id, summary: `Venda #${id} (${existing.total_amount} Kz de ${existing.sale_date}) anulada. Motivo: ${cleanReason}`, before: existing });
    return json(request, env, { ok: true });
  }

  const saleMatch = path.match(/^\/api\/sales\/(\d+)$/);
  if (saleMatch && method === 'PUT') {
    const id = Number(saleMatch[1]);
    const existing = await db.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first<{ id: number; sale_date: string; area_id: number; service_id: number; quantity: number | null; unit_price: number | null; total_amount: number; notes: string; status: string }>();
    if (!existing) return json(request, env, { error: 'Registo de venda não encontrado.' }, 404);
    if (existing.status === 'anulado') return json(request, env, { error: 'Não é possível editar uma venda já anulada.' }, 400);

    const { saleDate, areaId, serviceId, quantity, unitPrice, totalAmount, notes } = await readJsonBody<{
      saleDate?: string; areaId?: number; serviceId?: number; quantity?: number | null; unitPrice?: number | null; totalAmount?: number; notes?: string;
    }>(request);
    const nextDate = isValidISODate(saleDate) ? saleDate : existing.sale_date;
    const nextServiceId = serviceId ? Number(serviceId) : existing.service_id;
    const nextAreaId = areaId ? Number(areaId) : existing.area_id;
    const nextQty = quantity === null ? null : quantity !== undefined ? Number(quantity) : existing.quantity;
    const nextUnit = unitPrice === null ? null : unitPrice !== undefined ? Number(unitPrice) : existing.unit_price;
    const nextTotal = totalAmount !== undefined ? Number(totalAmount) : existing.total_amount;
    if (!Number.isFinite(nextTotal) || nextTotal <= 0) return json(request, env, { error: 'O valor total da venda deve ser superior a 0 Kz.' }, 400);

    await db
      .prepare(`UPDATE sales SET sale_date = ?, area_id = ?, service_id = ?, quantity = ?, unit_price = ?, total_amount = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(nextDate, nextAreaId, nextServiceId, nextQty, nextUnit, nextTotal, typeof notes === 'string' ? notes.trim() : existing.notes, id)
      .run();

    const updated = await db
      .prepare(`SELECT s.id, s.sale_date AS saleDate, s.area_id AS areaId, sa.name AS areaName, s.service_id AS serviceId, sv.name AS serviceName, s.quantity, s.unit_price AS unitPrice, s.total_amount AS totalAmount, s.notes, s.status, s.void_reason AS voidReason, s.created_by AS createdBy, s.created_at AS createdAt, s.updated_at AS updatedAt FROM sales s JOIN service_areas sa ON sa.id = s.area_id JOIN services sv ON sv.id = s.service_id WHERE s.id = ?`)
      .bind(id)
      .first();
    await recordAuditD1(db, { actor, action: 'EDITAR_VENDA', entityType: 'venda', entityId: id, summary: `Venda #${id} alterada (${existing.total_amount} Kz -> ${nextTotal} Kz).`, before: existing, after: updated });
    return json(request, env, updated);
  }

  // Expense categories
  if (path === '/api/expense-categories') {
    if (method === 'GET') {
      const res = await db.prepare('SELECT id, name, active FROM expense_categories ORDER BY id ASC').all();
      return json(request, env, res.results);
    }
    if (method === 'POST') {
      const { name } = await readJsonBody<{ name?: string }>(request);
      const clean = typeof name === 'string' ? name.trim() : '';
      if (!clean) return json(request, env, { error: 'Indique o nome da categoria de despesa.' }, 400);
      const dup = await db.prepare('SELECT id FROM expense_categories WHERE LOWER(name) = LOWER(?)').bind(clean).first();
      if (dup) return json(request, env, { error: 'Já existe uma categoria com esse nome.' }, 409);
      const res = await db.prepare('INSERT INTO expense_categories (name, active) VALUES (?, 1)').bind(clean).run();
      const created = await db.prepare('SELECT id, name, active FROM expense_categories WHERE id = ?').bind(res.meta.last_row_id).first();
      await recordAuditD1(db, { actor, action: 'CRIAR_CATEGORIA_DESPESA', entityType: 'categoria_despesa', entityId: res.meta.last_row_id, summary: `Categoria de despesa criada: ${clean}`, after: created });
      return json(request, env, created, 201);
    }
  }

  const catMatch = path.match(/^\/api\/expense-categories\/(\d+)$/);
  if (catMatch) {
    const id = Number(catMatch[1]);
    const existing = await db.prepare('SELECT * FROM expense_categories WHERE id = ?').bind(id).first<{ id: number; name: string; active: number }>();
    if (!existing) return json(request, env, { error: 'Categoria não encontrada.' }, 404);
    if (method === 'PUT') {
      const { name, active } = await readJsonBody<{ name?: string; active?: number }>(request);
      const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
      const nextActive = active === 0 || active === 1 ? active : existing.active;
      await db.prepare('UPDATE expense_categories SET name = ?, active = ? WHERE id = ?').bind(nextName, nextActive, id).run();
      const updated = await db.prepare('SELECT id, name, active FROM expense_categories WHERE id = ?').bind(id).first();
      await recordAuditD1(db, { actor, action: 'EDITAR_CATEGORIA_DESPESA', entityType: 'categoria_despesa', entityId: id, summary: `Categoria atualizada: ${nextName}`, before: existing, after: updated });
      return json(request, env, updated);
    }
    if (method === 'DELETE') {
      const usage = await db.prepare('SELECT COUNT(*) AS cnt FROM expenses WHERE category_id = ?').bind(id).first<{ cnt: number }>();
      if ((usage?.cnt || 0) > 0) {
        await db.prepare('UPDATE expense_categories SET active = 0 WHERE id = ?').bind(id).run();
        await recordAuditD1(db, { actor, action: 'DESATIVAR_CATEGORIA_DESPESA', entityType: 'categoria_despesa', entityId: id, summary: `Categoria desativada (possui despesas registadas): ${existing.name}` });
        return json(request, env, { ok: true, deactivated: true });
      }
      await db.prepare('DELETE FROM expense_categories WHERE id = ?').bind(id).run();
      await recordAuditD1(db, { actor, action: 'ELIMINAR_CATEGORIA_DESPESA', entityType: 'categoria_despesa', entityId: id, summary: `Categoria eliminada: ${existing.name}` });
      return json(request, env, { ok: true, deactivated: false });
    }
  }

  // Expenses
  if (path === '/api/expenses') {
    if (method === 'GET') {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (url.searchParams.get('includeVoided') !== 'true') conditions.push(`e.status = 'ativo'`);
      const sDate = url.searchParams.get('startDate');
      const eDate = url.searchParams.get('endDate');
      const cId = url.searchParams.get('categoryId');
      if (isValidISODate(sDate)) { conditions.push(`e.expense_date >= ?`); params.push(sDate); }
      if (isValidISODate(eDate)) { conditions.push(`e.expense_date <= ?`); params.push(eDate); }
      if (cId && Number(cId) > 0) { conditions.push(`e.category_id = ?`); params.push(Number(cId)); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await db
        .prepare(
          `SELECT e.id, e.expense_date AS expenseDate, e.category_id AS categoryId, ec.name AS categoryName,
            e.description, e.amount, e.area_id AS areaId, sa.name AS areaName,
            e.notes, e.status, e.void_reason AS voidReason,
            e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt
           FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id LEFT JOIN service_areas sa ON sa.id = e.area_id
           ${where} ORDER BY e.expense_date DESC, e.id DESC`
        )
        .bind(...params)
        .all();
      return json(request, env, res.results);
    }

    if (method === 'POST') {
      const { expenseDate, categoryId, description, amount, areaId, notes } = await readJsonBody<{
        expenseDate?: string; categoryId?: number; description?: string; amount?: number; areaId?: number | null; notes?: string;
      }>(request);
      if (!isValidISODate(expenseDate)) return json(request, env, { error: 'Data da despesa inválida.' }, 400);
      const category = await db.prepare('SELECT id, name FROM expense_categories WHERE id = ?').bind(Number(categoryId)).first<{ id: number; name: string }>();
      if (!category) return json(request, env, { error: 'Selecione uma categoria válida.' }, 400);
      const cleanDesc = typeof description === 'string' ? description.trim() : '';
      if (!cleanDesc) return json(request, env, { error: 'Indique a descrição da despesa.' }, 400);
      const val = Number(amount);
      if (!Number.isFinite(val) || val <= 0) return json(request, env, { error: 'O valor da despesa deve ser superior a 0 Kz.' }, 400);
      const resolvedAreaId = areaId && Number(areaId) > 0 ? Number(areaId) : null;
      const res = await db
        .prepare(`INSERT INTO expenses (expense_date, category_id, description, amount, area_id, notes, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?)`)
        .bind(expenseDate, category.id, cleanDesc, val, resolvedAreaId, typeof notes === 'string' ? notes.trim() : '', actor)
        .run();
      const created = await db
        .prepare(`SELECT e.id, e.expense_date AS expenseDate, e.category_id AS categoryId, ec.name AS categoryName, e.description, e.amount, e.area_id AS areaId, sa.name AS areaName, e.notes, e.status, e.void_reason AS voidReason, e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id LEFT JOIN service_areas sa ON sa.id = e.area_id WHERE e.id = ?`)
        .bind(res.meta.last_row_id)
        .first();
      await recordAuditD1(db, { actor, action: 'CRIAR_DESPESA', entityType: 'despesa', entityId: res.meta.last_row_id, summary: `Despesa registada (${category.name} · ${cleanDesc}): ${val} Kz em ${expenseDate}`, after: created });
      return json(request, env, created, 201);
    }
  }

  const expVoidMatch = path.match(/^\/api\/expenses\/(\d+)\/void$/);
  if (expVoidMatch && method === 'POST') {
    const id = Number(expVoidMatch[1]);
    const { reason } = await readJsonBody<{ reason?: string }>(request);
    const existing = await db.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<{ id: number; amount: number; description: string; status: string }>();
    if (!existing) return json(request, env, { error: 'Despesa não encontrada.' }, 404);
    if (existing.status === 'anulado') return json(request, env, { error: 'Esta despesa já se encontra anulada.' }, 400);
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    await db.prepare(`UPDATE expenses SET status = 'anulado', void_reason = ?, updated_at = datetime('now') WHERE id = ?`).bind(cleanReason, id).run();
    await recordAuditD1(db, { actor, action: 'ANULAR_DESPESA', entityType: 'despesa', entityId: id, summary: `Despesa #${id} (${existing.description} · ${existing.amount} Kz) anulada. Motivo: ${cleanReason}`, before: existing });
    return json(request, env, { ok: true });
  }

  const expMatch = path.match(/^\/api\/expenses\/(\d+)$/);
  if (expMatch && method === 'PUT') {
    const id = Number(expMatch[1]);
    const existing = await db.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<{ id: number; expense_date: string; category_id: number; description: string; amount: number; area_id: number | null; notes: string; status: string }>();
    if (!existing) return json(request, env, { error: 'Despesa não encontrada.' }, 404);
    if (existing.status === 'anulado') return json(request, env, { error: 'Não é possível editar uma despesa anulada.' }, 400);
    const { expenseDate, categoryId, description, amount, areaId, notes } = await readJsonBody<{
      expenseDate?: string; categoryId?: number; description?: string; amount?: number; areaId?: number | null; notes?: string;
    }>(request);
    const nextDate = isValidISODate(expenseDate) ? expenseDate : existing.expense_date;
    const nextCat = categoryId ? Number(categoryId) : existing.category_id;
    const nextDesc = typeof description === 'string' && description.trim() ? description.trim() : existing.description;
    const nextAmount = amount !== undefined ? Number(amount) : existing.amount;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) return json(request, env, { error: 'O valor da despesa deve ser superior a 0 Kz.' }, 400);
    const nextArea = areaId === null ? null : areaId !== undefined ? Number(areaId) : existing.area_id;
    await db.prepare(`UPDATE expenses SET expense_date = ?, category_id = ?, description = ?, amount = ?, area_id = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`).bind(nextDate, nextCat, nextDesc, nextAmount, nextArea, typeof notes === 'string' ? notes.trim() : existing.notes, id).run();
    const updated = await db.prepare(`SELECT e.id, e.expense_date AS expenseDate, e.category_id AS categoryId, ec.name AS categoryName, e.description, e.amount, e.area_id AS areaId, sa.name AS areaName, e.notes, e.status, e.void_reason AS voidReason, e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id LEFT JOIN service_areas sa ON sa.id = e.area_id WHERE e.id = ?`).bind(id).first();
    await recordAuditD1(db, { actor, action: 'EDITAR_DESPESA', entityType: 'despesa', entityId: id, summary: `Despesa #${id} alterada (${existing.amount} Kz -> ${nextAmount} Kz).`, before: existing, after: updated });
    return json(request, env, updated);
  }

  // Deposits
  if (path === '/api/deposits') {
    if (method === 'GET') {
      const conditions: string[] = [];
      const params: unknown[] = [];
      const status = url.searchParams.get('status');
      const includeVoided = url.searchParams.get('includeVoided');
      const sDate = url.searchParams.get('startDate');
      const eDate = url.searchParams.get('endDate');
      if (includeVoided !== 'true' && status !== 'anulado') conditions.push(`status != 'anulado'`);
      if (status && ['realizado', 'pendente', 'anulado'].includes(status)) { conditions.push(`status = ?`); params.push(status); }
      if (isValidISODate(sDate)) { conditions.push(`deposit_date >= ?`); params.push(sDate); }
      if (isValidISODate(eDate)) { conditions.push(`deposit_date <= ?`); params.push(eDate); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const today = getTodayISOWorker();
      const weekStart = addDaysISOWorker(today, -6);
      const fourWeeksStart = addDaysISOWorker(today, -27);
      const [rows, daily, weekly, fourWeeks, pending] = await Promise.all([
        db.prepare(`SELECT id, deposit_date AS depositDate, amount, bank_name AS bankName, reference_code AS referenceCode, related_period AS relatedPeriod, notes, status, void_reason AS voidReason, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt FROM deposits ${where} ORDER BY deposit_date DESC, id DESC`).bind(...params).all(),
        db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date = ?`).bind(today).first<{ total: number }>(),
        db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`).bind(weekStart, today).first<{ total: number }>(),
        db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`).bind(fourWeeksStart, today).first<{ total: number }>(),
        db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'pendente'`).first<{ total: number }>(),
      ]);
      return json(request, env, {
        deposits: rows.results,
        summary: {
          dailyTotal: daily?.total || 0,
          weeklyTotal: weekly?.total || 0,
          fourWeeksTotal: fourWeeks?.total || 0,
          pendingTotal: pending?.total || 0,
        },
      });
    }

    if (method === 'POST') {
      const { depositDate, amount, bankName, referenceCode, relatedPeriod, notes, status } = await readJsonBody<{
        depositDate?: string; amount?: number; bankName?: string; referenceCode?: string; relatedPeriod?: string; notes?: string; status?: 'realizado' | 'pendente';
      }>(request);
      if (!isValidISODate(depositDate)) return json(request, env, { error: 'Data do depósito inválida.' }, 400);
      const val = Number(amount);
      if (!Number.isFinite(val) || val <= 0) return json(request, env, { error: 'O valor depositado deve ser superior a 0 Kz.' }, 400);
      const cleanBank = typeof bankName === 'string' ? bankName.trim() : '';
      if (!cleanBank) return json(request, env, { error: 'Indique o banco ou instituição financeira.' }, 400);
      const cleanRef = typeof referenceCode === 'string' ? referenceCode.trim() : '';
      if (cleanRef) {
        const dup = await db.prepare(`SELECT id FROM deposits WHERE LOWER(reference_code) = LOWER(?) AND status != 'anulado'`).bind(cleanRef).first();
        if (dup) return json(request, env, { error: 'Já existe um depósito registado com este número de comprovativo/referência (evitar duplicação).' }, 409);
      }
      const nextStatus = status === 'pendente' ? 'pendente' : 'realizado';
      const res = await db
        .prepare(`INSERT INTO deposits (deposit_date, amount, bank_name, reference_code, related_period, notes, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(depositDate, val, cleanBank, cleanRef, typeof relatedPeriod === 'string' ? relatedPeriod.trim() : '', typeof notes === 'string' ? notes.trim() : '', nextStatus, actor)
        .run();
      const created = await db.prepare(`SELECT id, deposit_date AS depositDate, amount, bank_name AS bankName, reference_code AS referenceCode, related_period AS relatedPeriod, notes, status, void_reason AS voidReason, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt FROM deposits WHERE id = ?`).bind(res.meta.last_row_id).first();
      await recordAuditD1(db, { actor, action: 'CRIAR_DEPOSITO', entityType: 'deposito', entityId: res.meta.last_row_id, summary: `Depósito (${nextStatus}) em ${cleanBank}: ${val} Kz em ${depositDate}`, after: created });
      return json(request, env, created, 201);
    }
  }

  const depVoidMatch = path.match(/^\/api\/deposits\/(\d+)\/void$/);
  if (depVoidMatch && method === 'POST') {
    const id = Number(depVoidMatch[1]);
    const { reason } = await readJsonBody<{ reason?: string }>(request);
    const existing = await db.prepare('SELECT * FROM deposits WHERE id = ?').bind(id).first<{ id: number; amount: number; bank_name: string; status: string }>();
    if (!existing) return json(request, env, { error: 'Depósito não encontrado.' }, 404);
    if (existing.status === 'anulado') return json(request, env, { error: 'Este depósito já se encontra anulado.' }, 400);
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    await db.prepare(`UPDATE deposits SET status = 'anulado', void_reason = ?, updated_at = datetime('now') WHERE id = ?`).bind(cleanReason, id).run();
    await recordAuditD1(db, { actor, action: 'ANULAR_DEPOSITO', entityType: 'deposito', entityId: id, summary: `Depósito #${id} (${existing.bank_name} · ${existing.amount} Kz) anulado. Motivo: ${cleanReason}`, before: existing });
    return json(request, env, { ok: true });
  }

  const depMatch = path.match(/^\/api\/deposits\/(\d+)$/);
  if (depMatch && method === 'PUT') {
    const id = Number(depMatch[1]);
    const existing = await db.prepare('SELECT * FROM deposits WHERE id = ?').bind(id).first<{ id: number; deposit_date: string; amount: number; bank_name: string; reference_code: string; related_period: string; notes: string; status: string }>();
    if (!existing) return json(request, env, { error: 'Depósito não encontrado.' }, 404);
    if (existing.status === 'anulado') return json(request, env, { error: 'Não é possível editar um depósito anulado.' }, 400);
    const { depositDate, amount, bankName, referenceCode, relatedPeriod, notes, status } = await readJsonBody<{
      depositDate?: string; amount?: number; bankName?: string; referenceCode?: string; relatedPeriod?: string; notes?: string; status?: 'realizado' | 'pendente';
    }>(request);
    const nextDate = isValidISODate(depositDate) ? depositDate : existing.deposit_date;
    const nextAmount = amount !== undefined ? Number(amount) : existing.amount;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) return json(request, env, { error: 'O valor do depósito deve ser superior a 0 Kz.' }, 400);
    const nextBank = typeof bankName === 'string' && bankName.trim() ? bankName.trim() : existing.bank_name;
    const nextRef = typeof referenceCode === 'string' ? referenceCode.trim() : existing.reference_code;
    const nextRelated = typeof relatedPeriod === 'string' ? relatedPeriod.trim() : existing.related_period;
    const nextNotes = typeof notes === 'string' ? notes.trim() : existing.notes;
    const nextStatus = status === 'pendente' || status === 'realizado' ? status : existing.status;
    if (nextRef) {
      const dup = await db.prepare(`SELECT id FROM deposits WHERE LOWER(reference_code) = LOWER(?) AND id != ? AND status != 'anulado'`).bind(nextRef, id).first();
      if (dup) return json(request, env, { error: 'Já existe outro depósito com essa referência.' }, 409);
    }
    await db.prepare(`UPDATE deposits SET deposit_date = ?, amount = ?, bank_name = ?, reference_code = ?, related_period = ?, notes = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).bind(nextDate, nextAmount, nextBank, nextRef, nextRelated, nextNotes, nextStatus, id).run();
    const updated = await db.prepare(`SELECT id, deposit_date AS depositDate, amount, bank_name AS bankName, reference_code AS referenceCode, related_period AS relatedPeriod, notes, status, void_reason AS voidReason, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt FROM deposits WHERE id = ?`).bind(id).first();
    await recordAuditD1(db, { actor, action: 'EDITAR_DEPOSITO', entityType: 'deposito', entityId: id, summary: `Depósito #${id} atualizado (${existing.status} -> ${nextStatus}, ${nextAmount} Kz).`, before: existing, after: updated });
    return json(request, env, updated);
  }

  // Employees
  if (path === '/api/employees') {
    if (method === 'GET') {
      const res = await db.prepare(`SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt FROM employees ORDER BY active DESC, name ASC`).all();
      return json(request, env, res.results);
    }
    if (method === 'POST') {
      const { name, roleTitle, phone, hiredDate } = await readJsonBody<{ name?: string; roleTitle?: string; phone?: string; hiredDate?: string }>(request);
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName) return json(request, env, { error: 'Indique o nome do funcionário.' }, 400);
      const date = isValidISODate(hiredDate) ? hiredDate : getTodayISOWorker();
      const res = await db
        .prepare('INSERT INTO employees (name, role_title, phone, active, hired_date) VALUES (?, ?, ?, 1, ?)')
        .bind(cleanName, typeof roleTitle === 'string' && roleTitle.trim() ? roleTitle.trim() : 'Funcionário', typeof phone === 'string' ? phone.trim() : '', date)
        .run();
      const created = await db.prepare(`SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt FROM employees WHERE id = ?`).bind(res.meta.last_row_id).first();
      await recordAuditD1(db, { actor, action: 'CRIAR_FUNCIONARIO', entityType: 'funcionario', entityId: res.meta.last_row_id, summary: `Funcionário registado: ${cleanName}`, after: created });
      return json(request, env, created, 201);
    }
  }

  const empToggleMatch = path.match(/^\/api\/employees\/(\d+)\/toggle$/);
  if (empToggleMatch && method === 'PATCH') {
    const id = Number(empToggleMatch[1]);
    const existing = await db.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first<{ id: number; name: string; active: number }>();
    if (!existing) return json(request, env, { error: 'Funcionário não encontrado.' }, 404);
    const nextActive = existing.active === 1 ? 0 : 1;
    await db.prepare('UPDATE employees SET active = ? WHERE id = ?').bind(nextActive, id).run();
    await recordAuditD1(db, { actor, action: nextActive === 1 ? 'ATIVAR_FUNCIONARIO' : 'DESATIVAR_FUNCIONARIO', entityType: 'funcionario', entityId: id, summary: `Funcionário ${existing.name} ${nextActive === 1 ? 'ativado' : 'desativado'}.` });
    return json(request, env, { ok: true, active: nextActive });
  }

  const empMatch = path.match(/^\/api\/employees\/(\d+)$/);
  if (empMatch && method === 'PUT') {
    const id = Number(empMatch[1]);
    const existing = await db.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first<{ id: number; name: string; role_title: string; phone: string; active: number; hired_date: string }>();
    if (!existing) return json(request, env, { error: 'Funcionário não encontrado.' }, 404);
    const { name, roleTitle, phone, active, hiredDate } = await readJsonBody<{ name?: string; roleTitle?: string; phone?: string; active?: number; hiredDate?: string }>(request);
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    const nextRole = typeof roleTitle === 'string' && roleTitle.trim() ? roleTitle.trim() : existing.role_title;
    const nextPhone = typeof phone === 'string' ? phone.trim() : existing.phone;
    const nextActive = active === 0 || active === 1 ? active : existing.active;
    const nextHired = isValidISODate(hiredDate) ? hiredDate : existing.hired_date;
    await db.prepare('UPDATE employees SET name = ?, role_title = ?, phone = ?, active = ?, hired_date = ? WHERE id = ?').bind(nextName, nextRole, nextPhone, nextActive, nextHired, id).run();
    const updated = await db.prepare(`SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt FROM employees WHERE id = ?`).bind(id).first();
    await recordAuditD1(db, { actor, action: 'EDITAR_FUNCIONARIO', entityType: 'funcionario', entityId: id, summary: `Funcionário atualizado: ${nextName}`, before: existing, after: updated });
    return json(request, env, updated);
  }

  // Commissions
  if (path === '/api/commissions/overview' && method === 'GET') {
    const today = getTodayISOWorker();
    const commissionRate = Number(await getSettingD1(db, 'commission_rate', '10')) || 10;
    const lastCycle = await db.prepare(`SELECT end_date AS endDate FROM commission_cycles ORDER BY end_date DESC LIMIT 1`).first<{ endDate: string }>();
    const defaultStart = lastCycle ? addDaysISOWorker(lastCycle.endDate, 1) : addDaysISOWorker(today, -27);
    const defaultEnd = lastCycle ? addDaysISOWorker(defaultStart, 27) : today;
    const sParam = url.searchParams.get('startDate');
    const eParam = url.searchParams.get('endDate');
    const startDate = isValidISODate(sParam) ? sParam : defaultStart;
    const endDate = isValidISODate(eParam) ? eParam : defaultEnd;

    const [confirmedDepositsRow, employeesRes, cyclesRes, paymentsRes, paidByEmpRes, closedPerEmpRow, globalState] = await Promise.all([
      db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`).bind(startDate, endDate).first<{ total: number }>(),
      db.prepare(`SELECT id, name, role_title AS roleTitle, phone, active, hired_date AS hiredDate, created_at AS createdAt FROM employees ORDER BY active DESC, name ASC`).all<{ id: number; name: string; roleTitle: string; phone: string; active: number; hiredDate: string; createdAt: string }>(),
      db.prepare(`SELECT id, start_date AS startDate, end_date AS endDate, confirmed_deposits_total AS confirmedDepositsTotal, commission_rate AS commissionRate, eligible_employees_count AS eligibleEmployeesCount, per_employee_amount AS perEmployeeAmount, total_commissions_amount AS totalCommissionsAmount, company_remaining_amount AS companyRemainingAmount, closed_by AS closedBy, closed_at AS closedAt, notes FROM commission_cycles ORDER BY end_date DESC, id DESC`).all(),
      db.prepare(`SELECT cp.id, cp.employee_id AS employeeId, e.name AS employeeName, cp.cycle_id AS cycleId, cp.payment_date AS paymentDate, cp.amount, cp.source, cp.notes, cp.status, cp.void_reason AS voidReason, cp.created_by AS createdBy, cp.created_at AS createdAt FROM commission_payments cp JOIN employees e ON e.id = cp.employee_id ORDER BY cp.payment_date DESC, cp.id DESC`).all(),
      db.prepare(`SELECT employee_id AS employeeId, COALESCE(SUM(amount), 0) AS totalPaid FROM commission_payments WHERE status = 'ativo' GROUP BY employee_id`).all<{ employeeId: number; totalPaid: number }>(),
      db.prepare(`SELECT COALESCE(SUM(per_employee_amount), 0) AS total FROM commission_cycles`).first<{ total: number }>(),
      computeGlobalFinancialStateD1(db),
    ]);

    const employees = employeesRes.results;
    const activeEmployees = employees.filter((e) => e.active === 1);
    const confirmedDepositsTotal = confirmedDepositsRow?.total || 0;
    const perEmployeeAmount = confirmedDepositsTotal * (commissionRate / 100);
    const totalCommissionsAmount = perEmployeeAmount * activeEmployees.length;
    const companyRemainingAmount = confirmedDepositsTotal - totalCommissionsAmount;
    const paidMap = new Map(paidByEmpRes.results.map((r) => [r.employeeId, r.totalPaid]));
    const closedPerEmpSum = closedPerEmpRow?.total || 0;
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

    return json(request, env, {
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
      cycles: cyclesRes.results,
      payments: paymentsRes.results,
    });
  }

  if (path === '/api/commissions/close-cycle' && method === 'POST') {
    const { startDate, endDate, notes } = await readJsonBody<{ startDate?: string; endDate?: string; notes?: string }>(request);
    if (!isValidISODate(startDate) || !isValidISODate(endDate) || startDate > endDate) {
      return json(request, env, { error: 'Período inválido para encerramento de ciclo.' }, 400);
    }
    const overlap = await db.prepare(`SELECT id FROM commission_cycles WHERE NOT (end_date < ? OR start_date > ?)`).bind(startDate, endDate).first();
    if (overlap) return json(request, env, { error: 'Já existe um ciclo de comissões encerrado que abrange estas datas.' }, 409);

    const commissionRate = Number(await getSettingD1(db, 'commission_rate', '10')) || 10;
    const confirmedDepositsTotal = (await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`).bind(startDate, endDate).first<{ total: number }>())?.total || 0;
    const eligibleEmployeesCount = (await db.prepare(`SELECT COUNT(*) AS cnt FROM employees WHERE active = 1`).first<{ cnt: number }>())?.cnt || 0;
    const perEmployeeAmount = confirmedDepositsTotal * (commissionRate / 100);
    const totalCommissionsAmount = perEmployeeAmount * eligibleEmployeesCount;
    const companyRemainingAmount = confirmedDepositsTotal - totalCommissionsAmount;

    const res = await db
      .prepare(`INSERT INTO commission_cycles (start_date, end_date, confirmed_deposits_total, commission_rate, eligible_employees_count, per_employee_amount, total_commissions_amount, company_remaining_amount, closed_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(startDate, endDate, confirmedDepositsTotal, commissionRate, eligibleEmployeesCount, perEmployeeAmount, totalCommissionsAmount, companyRemainingAmount, actor, typeof notes === 'string' ? notes.trim() : '')
      .run();
    const created = await db.prepare(`SELECT id, start_date AS startDate, end_date AS endDate, confirmed_deposits_total AS confirmedDepositsTotal, commission_rate AS commissionRate, eligible_employees_count AS eligibleEmployeesCount, per_employee_amount AS perEmployeeAmount, total_commissions_amount AS totalCommissionsAmount, company_remaining_amount AS companyRemainingAmount, closed_by AS closedBy, closed_at AS closedAt, notes FROM commission_cycles WHERE id = ?`).bind(res.meta.last_row_id).first();
    await recordAuditD1(db, { actor, action: 'ENCERRAR_CICLO_COMISSOES', entityType: 'ciclo_comissoes', entityId: res.meta.last_row_id, summary: `Ciclo de comissões encerrado (${startDate} a ${endDate}): ${totalCommissionsAmount} Kz para ${eligibleEmployeesCount} funcionários.`, after: created });
    return json(request, env, created, 201);
  }

  if (path === '/api/commissions/payments' && method === 'POST') {
    const { employeeId, cycleId, paymentDate, amount, source, notes } = await readJsonBody<{
      employeeId?: number; cycleId?: number | null; paymentDate?: string; amount?: number; source?: 'banco' | 'caixa'; notes?: string;
    }>(request);
    const emp = await db.prepare('SELECT id, name FROM employees WHERE id = ?').bind(Number(employeeId)).first<{ id: number; name: string }>();
    if (!emp) return json(request, env, { error: 'Selecione um funcionário válido.' }, 400);
    if (!isValidISODate(paymentDate)) return json(request, env, { error: 'Data de pagamento inválida.' }, 400);
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) return json(request, env, { error: 'O valor do pagamento deve ser superior a 0 Kz.' }, 400);
    const src = source === 'caixa' ? 'caixa' : 'banco';
    const res = await db
      .prepare(`INSERT INTO commission_payments (employee_id, cycle_id, payment_date, amount, source, notes, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?)`)
      .bind(emp.id, cycleId ? Number(cycleId) : null, paymentDate, val, src, typeof notes === 'string' ? notes.trim() : '', actor)
      .run();
    const created = await db.prepare(`SELECT cp.id, cp.employee_id AS employeeId, e.name AS employeeName, cp.cycle_id AS cycleId, cp.payment_date AS paymentDate, cp.amount, cp.source, cp.notes, cp.status, cp.void_reason AS voidReason, cp.created_by AS createdBy, cp.created_at AS createdAt FROM commission_payments cp JOIN employees e ON e.id = cp.employee_id WHERE cp.id = ?`).bind(res.meta.last_row_id).first();
    await recordAuditD1(db, { actor, action: 'PAGAR_COMISSAO', entityType: 'pagamento_comissao', entityId: res.meta.last_row_id, summary: `Comissão paga a ${emp.name}: ${val} Kz via ${src} em ${paymentDate}`, after: created });
    return json(request, env, created, 201);
  }

  const payVoidMatch = path.match(/^\/api\/commissions\/payments\/(\d+)\/void$/);
  if (payVoidMatch && method === 'POST') {
    const id = Number(payVoidMatch[1]);
    const { reason } = await readJsonBody<{ reason?: string }>(request);
    const existing = await db.prepare('SELECT * FROM commission_payments WHERE id = ?').bind(id).first<{ id: number; amount: number; status: string }>();
    if (!existing) return json(request, env, { error: 'Pagamento não encontrado.' }, 404);
    if (existing.status === 'anulado') return json(request, env, { error: 'Este pagamento já se encontra anulado.' }, 400);
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Anulação administrativa';
    await db.prepare(`UPDATE commission_payments SET status = 'anulado', void_reason = ? WHERE id = ?`).bind(cleanReason, id).run();
    await recordAuditD1(db, { actor, action: 'ANULAR_PAGAMENTO_COMISSAO', entityType: 'pagamento_comissao', entityId: id, summary: `Pagamento de comissão #${id} (${existing.amount} Kz) anulado. Motivo: ${cleanReason}`, before: existing });
    return json(request, env, { ok: true });
  }

  // Daily closings
  if (path === '/api/daily-closings/preview' && method === 'GET') {
    const dateParam = url.searchParams.get('date');
    const date = isValidISODate(dateParam) ? dateParam : getTodayISOWorker();
    return json(request, env, await buildDailyClosingPreviewD1(db, date));
  }

  if (path === '/api/daily-closings') {
    if (method === 'GET') {
      const res = await db
        .prepare(`SELECT id, closing_date AS closingDate, area_breakdown_json AS areaBreakdownJson, total_sales AS totalSales, total_expenses AS totalExpenses, net_after_expenses AS netAfterExpenses, total_deposited AS totalDeposited, expected_cash AS expectedCash, counted_cash AS countedCash, difference_amount AS differenceAmount, notes, closed_by AS closedBy, closed_at AS closedAt, updated_at AS updatedAt FROM daily_closings ORDER BY closing_date DESC`)
        .all();
      return json(request, env, res.results);
    }
    if (method === 'POST') {
      const { closingDate, countedCash, notes, correctionReason } = await readJsonBody<{
        closingDate?: string; countedCash?: number; notes?: string; correctionReason?: string;
      }>(request);
      if (!isValidISODate(closingDate)) return json(request, env, { error: 'Data de fecho inválida.' }, 400);
      const counted = Number(countedCash);
      if (!Number.isFinite(counted) || counted < 0) return json(request, env, { error: 'Indique o valor apurado em caixa (0 Kz ou superior).' }, 400);

      const preview = await buildDailyClosingPreviewD1(db, closingDate);
      const differenceAmount = counted - preview.expectedCash;
      const areaBreakdownJson = JSON.stringify(preview.areaBreakdown);
      const existing = await db.prepare('SELECT * FROM daily_closings WHERE closing_date = ?').bind(closingDate).first();

      if (existing) {
        const reason = typeof correctionReason === 'string' ? correctionReason.trim() : '';
        if (!reason) return json(request, env, { error: 'Este dia já está fechado. Indique o motivo da correção para registar na auditoria.' }, 400);
        await db
          .prepare(`UPDATE daily_closings SET area_breakdown_json = ?, total_sales = ?, total_expenses = ?, net_after_expenses = ?, total_deposited = ?, expected_cash = ?, counted_cash = ?, difference_amount = ?, notes = ?, closed_by = ?, updated_at = datetime('now') WHERE closing_date = ?`)
          .bind(areaBreakdownJson, preview.totalSales, preview.totalExpenses, preview.netAfterExpenses, preview.totalDeposited, preview.expectedCash, counted, differenceAmount, typeof notes === 'string' ? notes.trim() : '', actor, closingDate)
          .run();
        const updated = (await buildDailyClosingPreviewD1(db, closingDate)).existingClosing;
        await recordAuditD1(db, { actor, action: 'CORRIGIR_FECHO_DIARIO', entityType: 'fecho_diario', entityId: closingDate, summary: `Fecho diário de ${closingDate} corrigido. Motivo: ${reason}. Diferença: ${differenceAmount} Kz.`, before: existing, after: updated });
        return json(request, env, updated);
      }

      const res = await db
        .prepare(`INSERT INTO daily_closings (closing_date, area_breakdown_json, total_sales, total_expenses, net_after_expenses, total_deposited, expected_cash, counted_cash, difference_amount, notes, closed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(closingDate, areaBreakdownJson, preview.totalSales, preview.totalExpenses, preview.netAfterExpenses, preview.totalDeposited, preview.expectedCash, counted, differenceAmount, typeof notes === 'string' ? notes.trim() : '', actor)
        .run();
      const created = (await buildDailyClosingPreviewD1(db, closingDate)).existingClosing;
      await recordAuditD1(db, { actor, action: 'FECHAR_DIA', entityType: 'fecho_diario', entityId: res.meta.last_row_id, summary: `Fecho diário de ${closingDate} confirmado. Vendas: ${preview.totalSales} Kz | Diferença: ${differenceAmount} Kz.`, after: created });
      return json(request, env, created, 201);
    }
  }

  // Calendar
  if (path === '/api/calendar' && method === 'GET') {
    const now = new Date();
    const year = Number(url.searchParams.get('year')) || now.getUTCFullYear();
    const month = Number(url.searchParams.get('month')) || now.getUTCMonth() + 1;
    const mm = String(month).padStart(2, '0');
    const startDate = `${year}-${mm}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

    const [salesRows, expensesRows, depositsRows, closingsRows] = await Promise.all([
      db.prepare(`SELECT sale_date AS date, COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ? GROUP BY sale_date`).bind(startDate, endDate).all<{ date: string; total: number; count: number }>(),
      db.prepare(`SELECT expense_date AS date, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ? GROUP BY expense_date`).bind(startDate, endDate).all<{ date: string; total: number }>(),
      db.prepare(`SELECT deposit_date AS date, COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ? GROUP BY deposit_date`).bind(startDate, endDate).all<{ date: string; total: number }>(),
      db.prepare(`SELECT closing_date AS date, difference_amount AS difference FROM daily_closings WHERE closing_date >= ? AND closing_date <= ?`).bind(startDate, endDate).all<{ date: string; difference: number }>(),
    ]);

    return json(request, env, {
      year,
      month,
      salesByDay: Object.fromEntries(salesRows.results.map((r) => [r.date, r])),
      expensesByDay: Object.fromEntries(expensesRows.results.map((r) => [r.date, r.total])),
      depositsByDay: Object.fromEntries(depositsRows.results.map((r) => [r.date, r.total])),
      closingsByDay: Object.fromEntries(closingsRows.results.map((r) => [r.date, r.difference])),
    });
  }

  // Audit logs
  if (path === '/api/audit-logs' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 150, 500);
    const entityType = url.searchParams.get('entityType') || '';
    const res = entityType
      ? await db.prepare(`SELECT id, actor, action, entity_type AS entityType, entity_id AS entityId, summary, before_json AS beforeJson, after_json AS afterJson, created_at AS createdAt FROM audit_logs WHERE entity_type = ? ORDER BY id DESC LIMIT ?`).bind(entityType, limit).all()
      : await db.prepare(`SELECT id, actor, action, entity_type AS entityType, entity_id AS entityId, summary, before_json AS beforeJson, after_json AS afterJson, created_at AS createdAt FROM audit_logs ORDER BY id DESC LIMIT ?`).bind(limit).all();
    return json(request, env, res.results);
  }

  // Backup export & restore
  if (path === '/api/backup/export' && method === 'GET') {
    const [settings, service_areas, services, sales, expense_categories, expenses, deposits, employees, commission_cycles, commission_payments, daily_closings, audit_logs] = await Promise.all([
      db.prepare(`SELECT key, value FROM app_settings WHERE key NOT IN ('admin_password_hash', 'session_secret')`).all(),
      db.prepare('SELECT * FROM service_areas').all(),
      db.prepare('SELECT * FROM services').all(),
      db.prepare('SELECT * FROM sales').all(),
      db.prepare('SELECT * FROM expense_categories').all(),
      db.prepare('SELECT * FROM expenses').all(),
      db.prepare('SELECT * FROM deposits').all(),
      db.prepare('SELECT * FROM employees').all(),
      db.prepare('SELECT * FROM commission_cycles').all(),
      db.prepare('SELECT * FROM commission_payments').all(),
      db.prepare('SELECT * FROM daily_closings').all(),
      db.prepare('SELECT * FROM audit_logs').all(),
    ]);
    await recordAuditD1(db, { actor, action: 'EXPORTAR_BACKUP', entityType: 'backup', summary: 'Cópia de segurança completa exportada em JSON.' });
    return json(
      request,
      env,
      {
        exportedAt: new Date().toISOString(),
        exportedBy: actor,
        version: 1,
        data: {
          settings: settings.results,
          service_areas: service_areas.results,
          services: services.results,
          sales: sales.results,
          expense_categories: expense_categories.results,
          expenses: expenses.results,
          deposits: deposits.results,
          employees: employees.results,
          commission_cycles: commission_cycles.results,
          commission_payments: commission_payments.results,
          daily_closings: daily_closings.results,
          audit_logs: audit_logs.results,
        },
      },
      200,
      { 'Content-Disposition': `attachment; filename="novo-planeta-backup-${getTodayISOWorker()}.json"` }
    );
  }

  if (path === '/api/backup/restore' && method === 'POST') {
    const payload = await readJsonBody<{ version?: number; data?: Record<string, Record<string, unknown>[]> }>(request);
    if (!payload || !payload.data || typeof payload.data !== 'object') {
      return json(request, env, { error: 'Ficheiro de backup inválido.' }, 400);
    }
    const d = payload.data;
    const requiredKeys = ['service_areas', 'services', 'sales', 'expense_categories', 'expenses', 'deposits', 'employees', 'commission_cycles', 'commission_payments', 'daily_closings'];
    for (const k of requiredKeys) {
      if (!Array.isArray(d[k])) return json(request, env, { error: `Backup incompleto: falta a tabela "${k}".` }, 400);
    }

    const stmts = [
      db.prepare('PRAGMA foreign_keys = OFF'),
      db.prepare('DELETE FROM commission_payments'),
      db.prepare('DELETE FROM commission_cycles'),
      db.prepare('DELETE FROM daily_closings'),
      db.prepare('DELETE FROM deposits'),
      db.prepare('DELETE FROM expenses'),
      db.prepare('DELETE FROM expense_categories'),
      db.prepare('DELETE FROM sales'),
      db.prepare('DELETE FROM services'),
      db.prepare('DELETE FROM service_areas'),
      db.prepare('DELETE FROM employees'),
    ];

    if (Array.isArray(d.settings)) {
      for (const row of d.settings) {
        if (row.key && row.key !== 'admin_password_hash' && row.key !== 'session_secret' && row.key !== 'is_default_password') {
          stmts.push(
            db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(String(row.key), String(row.value ?? ''))
          );
        }
      }
    }
    for (const r of d.service_areas) {
      stmts.push(db.prepare('INSERT INTO service_areas (id, name, slug, description, sort_order, active) VALUES (?, ?, ?, ?, ?, ?)').bind(r.id, r.name, r.slug, r.description ?? '', r.sort_order ?? 0, r.active ?? 1));
    }
    for (const r of d.services) {
      stmts.push(db.prepare('INSERT INTO services (id, area_id, name, default_price, active) VALUES (?, ?, ?, ?, ?)').bind(r.id, r.area_id, r.name, r.default_price ?? null, r.active ?? 1));
    }
    for (const r of d.sales) {
      stmts.push(db.prepare(`INSERT INTO sales (id, sale_date, area_id, service_id, quantity, unit_price, total_amount, notes, status, void_reason, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.sale_date, r.area_id, r.service_id, r.quantity ?? null, r.unit_price ?? null, r.total_amount, r.notes ?? '', r.status ?? 'ativo', r.void_reason ?? null, r.created_by ?? 'CEO', r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString()));
    }
    for (const r of d.expense_categories) {
      stmts.push(db.prepare('INSERT INTO expense_categories (id, name, active) VALUES (?, ?, ?)').bind(r.id, r.name, r.active ?? 1));
    }
    for (const r of d.expenses) {
      stmts.push(db.prepare(`INSERT INTO expenses (id, expense_date, category_id, description, amount, area_id, notes, status, void_reason, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.expense_date, r.category_id, r.description, r.amount, r.area_id ?? null, r.notes ?? '', r.status ?? 'ativo', r.void_reason ?? null, r.created_by ?? 'CEO', r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString()));
    }
    for (const r of d.deposits) {
      stmts.push(db.prepare(`INSERT INTO deposits (id, deposit_date, amount, bank_name, reference_code, related_period, notes, status, void_reason, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.deposit_date, r.amount, r.bank_name, r.reference_code ?? '', r.related_period ?? '', r.notes ?? '', r.status ?? 'realizado', r.void_reason ?? null, r.created_by ?? 'CEO', r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString()));
    }
    for (const r of d.employees) {
      stmts.push(db.prepare('INSERT INTO employees (id, name, role_title, phone, active, hired_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(r.id, r.name, r.role_title ?? 'Funcionário', r.phone ?? '', r.active ?? 1, r.hired_date, r.created_at ?? new Date().toISOString()));
    }
    for (const r of d.commission_cycles) {
      stmts.push(db.prepare(`INSERT INTO commission_cycles (id, start_date, end_date, confirmed_deposits_total, commission_rate, eligible_employees_count, per_employee_amount, total_commissions_amount, company_remaining_amount, closed_by, closed_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.start_date, r.end_date, r.confirmed_deposits_total, r.commission_rate, r.eligible_employees_count, r.per_employee_amount, r.total_commissions_amount, r.company_remaining_amount, r.closed_by ?? 'CEO', r.closed_at ?? new Date().toISOString(), r.notes ?? ''));
    }
    for (const r of d.commission_payments) {
      stmts.push(db.prepare(`INSERT INTO commission_payments (id, employee_id, cycle_id, payment_date, amount, source, notes, status, void_reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.employee_id, r.cycle_id ?? null, r.payment_date, r.amount, r.source ?? 'banco', r.notes ?? '', r.status ?? 'ativo', r.void_reason ?? null, r.created_by ?? 'CEO', r.created_at ?? new Date().toISOString()));
    }
    for (const r of d.daily_closings) {
      stmts.push(db.prepare(`INSERT INTO daily_closings (id, closing_date, area_breakdown_json, total_sales, total_expenses, net_after_expenses, total_deposited, expected_cash, counted_cash, difference_amount, notes, closed_by, closed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.closing_date, r.area_breakdown_json ?? '[]', r.total_sales, r.total_expenses, r.net_after_expenses, r.total_deposited, r.expected_cash, r.counted_cash, r.difference_amount, r.notes ?? '', r.closed_by ?? 'CEO', r.closed_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString()));
    }
    stmts.push(db.prepare('PRAGMA foreign_keys = ON'));

    await db.batch(stmts);
    await recordAuditD1(db, { actor, action: 'RESTAURAR_BACKUP', entityType: 'backup', summary: 'Base de dados restaurada a partir de ficheiro de cópia de segurança JSON.' });
    return json(request, env, { ok: true });
  }

  return json(request, env, { error: `Rota API não encontrada: ${method} ${path}` }, 404);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      return handleApiRequest(request, env);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('NOVO PLANETA API Worker ativo.', { status: 200 });
  },
};
