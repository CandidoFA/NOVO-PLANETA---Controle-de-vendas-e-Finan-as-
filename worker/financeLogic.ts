import { getSettingD1 } from './db';
import { D1Database } from './types';

export function getTodayISOWorker(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISOWorker(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function listDatesBetweenWorker(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 400) {
    dates.push(cursor);
    cursor = addDaysISOWorker(cursor, 1);
    guard++;
  }
  return dates;
}

export async function computeGlobalFinancialStateD1(db: D1Database) {
  const commissionRate = Number(await getSettingD1(db, 'commission_rate', '10')) || 10;

  const [
    salesRow,
    expensesRow,
    confirmedDepositsRow,
    pendingDepositsRow,
    activeEmployeesRow,
    closedCyclesSummary,
    paymentsRow,
  ] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo'`).first<{ total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo'`).first<{ total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado'`).first<{ total: number }>(),
    db.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'pendente'`).first<{ cnt: number; total: number }>(),
    db.prepare(`SELECT COUNT(*) AS cnt FROM employees WHERE active = 1`).first<{ cnt: number }>(),
    db.prepare(`SELECT COALESCE(SUM(total_commissions_amount), 0) AS totalCommissions, MAX(end_date) AS lastEndDate FROM commission_cycles`).first<{ totalCommissions: number; lastEndDate: string | null }>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(amount), 0) AS totalPaid,
         COALESCE(SUM(CASE WHEN source = 'caixa' THEN amount ELSE 0 END), 0) AS paidFromCaixa,
         COALESCE(SUM(CASE WHEN source = 'banco' THEN amount ELSE 0 END), 0) AS paidFromBanco
       FROM commission_payments WHERE status = 'ativo'`
    ).first<{ totalPaid: number; paidFromCaixa: number; paidFromBanco: number }>(),
  ]);

  let unclosedConfirmedDeposits = confirmedDepositsRow?.total || 0;
  if (closedCyclesSummary?.lastEndDate) {
    const unclosedRow = await db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM deposits
         WHERE status = 'realizado' AND deposit_date > ?`
      )
      .bind(closedCyclesSummary.lastEndDate)
      .first<{ total: number }>();
    unclosedConfirmedDeposits = unclosedRow?.total || 0;
  }

  const eligibleEmployeesCount = activeEmployeesRow?.cnt || 0;
  const openCycleCommissionTotal =
    eligibleEmployeesCount * (unclosedConfirmedDeposits * (commissionRate / 100));

  const accumulatedCommissionsTotal =
    (closedCyclesSummary?.totalCommissions || 0) + openCycleCommissionTotal;

  const accumulatedSales = salesRow?.total || 0;
  const accumulatedExpenses = expensesRow?.total || 0;
  const accumulatedNet = accumulatedSales - accumulatedExpenses;
  const accumulatedConfirmedDeposits = confirmedDepositsRow?.total || 0;
  const accumulatedPendingDeposits = pendingDepositsRow?.total || 0;
  const accumulatedCommissionsPaid = paymentsRow?.totalPaid || 0;
  const accumulatedCommissionsPending = Math.max(
    0,
    accumulatedCommissionsTotal - accumulatedCommissionsPaid
  );

  const undepositedCash =
    accumulatedNet - accumulatedConfirmedDeposits - (paymentsRow?.paidFromCaixa || 0);
  const bankBalance = accumulatedConfirmedDeposits - (paymentsRow?.paidFromBanco || 0);
  const companySavedMoney = accumulatedNet - accumulatedCommissionsTotal;

  return {
    commissionRate,
    eligibleEmployeesCount,
    accumulatedSales,
    accumulatedExpenses,
    accumulatedNet,
    accumulatedConfirmedDeposits,
    accumulatedPendingDeposits,
    pendingDepositsCount: pendingDepositsRow?.cnt || 0,
    accumulatedCommissionsTotal,
    accumulatedCommissionsPaid,
    accumulatedCommissionsPending,
    companySavedMoney,
    undepositedCash,
    bankBalance,
    unclosedConfirmedDeposits,
    lastClosedCycleEndDate: closedCyclesSummary?.lastEndDate || null,
  };
}

export async function buildDashboardDataD1(db: D1Database, startDate: string, endDate: string) {
  const today = getTodayISOWorker();
  const weekStart = addDaysISOWorker(today, -6);
  const fourWeeksStart = addDaysISOWorker(today, -27);

  const globalState = await computeGlobalFinancialStateD1(db);

  const [
    periodSalesRow,
    periodExpensesRow,
    periodConfirmedDepositsRow,
    periodPendingDepositsRow,
    weekSalesRow,
    fourWeeksSalesRow,
    salesByAreaRes,
  ] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`).bind(startDate, endDate).first<{ total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ?`).bind(startDate, endDate).first<{ total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`).bind(startDate, endDate).first<{ total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'pendente' AND deposit_date >= ? AND deposit_date <= ?`).bind(startDate, endDate).first<{ total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`).bind(weekStart, today).first<{ total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`).bind(fourWeeksStart, today).first<{ total: number }>(),
    db
      .prepare(
        `SELECT sa.id AS areaId, sa.name AS areaName, COALESCE(SUM(s.total_amount), 0) AS total
         FROM service_areas sa
         LEFT JOIN sales s ON s.area_id = sa.id AND s.status = 'ativo' AND s.sale_date >= ? AND s.sale_date <= ?
         WHERE sa.active = 1
         GROUP BY sa.id, sa.name
         ORDER BY sa.sort_order ASC, sa.id ASC`
      )
      .bind(startDate, endDate)
      .all<{ areaId: number; areaName: string; total: number }>(),
  ]);

  const dailyStart =
    listDatesBetweenWorker(startDate, endDate).length <= 31
      ? startDate
      : addDaysISOWorker(endDate, -13);
  const dailyDates = listDatesBetweenWorker(dailyStart, endDate);

  const [dailySalesRes, dailyExpensesRes, dailyDepositsRes] = await Promise.all([
    db.prepare(`SELECT sale_date AS d, COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ? GROUP BY sale_date`).bind(dailyStart, endDate).all<{ d: string; total: number }>(),
    db.prepare(`SELECT expense_date AS d, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ? GROUP BY expense_date`).bind(dailyStart, endDate).all<{ d: string; total: number }>(),
    db.prepare(`SELECT deposit_date AS d, COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ? GROUP BY deposit_date`).bind(dailyStart, endDate).all<{ d: string; total: number }>(),
  ]);

  const dailySalesMap = new Map(dailySalesRes.results.map((r) => [r.d, r.total]));
  const dailyExpensesMap = new Map(dailyExpensesRes.results.map((r) => [r.d, r.total]));
  const dailyDepositsMap = new Map(dailyDepositsRes.results.map((r) => [r.d, r.total]));

  const dailyEvolution = dailyDates.map((date) => ({
    date,
    sales: dailySalesMap.get(date) || 0,
    expenses: dailyExpensesMap.get(date) || 0,
    deposits: dailyDepositsMap.get(date) || 0,
  }));

  const weeklyEvolution: {
    weekLabel: string;
    startDate: string;
    endDate: string;
    sales: number;
    expenses: number;
    deposits: number;
  }[] = [];

  for (let i = 3; i >= 0; i--) {
    const wEnd = addDaysISOWorker(today, -i * 7);
    const wStart = addDaysISOWorker(wEnd, -6);
    const [wS, wE, wD] = await Promise.all([
      db.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`).bind(wStart, wEnd).first<{ total: number }>(),
      db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ?`).bind(wStart, wEnd).first<{ total: number }>(),
      db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`).bind(wStart, wEnd).first<{ total: number }>(),
    ]);
    weeklyEvolution.push({
      weekLabel: `Sem ${4 - i}`,
      startDate: wStart,
      endDate: wEnd,
      sales: wS?.total || 0,
      expenses: wE?.total || 0,
      deposits: wD?.total || 0,
    });
  }

  const recentMovementsRes = await db
    .prepare(
      `SELECT * FROM (
        SELECT
          'venda-' || s.id AS uid,
          'venda' AS type,
          s.sale_date AS date,
          sv.name AS title,
          sa.name AS subtitle,
          s.total_amount AS amount,
          s.status AS status,
          s.created_at AS createdAt
        FROM sales s
        JOIN services sv ON sv.id = s.service_id
        JOIN service_areas sa ON sa.id = s.area_id
        UNION ALL
        SELECT
          'despesa-' || e.id AS uid,
          'despesa' AS type,
          e.expense_date AS date,
          e.description AS title,
          ec.name AS subtitle,
          e.amount AS amount,
          e.status AS status,
          e.created_at AS createdAt
        FROM expenses e
        JOIN expense_categories ec ON ec.id = e.category_id
        UNION ALL
        SELECT
          'deposito-' || d.id AS uid,
          'deposito' AS type,
          d.deposit_date AS date,
          d.bank_name AS title,
          CASE WHEN d.reference_code != '' THEN 'Ref: ' || d.reference_code ELSE 'Depósito bancário' END AS subtitle,
          d.amount AS amount,
          d.status AS status,
          d.created_at AS createdAt
        FROM deposits d
        UNION ALL
        SELECT
          'comissao-' || cp.id AS uid,
          'comissao' AS type,
          cp.payment_date AS date,
          'Comissão · ' || emp.name AS title,
          CASE WHEN cp.source = 'banco' THEN 'Pago via Banco' ELSE 'Pago via Caixa' END AS subtitle,
          cp.amount AS amount,
          cp.status AS status,
          cp.created_at AS createdAt
        FROM commission_payments cp
        JOIN employees emp ON emp.id = cp.employee_id
      )
      ORDER BY date DESC, createdAt DESC
      LIMIT 12`
    )
    .all();

  const totalSalesCountRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM sales WHERE status = 'ativo'`)
    .first<{ cnt: number }>();

  const daysWithoutSales: string[] = [];
  if ((totalSalesCountRow?.cnt || 0) > 0) {
    const firstSaleRow = await db
      .prepare(`SELECT MIN(sale_date) AS firstDate FROM sales WHERE status = 'ativo'`)
      .first<{ firstDate: string | null }>();
    const checkStart =
      firstSaleRow?.firstDate && firstSaleRow.firstDate > weekStart ? firstSaleRow.firstDate : weekStart;

    const last7Dates = listDatesBetweenWorker(checkStart, today);
    const activeDatesRes = await db
      .prepare(`SELECT DISTINCT sale_date FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`)
      .bind(checkStart, today)
      .all<{ sale_date: string }>();
    const activeSaleDates = new Set(activeDatesRes.results.map((r) => r.sale_date));
    for (const d of last7Dates) {
      if (!activeSaleDates.has(d)) daysWithoutSales.push(d);
    }
  }

  const closingDiscrepanciesRes = await db
    .prepare(
      `SELECT closing_date AS date, difference_amount AS difference
       FROM daily_closings
       WHERE ABS(difference_amount) > 0.01
       ORDER BY closing_date DESC
       LIMIT 5`
    )
    .all<{ date: string; difference: number }>();

  const periodSales = periodSalesRow?.total || 0;
  const periodExpenses = periodExpensesRow?.total || 0;

  return {
    period: { startDate, endDate, today },
    kpis: {
      periodSales,
      periodExpenses,
      periodNet: periodSales - periodExpenses,
      periodConfirmedDeposits: periodConfirmedDepositsRow?.total || 0,
      periodPendingDeposits: periodPendingDepositsRow?.total || 0,
      weekSales: weekSalesRow?.total || 0,
      fourWeeksSales: fourWeeksSalesRow?.total || 0,
      ...globalState,
    },
    charts: {
      salesByArea: salesByAreaRes.results,
      dailyEvolution,
      weeklyEvolution,
    },
    recentMovements: recentMovementsRes.results,
    alerts: {
      daysWithoutSales,
      closingDiscrepancies: closingDiscrepanciesRes.results,
      negativeCashAlert: globalState.undepositedCash < -0.01,
      pendingDepositsCount: globalState.pendingDepositsCount,
      pendingDepositsAmount: globalState.accumulatedPendingDeposits,
    },
  };
}

export async function buildDailyClosingPreviewD1(db: D1Database, closingDate: string) {
  const [areaRes, expensesRow, depositedRow, existingClosing] = await Promise.all([
    db
      .prepare(
        `SELECT sa.id AS areaId, sa.name AS areaName, COALESCE(SUM(s.total_amount), 0) AS total
         FROM service_areas sa
         LEFT JOIN sales s ON s.area_id = sa.id AND s.status = 'ativo' AND s.sale_date = ?
         WHERE sa.active = 1
         GROUP BY sa.id, sa.name
         ORDER BY sa.sort_order ASC, sa.id ASC`
      )
      .bind(closingDate)
      .all<{ areaId: number; areaName: string; total: number }>(),
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo' AND expense_date = ?`)
      .bind(closingDate)
      .first<{ total: number }>(),
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date = ?`)
      .bind(closingDate)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT
          id, closing_date AS closingDate, area_breakdown_json AS areaBreakdownJson,
          total_sales AS totalSales, total_expenses AS totalExpenses,
          net_after_expenses AS netAfterExpenses, total_deposited AS totalDeposited,
          expected_cash AS expectedCash, counted_cash AS countedCash,
          difference_amount AS differenceAmount, notes, closed_by AS closedBy,
          closed_at AS closedAt, updated_at AS updatedAt
         FROM daily_closings WHERE closing_date = ?`
      )
      .bind(closingDate)
      .first(),
  ]);

  const totalSales = areaRes.results.reduce((acc, r) => acc + r.total, 0);
  const totalExpenses = expensesRow?.total || 0;
  const totalDeposited = depositedRow?.total || 0;
  const netAfterExpenses = totalSales - totalExpenses;
  const expectedCash = netAfterExpenses - totalDeposited;

  return {
    closingDate,
    areaBreakdown: areaRes.results,
    totalSales,
    totalExpenses,
    netAfterExpenses,
    totalDeposited,
    expectedCash,
    existingClosing: existingClosing || null,
  };
}
