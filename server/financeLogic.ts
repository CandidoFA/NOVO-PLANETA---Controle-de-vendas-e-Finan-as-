import { db, getSetting } from './db.ts';

export function getTodayISOServer(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISOServer(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function listDatesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 400) {
    dates.push(cursor);
    cursor = addDaysISOServer(cursor, 1);
    guard++;
  }
  return dates;
}

export function computeGlobalFinancialState() {
  const commissionRate = Number(getSetting('commission_rate', '10')) || 10;

  const salesRow = db
    .prepare(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo'`)
    .get() as { total: number };

  const expensesRow = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo'`)
    .get() as { total: number };

  const confirmedDepositsRow = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado'`)
    .get() as { total: number };

  const pendingDepositsRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'pendente'`
    )
    .get() as { cnt: number; total: number };

  const activeEmployeesRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM employees WHERE active = 1`)
    .get() as { cnt: number };

  const closedCyclesSummary = db
    .prepare(
      `SELECT COALESCE(SUM(total_commissions_amount), 0) AS totalCommissions,
              MAX(end_date) AS lastEndDate
       FROM commission_cycles`
    )
    .get() as { totalCommissions: number; lastEndDate: string | null };

  let unclosedConfirmedDeposits = confirmedDepositsRow.total;
  if (closedCyclesSummary.lastEndDate) {
    const unclosedRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM deposits
         WHERE status = 'realizado' AND deposit_date > ?`
      )
      .get(closedCyclesSummary.lastEndDate) as { total: number };
    unclosedConfirmedDeposits = unclosedRow.total;
  }

  const eligibleEmployeesCount = activeEmployeesRow.cnt;
  const openCycleCommissionTotal =
    eligibleEmployeesCount * (unclosedConfirmedDeposits * (commissionRate / 100));

  const accumulatedCommissionsTotal =
    closedCyclesSummary.totalCommissions + openCycleCommissionTotal;

  const paymentsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(amount), 0) AS totalPaid,
         COALESCE(SUM(CASE WHEN source = 'caixa' THEN amount ELSE 0 END), 0) AS paidFromCaixa,
         COALESCE(SUM(CASE WHEN source = 'banco' THEN amount ELSE 0 END), 0) AS paidFromBanco
       FROM commission_payments
       WHERE status = 'ativo'`
    )
    .get() as { totalPaid: number; paidFromCaixa: number; paidFromBanco: number };

  const accumulatedSales = salesRow.total;
  const accumulatedExpenses = expensesRow.total;
  const accumulatedNet = accumulatedSales - accumulatedExpenses;
  const accumulatedConfirmedDeposits = confirmedDepositsRow.total;
  const accumulatedPendingDeposits = pendingDepositsRow.total;
  const accumulatedCommissionsPaid = paymentsRow.totalPaid;
  const accumulatedCommissionsPending = Math.max(
    0,
    accumulatedCommissionsTotal - accumulatedCommissionsPaid
  );

  // Reconciled balances without double counting deposits:
  // Cash on hand = Sales - Expenses - Confirmed Deposits - Commissions Paid from Cash
  const undepositedCash =
    accumulatedNet - accumulatedConfirmedDeposits - paymentsRow.paidFromCaixa;
  // Bank balance = Confirmed Deposits - Commissions Paid from Bank
  const bankBalance = accumulatedConfirmedDeposits - paymentsRow.paidFromBanco;
  // Company Saved Money = Net Accumulated - Total Commissions Reserved/Earned
  const companySavedMoney = accumulatedNet - accumulatedCommissionsTotal;

  return {
    commissionRate,
    eligibleEmployeesCount,
    accumulatedSales,
    accumulatedExpenses,
    accumulatedNet,
    accumulatedConfirmedDeposits,
    accumulatedPendingDeposits,
    pendingDepositsCount: pendingDepositsRow.cnt,
    accumulatedCommissionsTotal,
    accumulatedCommissionsPaid,
    accumulatedCommissionsPending,
    companySavedMoney,
    undepositedCash,
    bankBalance,
    unclosedConfirmedDeposits,
    lastClosedCycleEndDate: closedCyclesSummary.lastEndDate,
  };
}

