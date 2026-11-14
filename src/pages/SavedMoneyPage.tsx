import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { DashboardResponse } from '../types/finance';
import { apiFetch } from '../utils/api';
import { formatKz, getTodayISO } from '../utils/format';

export function SavedMoneyPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    try {
      const today = getTodayISO();
      const res = await apiFetch<DashboardResponse>(
        `/api/dashboard?startDate=${today}&endDate=${today}`
      );
      setData(res);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading && !data) {
    return <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />;
  }

  if (!data) return null;

  const k = data.kpis;
  const physicalPlusBank = k.undepositedCash + k.bankBalance;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Dinheiro Guardado</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Reconciliação completa do capital da empresa após despesas, depósitos e comissões.
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
          className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Recalcular
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Total líquido acumulado (Vendas − Despesas)</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatKz(k.accumulatedNet)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Vendas: {formatKz(k.accumulatedSales)} · Despesas: {formatKz(k.accumulatedExpenses)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Comissões reservadas (Total apurado)</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-amber-700">
            {formatKz(k.accumulatedCommissionsTotal)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {k.commissionRate}% × {k.eligibleEmployeesCount} funcionários sobre depósitos confirmados
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Total de comissões pagas</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatKz(k.accumulatedCommissionsPaid)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Por pagar: {formatKz(k.accumulatedCommissionsPending)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Saldo existente em caixa (não depositado)</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatKz(k.undepositedCash)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Dinheiro físico por depositar</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Saldo depositado (Banco)</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatKz(k.bankBalance)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Depósitos pendentes (não incluídos): {formatKz(k.accumulatedPendingDeposits)}
          </p>
        </div>

        <div className="bg-teal-900 text-white border border-teal-900 rounded-xl p-5">
          <p className="text-xs text-teal-200">Total disponível para a empresa (Dinheiro Guardado)</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums">
            {formatKz(k.companySavedMoney)}
          </p>
          <p className="mt-1 text-xs text-teal-200">
            Livre de despesas e obrigações de comissões
          </p>
        </div>
      </div>

      {/* Reconciliation Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-teal-700" />
          <h3 className="text-base font-semibold text-slate-900">
            Prova de Reconciliação Financeira (Sem Duplicação)
          </h3>
        </div>

        <div className="divide-y divide-slate-100 text-sm">
          <div className="py-2.5 flex justify-between">
            <span className="text-slate-600">(+) Total de vendas acumuladas</span>
            <span className="font-mono tabular-nums font-medium text-slate-900">
              {formatKz(k.accumulatedSales)}
            </span>
          </div>
          <div className="py-2.5 flex justify-between">
            <span className="text-slate-600">(−) Total de despesas acumuladas</span>
            <span className="font-mono tabular-nums font-medium text-red-600">
              -{formatKz(k.accumulatedExpenses)}
            </span>
          </div>
          <div className="py-2.5 flex justify-between font-semibold bg-slate-50 px-3 rounded">
            <span className="text-slate-900">(=) Total líquido acumulado</span>
            <span className="font-mono tabular-nums text-slate-900">{formatKz(k.accumulatedNet)}</span>
          </div>
          <div className="py-2.5 flex justify-between">
            <span className="text-slate-600">(−) Comissões pagas (Caixa + Banco)</span>
            <span className="font-mono tabular-nums font-medium text-red-600">
              -{formatKz(k.accumulatedCommissionsPaid)}
            </span>
          </div>
          <div className="py-2.5 flex justify-between font-semibold bg-slate-50 px-3 rounded">
            <span className="text-slate-900">(=) Dinheiro físico e bancário existente (Caixa + Banco)</span>
            <span className="font-mono tabular-nums text-slate-900">{formatKz(physicalPlusBank)}</span>
          </div>
          <div className="py-2.5 flex justify-between">
            <span className="text-slate-600">(−) Comissões ainda por pagar (reservadas)</span>
            <span className="font-mono tabular-nums font-medium text-amber-700">
              -{formatKz(k.accumulatedCommissionsPending)}
            </span>
          </div>
          <div className="py-3 flex justify-between font-bold text-base">
            <span className="text-teal-800">(=) Total real guardado pela empresa</span>
            <span className="font-mono tabular-nums text-teal-700">
              {formatKz(k.companySavedMoney)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
