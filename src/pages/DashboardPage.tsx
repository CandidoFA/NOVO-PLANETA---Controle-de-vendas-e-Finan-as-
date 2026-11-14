import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Landmark, PlusCircle, RefreshCw } from 'lucide-react';
import { EvolutionBarChart, formatShortDayLabel, SalesByAreaChart } from '../components/Charts';
import { DashboardResponse } from '../types/finance';
import { apiFetch } from '../utils/api';
import { addDaysISO, formatDatePT, formatKz, getTodayISO } from '../utils/format';

type DatePreset = 'hoje' | 'ontem' | '7dias' | '4semanas' | 'personalizado';

interface DashboardPageProps {
  onNavigate: (tab: string) => void;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const today = getTodayISO();
  const [preset, setPreset] = useState<DatePreset>('hoje');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function applyPreset(nextPreset: DatePreset) {
    setPreset(nextPreset);
    const t = getTodayISO();
    if (nextPreset === 'hoje') {
      setStartDate(t);
      setEndDate(t);
    } else if (nextPreset === 'ontem') {
      const y = addDaysISO(t, -1);
      setStartDate(y);
      setEndDate(y);
    } else if (nextPreset === '7dias') {
      setStartDate(addDaysISO(t, -6));
      setEndDate(t);
    } else if (nextPreset === '4semanas') {
      setStartDate(addDaysISO(t, -27));
      setEndDate(t);
    }
  }

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<DashboardResponse>(
        `/api/dashboard?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar indicadores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, [startDate, endDate]);

  const periodLabel =
    startDate === endDate
      ? formatDatePT(startDate)
      : `${formatDatePT(startDate)} a ${formatDatePT(endDate)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Painel Financeiro
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Período em análise: <span className="font-mono tabular-nums text-slate-700">{periodLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['hoje', 'Hoje'],
                ['ontem', 'Ontem'],
                ['7dias', 'Últimos 7 dias'],
                ['4semanas', 'Últimas 4 semanas'],
                ['personalizado', 'Personalizado'],
              ] as [DatePreset, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  preset === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={loadDashboard}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>

          <button
            type="button"
            onClick={() => onNavigate('vendas')}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 whitespace-nowrap"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Registar Venda
          </button>
        </div>
      </div>

      {preset === 'personalizado' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-4">
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
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {data &&
        (data.alerts.negativeCashAlert ||
          data.alerts.daysWithoutSales.length > 0 ||
          data.alerts.closingDiscrepancies.length > 0 ||
          data.alerts.pendingDepositsCount > 0) && (
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
              <span>Alertas financeiros e operacionais</span>
            </div>
            <ul className="text-xs text-amber-900 space-y-1 pl-6 list-disc">
              {data.alerts.negativeCashAlert && (
                <li>
                  Atenção: O total de depósitos confirmados e saídas ultrapassa o saldo líquido em caixa (
                  <span className="font-mono font-semibold">{formatKz(data.kpis.undepositedCash)}</span>).
                  Verifique os registos de vendas, despesas ou depósitos.
                </li>
              )}
              {data.alerts.daysWithoutSales.length > 0 && (
                <li>
                  Dias sem registo de vendas nos últimos 7 dias:{' '}
                  <span className="font-mono">
                    {data.alerts.daysWithoutSales.map(formatDatePT).join(' · ')}
                  </span>
                </li>
              )}
              {data.alerts.closingDiscrepancies.length > 0 && (
                <li>
                  Diferenças detetadas em fechos diários recentes:{' '}
                  <span className="font-mono">
                    {data.alerts.closingDiscrepancies
                      .map((d) => `${formatDatePT(d.date)} (${formatKz(d.difference)})`)
                      .join(' · ')}
                  </span>
                </li>
              )}
              {data.alerts.pendingDepositsCount > 0 && (
                <li>
                  Existem {data.alerts.pendingDepositsCount} depósito(s) pendente(s) de confirmação no valor total de{' '}
                  <span className="font-mono font-semibold">{formatKz(data.alerts.pendingDepositsAmount)}</span>.
                </li>
              )}
            </ul>
          </div>
        )}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, idx) => (
            <div key={idx} className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* 9 Quantitative KPIs + Recent Movements (#10) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <KpiCard
              title="1. Total de vendas do período"
              value={formatKz(data.kpis.periodSales)}
              meta={`Período: ${periodLabel}`}
              tone="teal"
            />
            <KpiCard
              title="2. Total de despesas do período"
              value={formatKz(data.kpis.periodExpenses)}
              meta={`Período: ${periodLabel}`}
              tone="red"
            />
            <KpiCard
              title="3. Total líquido disponível (período)"
              value={formatKz(data.kpis.periodNet)}
              meta={`Acumulado global: ${formatKz(data.kpis.accumulatedNet)}`}
              tone={data.kpis.periodNet >= 0 ? 'slate' : 'red'}
            />
            <KpiCard
              title="4. Depósitos realizados"
              value={formatKz(data.kpis.accumulatedConfirmedDeposits)}
              meta={`No período: ${formatKz(data.kpis.periodConfirmedDeposits)}`}
              tone="slate"
            />
            <KpiCard
              title={`5. Comissões acumuladas (${data.kpis.commissionRate}% × ${data.kpis.eligibleEmployeesCount})`}
              value={formatKz(data.kpis.accumulatedCommissionsTotal)}
              meta={`Pagas: ${formatKz(data.kpis.accumulatedCommissionsPaid)} · Pendentes: ${formatKz(data.kpis.accumulatedCommissionsPending)}`}
              tone="amber"
            />
            <KpiCard
              title="6. Dinheiro guardado pela empresa"
              value={formatKz(data.kpis.companySavedMoney)}
              meta={`Líquido acumulado menos comissões`}
              tone="teal"
            />
            <KpiCard
              title="7. Vendas da semana (7 dias)"
              value={formatKz(data.kpis.weekSales)}
              meta={`Últimos 7 dias até ${formatDatePT(data.period.today)}`}
              tone="slate"
            />
            <KpiCard
              title="8. Vendas das 4 semanas (28 dias)"
              value={formatKz(data.kpis.fourWeeksSales)}
              meta={`Últimos 28 dias até ${formatDatePT(data.period.today)}`}
              tone="slate"
            />
            <KpiCard
              title="9. Saldo ainda não depositado (Caixa)"
              value={formatKz(data.kpis.undepositedCash)}
              meta={`Saldo no Banco: ${formatKz(data.kpis.bankBalance)}`}
              tone={data.kpis.undepositedCash < 0 ? 'red' : 'slate'}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Vendas por área</h3>
                <p className="text-xs text-slate-500 mt-0.5">{periodLabel}</p>
              </div>
              <SalesByAreaChart data={data.charts.salesByArea} />
            </div>

            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Evolução diária</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Comparação entre vendas, despesas e depósitos confirmados
                </p>
              </div>
              <EvolutionBarChart
                items={data.charts.dailyEvolution.map((d) => ({
                  label: d.date,
                  sales: d.sales,
                  expenses: d.expenses,
                  deposits: d.deposits,
                }))}
                formatLabel={formatShortDayLabel}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Evolução semanal (4 semanas)</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Blocos de 7 dias até {formatDatePT(data.period.today)}
                </p>
              </div>
              <EvolutionBarChart
                items={data.charts.weeklyEvolution.map((w) => ({
                  label: w.weekLabel,
                  sales: w.sales,
                  expenses: w.expenses,
                  deposits: w.deposits,
                }))}
              />
            </div>

            {/* 10. Últimos movimentos financeiros */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    10. Últimos movimentos financeiros
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Registos mais recentes de vendas, despesas, depósitos e comissões
                  </p>
                </div>
              </div>

              {data.recentMovements.length === 0 ? (
                <div className="py-10 text-center space-y-3">
                  <p className="text-sm text-slate-500">
                    Ainda não existem movimentos financeiros registados.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('vendas')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800"
                  >
                    Registar primeira venda
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.recentMovements.map((mov) => {
                    const isVoided = mov.status === 'anulado';
                    return (
                      <div
                        key={mov.uid}
                        className={`py-2.5 flex items-center justify-between gap-3 ${
                          isVoided ? 'opacity-50 line-through' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                            {mov.type === 'venda' && <ArrowUpRight className="h-4 w-4 text-teal-700" />}
                            {mov.type === 'despesa' && <ArrowDownRight className="h-4 w-4 text-red-600" />}
                            {mov.type === 'deposito' && <Landmark className="h-4 w-4 text-slate-700" />}
                            {mov.type === 'comissao' && <ArrowDownRight className="h-4 w-4 text-amber-700" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{mov.title}</p>
                            <p className="text-xs text-slate-500 truncate">
                              <span className="font-mono tabular-nums">{formatDatePT(mov.date)}</span>
                              <span aria-hidden="true"> · </span>
                              <span>{mov.subtitle}</span>
                              {mov.status !== 'ativo' && mov.status !== 'realizado' && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span className="text-amber-700 font-medium">{mov.status}</span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`font-mono tabular-nums text-sm font-semibold shrink-0 ${
                            mov.type === 'venda'
                              ? 'text-teal-700'
                              : mov.type === 'deposito'
                                ? 'text-slate-900'
                                : 'text-red-600'
                          }`}
                        >
                          {mov.type === 'venda' ? '+' : mov.type === 'deposito' ? '' : '-'}
                          {formatKz(mov.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  title,
  value,
  meta,
  tone,
}: {
  title: string;
  value: string;
  meta: string;
  tone: 'teal' | 'red' | 'amber' | 'slate';
}) {
  const valueColor =
    tone === 'teal'
      ? 'text-teal-700'
      : tone === 'red'
        ? 'text-red-600'
        : tone === 'amber'
          ? 'text-amber-700'
          : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-2">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className={`text-2xl font-bold font-mono tabular-nums tracking-tight ${valueColor}`}>
        {value}
      </p>
      <p className="text-xs text-slate-500 font-mono tabular-nums truncate">{meta}</p>
    </div>
  );
}