export function buildDashboardData(startDate: string, endDate: string) {
  const today = getTodayISOServer();
  const weekStart = addDaysISOServer(today, -6);
  const fourWeeksStart = addDaysISOServer(today, -27);

  const globalState = computeGlobalFinancialState();

  const periodSalesRow = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM sales
       WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`
    )
    .get(startDate, endDate) as { total: number };

  const periodExpensesRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ?`
    )
    .get(startDate, endDate) as { total: number };

  const periodConfirmedDepositsRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM deposits
       WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`
    )
    .get(startDate, endDate) as { total: number };

  const periodPendingDepositsRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM deposits
       WHERE status = 'pendente' AND deposit_date >= ? AND deposit_date <= ?`
    )
    .get(startDate, endDate) as { total: number };

  const weekSalesRow = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM sales
       WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`
    )
    .get(weekStart, today) as { total: number };

  const fourWeeksSalesRow = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM sales
       WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`
    )
    .get(fourWeeksStart, today) as { total: number };

  // Sales by area in selected period
  const salesByArea = db
    .prepare(
      `SELECT sa.id AS areaId, sa.name AS areaName, COALESCE(SUM(s.total_amount), 0) AS total
       FROM service_areas sa
       LEFT JOIN sales s ON s.area_id = sa.id AND s.status = 'ativo' AND s.sale_date >= ? AND s.sale_date <= ?
       WHERE sa.active = 1
       GROUP BY sa.id, sa.name
       ORDER BY sa.sort_order ASC, sa.id ASC`
    )
    .all(startDate, endDate) as { areaId: number; areaName: string; total: number }[];

  // Daily evolution: either selected range (if <= 31 days) or last 14 days ending at endDate
  const dailyStart =
    listDatesBetween(startDate, endDate).length <= 31 ? startDate : addDaysISOServer(endDate, -13);
  const dailyDates = listDatesBetween(dailyStart, endDate);

  const dailySalesRows = db
    .prepare(
      `SELECT sale_date AS d, COALESCE(SUM(total_amount), 0) AS total
       FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?
       GROUP BY sale_date`
    )
    .all(dailyStart, endDate) as { d: string; total: number }[];
  const dailyExpensesRows = db
    .prepare(
      `SELECT expense_date AS d, COALESCE(SUM(amount), 0) AS total
       FROM expenses WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ?
       GROUP BY expense_date`
    )
    .all(dailyStart, endDate) as { d: string; total: number }[];
  const dailyDepositsRows = db
    .prepare(
      `SELECT deposit_date AS d, COALESCE(SUM(amount), 0) AS total
       FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?
       GROUP BY deposit_date`
    )
    .all(dailyStart, endDate) as { d: string; total: number }[];

  const dailySalesMap = new Map(dailySalesRows.map((r) => [r.d, r.total]));
  const dailyExpensesMap = new Map(dailyExpensesRows.map((r) => [r.d, r.total]));
  const dailyDepositsMap = new Map(dailyDepositsRows.map((r) => [r.d, r.total]));

  const dailyEvolution = dailyDates.map((date) => ({
    date,
    sales: dailySalesMap.get(date) || 0,
    expenses: dailyExpensesMap.get(date) || 0,
    deposits: dailyDepositsMap.get(date) || 0,
  }));

  // Weekly evolution: last 4 weeks ending on today
  const weeklyEvolution: {
    weekLabel: string;
    startDate: string;
    endDate: string;
    sales: number;
    expenses: number;
    deposits: number;
  }[] = [];

  for (let i = 3; i >= 0; i--) {
    const wEnd = addDaysISOServer(today, -i * 7);
    const wStart = addDaysISOServer(wEnd, -6);
    const wSales = (
      db
        .prepare(
          `SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`
        )
        .get(wStart, wEnd) as { total: number }
    ).total;
    const wExpenses = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo' AND expense_date >= ? AND expense_date <= ?`
        )
        .get(wStart, wEnd) as { total: number }
    ).total;
    const wDeposits = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date >= ? AND deposit_date <= ?`
        )
        .get(wStart, wEnd) as { total: number }
    ).total;

    weeklyEvolution.push({
      weekLabel: `Sem ${4 - i}`,
      startDate: wStart,
      endDate: wEnd,
      sales: wSales,
      expenses: wExpenses,
      deposits: wDeposits,
    });
  }

  // Recent financial movements (last 12 across sales, expenses, deposits, commissions)
  const recentMovements = db
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

  // Alerts: days without sales in the last 7 days (only if at least 1 sale exists in history, so fresh empty DB doesn't spam false alerts; or show today if no sales today once active)
  const totalSalesCount = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM sales WHERE status = 'ativo'`).get() as { cnt: number }
  ).cnt;

  const daysWithoutSales: string[] = [];
  if (totalSalesCount > 0) {
    const firstSaleRow = db
      .prepare(`SELECT MIN(sale_date) AS firstDate FROM sales WHERE status = 'ativo'`)
      .get() as { firstDate: string | null };
    const checkStart =
      firstSaleRow.firstDate && firstSaleRow.firstDate > weekStart ? firstSaleRow.firstDate : weekStart;

    const last7Dates = listDatesBetween(checkStart, today);
    const activeSaleDates = new Set(
      (
        db
          .prepare(
            `SELECT DISTINCT sale_date FROM sales WHERE status = 'ativo' AND sale_date >= ? AND sale_date <= ?`
          )
          .all(checkStart, today) as { sale_date: string }[]
      ).map((r) => r.sale_date)
    );
    for (const d of last7Dates) {
      if (!activeSaleDates.has(d)) {
        daysWithoutSales.push(d);
      }
    }
  }

  const closingDiscrepancies = db
    .prepare(
      `SELECT closing_date AS date, difference_amount AS difference
       FROM daily_closings
       WHERE ABS(difference_amount) > 0.01
       ORDER BY closing_date DESC
       LIMIT 5`
    )
    .all() as { date: string; difference: number }[];

  return {
    period: { startDate, endDate, today },
    kpis: {
      periodSales: periodSalesRow.total,
      periodExpenses: periodExpensesRow.total,
      periodNet: periodSalesRow.total - periodExpensesRow.total,
      periodConfirmedDeposits: periodConfirmedDepositsRow.total,
      periodPendingDeposits: periodPendingDepositsRow.total,
      weekSales: weekSalesRow.total,
      fourWeeksSales: fourWeeksSalesRow.total,
      ...globalState,
    },
    charts: {
      salesByArea,
      dailyEvolution,
      weeklyEvolution,
    },
    recentMovements,
    alerts: {
      daysWithoutSales,
      closingDiscrepancies,
      negativeCashAlert: globalState.undepositedCash < -0.01,
      pendingDepositsCount: globalState.pendingDepositsCount,
      pendingDepositsAmount: globalState.accumulatedPendingDeposits,
    },
  };
}

