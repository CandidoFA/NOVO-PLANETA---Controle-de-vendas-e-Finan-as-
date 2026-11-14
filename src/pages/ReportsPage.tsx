import { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import {
  DashboardResponse,
  DepositRecord,
  ExpenseRecord,
  SaleRecord,
} from '../types/finance';
import { apiFetch } from '../utils/api';
import { exportReportExcel, exportReportPDF, ReportExportPayload } from '../utils/exportReports';
import { addDaysISO, formatDatePT, formatKz, getMonthEndISO, getMonthStartISO, getTodayISO } from '../utils/format';

type ReportType =
  | 'diario'
  | 'semanal'
  | 'quatro_semanas'
  | 'mensal'
  | 'anual'
  | 'por_area'
  | 'por_servico'
  | 'despesas'
  | 'depositos'
  | 'comissoes'
  | 'dinheiro_guardado';

const REPORT_TYPES: { id: ReportType; label: string }[] = [
  { id: 'diario', label: 'Relatório Diário' },
  { id: 'semanal', label: 'Relatório Semanal' },
  { id: 'quatro_semanas', label: 'Relatório de 4 Semanas' },
  { id: 'mensal', label: 'Relatório Mensal' },
  { id: 'anual', label: 'Relatório Anual' },
  { id: 'por_area', label: 'Vendas por Área' },
  { id: 'por_servico', label: 'Vendas por Serviço' },
  { id: 'despesas', label: 'Relatório de Despesas' },
  { id: 'depositos', label: 'Relatório de Depósitos' },
  { id: 'comissoes', label: 'Relatório de Comissões' },
  { id: 'dinheiro_guardado', label: 'Dinheiro Guardado' },
];

export function ReportsPage() {
  const today = getTodayISO();
  const [reportType, setReportType] = useState<ReportType>('diario');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<ReportExportPayload | null>(null);

  function selectReportType(type: ReportType) {
    setReportType(type);
    const now = new Date();
    const t = getTodayISO();
    if (type === 'diario') {
      setStartDate(t);
      setEndDate(t);
    } else if (type === 'semanal') {
      setStartDate(addDaysISO(t, -6));
      setEndDate(t);
    } else if (type === 'quatro_semanas') {
      setStartDate(addDaysISO(t, -27));
      setEndDate(t);
    } else if (type === 'mensal') {
      setStartDate(getMonthStartISO(now.getFullYear(), now.getMonth()));
      setEndDate(getMonthEndISO(now.getFullYear(), now.getMonth()));
    } else if (type === 'anual') {
      setStartDate(`${now.getFullYear()}-01-01`);
      setEndDate(`${now.getFullYear()}-12-31`);
    }
  }

  async function buildReport() {
    setLoading(true);
    try {
      const periodLabel = `${formatDatePT(startDate)} a ${formatDatePT(endDate)}`;
      const qs = `startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;

      if (['diario', 'semanal', 'quatro_semanas', 'mensal', 'anual'].includes(reportType)) {
        const [dash, sales, expenses] = await Promise.all([
          apiFetch<DashboardResponse>(`/api/dashboard?${qs}`),
          apiFetch<SaleRecord[]>(`/api/sales?${qs}`),
          apiFetch<ExpenseRecord[]>(`/api/expenses?${qs}`),
        ]);
        const title = REPORT_TYPES.find((r) => r.id === reportType)?.label || 'Relatório Financeiro';
        setPayload({
          title,
          subtitle: 'Resumo financeiro e movimentos de vendas',
          periodLabel,
          fileNameBase: `novo-planeta-${reportType}-${startDate}`,
          summaryRows: [
            { label: 'Total de vendas', value: formatKz(dash.kpis.periodSales) },
            { label: 'Total de despesas', value: formatKz(dash.kpis.periodExpenses) },
            { label: 'Líquido do período', value: formatKz(dash.kpis.periodNet) },
            { label: 'Depósitos realizados no período', value: formatKz(dash.kpis.periodConfirmedDeposits) },
            { label: 'N.º de vendas / despesas', value: `${sales.length} vendas · ${expenses.length} despesas` },
          ],
          columns: ['Data', 'Tipo', 'Área / Categoria', 'Descrição / Serviço', 'Valor (Kz)'],
          rows: [
            ...sales.map((s) => [
              formatDatePT(s.saleDate),
              'Venda',
              s.areaName,
              s.serviceName,
              formatKz(s.totalAmount),
            ]),
            ...expenses.map((e) => [
              formatDatePT(e.expenseDate),
              'Despesa',
              e.categoryName,
              e.description,
              `-${formatKz(e.amount)}`,
            ]),
          ],
        });
      } else if (reportType === 'por_area') {
        const dash = await apiFetch<DashboardResponse>(`/api/dashboard?${qs}`);
        const total = dash.charts.salesByArea.reduce((s, a) => s + a.total, 0);
        setPayload({
          title: 'Relatório de Vendas por Área',
          subtitle: 'Distribuição de receitas por departamento',
          periodLabel,
          fileNameBase: `novo-planeta-vendas-area-${startDate}`,
          summaryRows: [{ label: 'Total de vendas no período', value: formatKz(total) }],
          columns: ['Área', 'Total Vendido', 'Peso (%)'],
          rows: dash.charts.salesByArea.map((a) => [
            a.areaName,
            formatKz(a.total),
            total > 0 ? `${Math.round((a.total / total) * 100)}%` : '0%',
          ]),
        });
      } else if (reportType === 'por_servico') {
        const sales = await apiFetch<SaleRecord[]>(`/api/sales?${qs}`);
        const map = new Map<string, { area: string; service: string; count: number; total: number }>();
        for (const s of sales) {
          const key = `${s.areaName}::${s.serviceName}`;
          const prev = map.get(key) || { area: s.areaName, service: s.serviceName, count: 0, total: 0 };
          prev.count += 1;
          prev.total += s.totalAmount;
          map.set(key, prev);
        }
        const grouped = Array.from(map.values()).sort((a, b) => b.total - a.total);
        const total = grouped.reduce((s, g) => s + g.total, 0);
        setPayload({
          title: 'Relatório de Vendas por Serviço',
          subtitle: 'Desempenho detalhado por serviço',
          periodLabel,
          fileNameBase: `novo-planeta-vendas-servico-${startDate}`,
          summaryRows: [
            { label: 'Serviços com movimento', value: String(grouped.length) },
            { label: 'Total faturado', value: formatKz(total) },
          ],
          columns: ['Área', 'Serviço', 'N.º Vendas', 'Total (Kz)'],
          rows: grouped.map((g) => [g.area, g.service, g.count, formatKz(g.total)]),
        });
      } else if (reportType === 'despesas') {
        const expenses = await apiFetch<ExpenseRecord[]>(`/api/expenses?${qs}`);
        const total = expenses.reduce((s, e) => s + e.amount, 0);
        setPayload({
          title: 'Relatório de Despesas',
          subtitle: 'Listagem discriminada de saídas operacionais',
          periodLabel,
          fileNameBase: `novo-planeta-despesas-${startDate}`,
          summaryRows: [
            { label: 'Quantidade de registos', value: String(expenses.length) },
            { label: 'Total de despesas', value: formatKz(total) },
          ],
          columns: ['Data', 'Categoria', 'Descrição', 'Área', 'Valor (Kz)'],
          rows: expenses.map((e) => [
            formatDatePT(e.expenseDate),
            e.categoryName,
            e.description,
            e.areaName || 'Geral',
            formatKz(e.amount),
          ]),
        });
      } else if (reportType === 'depositos') {
        const res = await apiFetch<{ deposits: DepositRecord[] }>(`/api/deposits?${qs}`);
        const confirmed = res.deposits
          .filter((d) => d.status === 'realizado')
          .reduce((s, d) => s + d.amount, 0);
        const pending = res.deposits
          .filter((d) => d.status === 'pendente')
          .reduce((s, d) => s + d.amount, 0);
        setPayload({
          title: 'Relatório de Depósitos Bancários',
          subtitle: 'Transferências de caixa para conta bancária',
          periodLabel,
          fileNameBase: `novo-planeta-depositos-${startDate}`,
          summaryRows: [
            { label: 'Depósitos realizados', value: formatKz(confirmed) },
            { label: 'Depósitos pendentes', value: formatKz(pending) },
          ],
          columns: ['Data', 'Banco', 'Referência', 'Estado', 'Valor (Kz)'],
          rows: res.deposits.map((d) => [
            formatDatePT(d.depositDate),
            d.bankName,
            d.referenceCode || '—',
            d.status,
            formatKz(d.amount),
          ]),
        });
      } else if (reportType === 'comissoes') {
        const comm = await apiFetch<{
          commissionRate: number;
          currentPeriod: {
            confirmedDepositsTotal: number;
            eligibleEmployeesCount: number;
            perEmployeeAmount: number;
            totalCommissionsAmount: number;
          };
          employeeBalances: {
            name: string;
            roleTitle: string;
            active: number;
            periodCommission: number;
            totalPaid: number;
            pendingEstimate: number;
          }[];
        }>(`/api/commissions/overview?${qs}`);
        setPayload({
          title: 'Relatório de Comissões dos Funcionários',
          subtitle: `Regra de ${comm.commissionRate}% individuais sobre depósitos confirmados`,
          periodLabel,
          fileNameBase: `novo-planeta-comissoes-${startDate}`,
          summaryRows: [
            { label: 'Depósitos confirmados no período', value: formatKz(comm.currentPeriod.confirmedDepositsTotal) },
            { label: 'Funcionários elegíveis', value: String(comm.currentPeriod.eligibleEmployeesCount) },
            { label: 'Comissão individual no período', value: formatKz(comm.currentPeriod.perEmployeeAmount) },
            { label: 'Total de comissões no período', value: formatKz(comm.currentPeriod.totalCommissionsAmount) },
          ],
          columns: ['Funcionário', 'Estado', 'Comissão Período', 'Total Pago', 'Pendente Estimado'],
          rows: comm.employeeBalances.map((e) => [
            e.name,
            e.active === 1 ? 'Ativo' : 'Desativado',
            formatKz(e.periodCommission),
            formatKz(e.totalPaid),
            formatKz(e.pendingEstimate),
          ]),
        });
      } else if (reportType === 'dinheiro_guardado') {
        const dash = await apiFetch<DashboardResponse>(`/api/dashboard?${qs}`);
        const k = dash.kpis;
        setPayload({
          title: 'Relatório de Dinheiro Guardado',
          subtitle: 'Reconciliação global do capital da empresa',
          periodLabel: `Posição acumulada até ${formatDatePT(endDate)}`,
          fileNameBase: `novo-planeta-dinheiro-guardado-${endDate}`,
          summaryRows: [
            { label: 'Total de vendas acumuladas', value: formatKz(k.accumulatedSales) },
            { label: 'Total de despesas acumuladas', value: formatKz(k.accumulatedExpenses) },
            { label: 'Total líquido acumulado', value: formatKz(k.accumulatedNet) },
            { label: 'Total disponível para a empresa', value: formatKz(k.companySavedMoney) },
          ],
          columns: ['Rubrica Financeira', 'Valor (Kz)'],
          rows: [
            ['Total líquido acumulado (Vendas − Despesas)', formatKz(k.accumulatedNet)],
            ['Saldo existente em caixa (não depositado)', formatKz(k.undepositedCash)],
            ['Saldo depositado no banco', formatKz(k.bankBalance)],
            ['Comissões reservadas (total apurado)', formatKz(k.accumulatedCommissionsTotal)],
            ['Comissões pagas', formatKz(k.accumulatedCommissionsPaid)],
            ['Comissões por pagar', formatKz(k.accumulatedCommissionsPending)],
            ['Total guardado disponível para a empresa', formatKz(k.companySavedMoney)],
          ],
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    buildReport();
  }, [reportType, startDate, endDate]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Relatórios e Histórico</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Consulte resultados filtrados por data e exporte diretamente em PDF ou Excel.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!payload}
            onClick={() => payload && exportReportPDF(payload)}
            className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <FileText className="h-4 w-4" />
            Exportar PDF
          </button>
          <button
            type="button"
            disabled={!payload}
            onClick={() => payload && exportReportExcel(payload)}
            className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Report Selector & Date Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt.id}
              type="button"
              onClick={() => selectReportType(rt.id)}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                reportType === rt.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {rt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Data inicial</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Data final</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Report Output */}
      {loading && !payload ? (
        <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />
      ) : payload ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-lg font-bold text-slate-900">{payload.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {payload.subtitle} · Período: <span className="font-mono">{payload.periodLabel}</span>
            </p>
          </div>

          {payload.summaryRows.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {payload.summaryRows.map((row) => (
                <div key={row.label} className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <p className="text-xs text-slate-500">{row.label}</p>
                  <p className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900">
                    {row.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  {payload.columns.map((col) => (
                    <th key={col} className="py-2.5 px-3 first:pl-0 last:pr-0">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payload.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={payload.columns.length}
                      className="py-10 text-center text-sm text-slate-500"
                    >
                      Sem registos para o período selecionado.
                    </td>
                  </tr>
                ) : (
                  payload.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      {r.map((cell, j) => (
                        <td
                          key={j}
                          className="py-2.5 px-3 first:pl-0 last:pr-0 font-mono tabular-nums text-xs sm:text-sm text-slate-800"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
