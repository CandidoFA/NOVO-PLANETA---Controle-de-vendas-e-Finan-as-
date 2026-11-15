export type AdminRole = 'CEO' | 'PCA' | 'Administração';

export type RecordStatus = 'ativo' | 'anulado';
export type DepositStatus = 'realizado' | 'pendente' | 'anulado';
export type PaymentSource = 'banco' | 'caixa';

export interface AppSettings {
  companyName: string;
  logoUrl: string;
  commissionRate: number;
}

export interface ServiceArea {
  id: number;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  active: number;
}

export interface ServiceItem {
  id: number;
  areaId: number;
  areaName?: string;
  name: string;
  defaultPrice: number | null;
  active: number;
}

export interface SaleRecord {
  id: number;
  saleDate: string; // YYYY-MM-DD
  areaId: number;
  areaName: string;
  serviceId: number;
  serviceName: string;
  quantity: number | null;
  unitPrice: number | null;
  totalAmount: number;
  notes: string;
  status: RecordStatus;
  voidReason: string | null;
  createdBy: AdminRole;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCategory {
  id: number;
  name: string;
  active: number;
}

export interface ExpenseRecord {
  id: number;
  expenseDate: string; // YYYY-MM-DD
  categoryId: number;
  categoryName: string;
  description: string;
  amount: number;
  areaId: number | null;
  areaName: string | null;
  notes: string;
  status: RecordStatus;
  voidReason: string | null;
  createdBy: AdminRole;
  createdAt: string;
  updatedAt: string;
}

export interface DepositRecord {
  id: number;
  depositDate: string; // YYYY-MM-DD
  amount: number;
  bankName: string;
  referenceCode: string;
  relatedPeriod: string;
  notes: string;
  status: DepositStatus;
  voidReason: string | null;
  createdBy: AdminRole;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: number;
  name: string;
  roleTitle: string;
  phone: string;
  active: number;
  hiredDate: string;
  createdAt: string;
}

export interface CommissionCycle {
  id: number;
  startDate: string;
  endDate: string;
  confirmedDepositsTotal: number;
  commissionRate: number;
  eligibleEmployeesCount: number;
  perEmployeeAmount: number;
  totalCommissionsAmount: number;
  companyRemainingAmount: number;
  closedBy: AdminRole;
  closedAt: string;
  notes: string;
}

export interface CommissionPayment {
  id: number;
  employeeId: number;
  employeeName: string;
  cycleId: number | null;
  paymentDate: string;
  amount: number;
  source: PaymentSource;
  notes: string;
  status: RecordStatus;
  voidReason: string | null;
  createdBy: AdminRole;
  createdAt: string;
}

export interface DailyClosing {
  id: number;
  closingDate: string;
  areaBreakdownJson: string;
  totalSales: number;
  totalExpenses: number;
  netAfterExpenses: number;
  totalDeposited: number;
  expectedCash: number;
  countedCash: number;
  differenceAmount: number;
  notes: string;
  closedBy: AdminRole;
  closedAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
}

export interface RecentMovement {
  uid: string;
  type: 'venda' | 'despesa' | 'deposito' | 'comissao';
  date: string;
  title: string;
  subtitle: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface DashboardResponse {
  period: {
    startDate: string;
    endDate: string;
    today: string;
  };
  kpis: {
    periodSales: number;
    periodExpenses: number;
    periodNet: number;
    periodConfirmedDeposits: number;
    periodPendingDeposits: number;
    weekSales: number;
    fourWeeksSales: number;
    accumulatedSales: number;
    accumulatedExpenses: number;
    accumulatedNet: number;
    accumulatedConfirmedDeposits: number;
    accumulatedPendingDeposits: number;
    accumulatedCommissionsTotal: number;
    accumulatedCommissionsPaid: number;
    accumulatedCommissionsPending: number;
    companySavedMoney: number;
    undepositedCash: number;
    bankBalance: number;
    commissionRate: number;
    eligibleEmployeesCount: number;
  };
  charts: {
    salesByArea: { areaId: number; areaName: string; total: number }[];
    dailyEvolution: { date: string; sales: number; expenses: number; deposits: number }[];
    weeklyEvolution: { weekLabel: string; startDate: string; endDate: string; sales: number; expenses: number; deposits: number }[];
  };
  recentMovements: RecentMovement[];
  alerts: {
    daysWithoutSales: string[];
    closingDiscrepancies: { date: string; difference: number }[];
    negativeCashAlert: boolean;
    pendingDepositsCount: number;
    pendingDepositsAmount: number;
  };
}