export function buildDailyClosingPreview(closingDate: string) {
  const areaBreakdown = db
    .prepare(
      `SELECT sa.id AS areaId, sa.name AS areaName, COALESCE(SUM(s.total_amount), 0) AS total
       FROM service_areas sa
       LEFT JOIN sales s ON s.area_id = sa.id AND s.status = 'ativo' AND s.sale_date = ?
       WHERE sa.active = 1
       GROUP BY sa.id, sa.name
       ORDER BY sa.sort_order ASC, sa.id ASC`
    )
    .all(closingDate) as { areaId: number; areaName: string; total: number }[];

  const totalSales = areaBreakdown.reduce((acc, row) => acc + row.total, 0);

  const totalExpenses = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE status = 'ativo' AND expense_date = ?`
      )
      .get(closingDate) as { total: number }
  ).total;

  const totalDeposited = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE status = 'realizado' AND deposit_date = ?`
      )
      .get(closingDate) as { total: number }
  ).total;

  const netAfterExpenses = totalSales - totalExpenses;
  const expectedCash = netAfterExpenses - totalDeposited;

  const existingClosing = db
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
    .get(closingDate);

  return {
    closingDate,
    areaBreakdown,
    totalSales,
    totalExpenses,
    netAfterExpenses,
    totalDeposited,
    expectedCash,
    existingClosing: existingClosing || null,
  };
}
