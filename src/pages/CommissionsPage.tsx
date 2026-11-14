import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Edit3, Lock, Plus, Trash2, UserCheck, UserX, Wallet, X } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CommissionCycle, CommissionPayment, Employee } from '../types/finance';
import { apiFetch } from '../utils/api';
import { formatDatePT, formatKz, getTodayISO } from '../utils/format';

interface EmployeeBalance extends Employee {
  periodCommission: number;
  totalEarnedEstimate: number;
  totalPaid: number;
  pendingEstimate: number;
}

interface CommissionsOverview {
  commissionRate: number;
  currentPeriod: {
    startDate: string;
    endDate: string;
    confirmedDepositsTotal: number;
    eligibleEmployeesCount: number;
    perEmployeeAmount: number;
    totalCommissionsAmount: number;
    companyRemainingAmount: number;
  };
  globalState: {
    accumulatedCommissionsTotal: number;
    accumulatedCommissionsPaid: number;
    accumulatedCommissionsPending: number;
  };
  employeeBalances: EmployeeBalance[];
  cycles: CommissionCycle[];
  payments: CommissionPayment[];
}

export function CommissionsPage() {
  const today = getTodayISO();
  const [data, setData] = useState<CommissionsOverview | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Employee form modal
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('Funcionário');
  const [empPhone, setEmpPhone] = useState('');
  const [empHiredDate, setEmpHiredDate] = useState(today);

  // Payment form modal
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payEmpId, setPayEmpId] = useState<number | ''>('');
  const [payCycleId, setPayCycleId] = useState<number | ''>('');
  const [payDate, setPayDate] = useState(today);
  const [payAmount, setPayAmount] = useState('');
  const [paySource, setPaySource] = useState<'banco' | 'caixa'>('banco');
  const [payNotes, setPayNotes] = useState('');

  // Close cycle confirm
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');
  const [voidPaymentTarget, setVoidPaymentTarget] = useState<CommissionPayment | null>(null);

  async function loadOverview(customStart?: string, customEnd?: string) {
    const params = new URLSearchParams();
    if (customStart && customEnd) {
      params.set('startDate', customStart);
      params.set('endDate', customEnd);
    }
    const res = await apiFetch<CommissionsOverview>(`/api/commissions/overview?${params.toString()}`);
    setData(res);
    if (!customStart) setStartDate(res.currentPeriod.startDate);
    if (!customEnd) setEndDate(res.currentPeriod.endDate);
  }

  useEffect(() => {
    loadOverview();
  }, []);

  async function handleSaveEmployee(e: FormEvent) {
    e.preventDefault();
    if (!empName.trim()) return;
    if (editingEmp) {
      await apiFetch(`/api/employees/${editingEmp.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: empName.trim(),
          roleTitle: empRole.trim(),
          phone: empPhone.trim(),
          hiredDate: empHiredDate,
        }),
      });
    } else {
      await apiFetch('/api/employees', {
        method: 'POST',
        body: JSON.stringify({
          name: empName.trim(),
          roleTitle: empRole.trim(),
          phone: empPhone.trim(),
          hiredDate: empHiredDate,
        }),
      });
    }
    setEmpModalOpen(false);
    setEditingEmp(null);
    setEmpName('');
    setEmpPhone('');
    await loadOverview(startDate, endDate);
  }

  async function handleToggleEmployee(emp: Employee) {
    await apiFetch(`/api/employees/${emp.id}/toggle`, { method: 'PATCH' });
    await loadOverview(startDate, endDate);
  }

  async function handleCloseCycle() {
    if (!data) return;
    setFeedback(null);
    try {
      await apiFetch('/api/commissions/close-cycle', {
        method: 'POST',
        body: JSON.stringify({
          startDate: data.currentPeriod.startDate,
          endDate: data.currentPeriod.endDate,
          notes: closeNotes,
        }),
      });
      setCloseConfirmOpen(false);
      setCloseNotes('');
      setFeedback({ type: 'ok', text: 'Ciclo de 4 semanas encerrado e registado com sucesso.' });
      await loadOverview();
    } catch (err) {
      setCloseConfirmOpen(false);
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao encerrar ciclo.' });
    }
  }

  async function handleRegisterPayment(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const val = Number(payAmount);
    if (!payEmpId || !Number.isFinite(val) || val <= 0) {
      setFeedback({ type: 'err', text: 'Selecione o funcionário e indique um valor válido.' });
      return;
    }
    await apiFetch('/api/commissions/payments', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: Number(payEmpId),
        cycleId: payCycleId ? Number(payCycleId) : null,
        paymentDate: payDate,
        amount: val,
        source: paySource,
        notes: payNotes,
      }),
    });
    setPayModalOpen(false);
    setPayAmount('');
    setPayNotes('');
    setFeedback({ type: 'ok', text: `Pagamento de comissão (${formatKz(val)}) registado.` });
    await loadOverview(startDate, endDate);
  }

  async function handleVoidPayment(reason?: string) {
    if (!voidPaymentTarget) return;
    await apiFetch(`/api/commissions/payments/${voidPaymentTarget.id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    setVoidPaymentTarget(null);
    await loadOverview(startDate, endDate);
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Comissões dos Funcionários ({data.commissionRate}% Individuais)
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Cada funcionário elegível recebe {data.commissionRate}% individuais sobre os depósitos
            confirmados no período de 4 semanas (28 dias).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingEmp(null);
              setEmpName('');
              setEmpRole('Funcionário');
              setEmpPhone('');
              setEmpHiredDate(today);
              setEmpModalOpen(true);
            }}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Novo Funcionário
          </button>

          <button
            type="button"
            onClick={() => {
              const firstActive = data.employeeBalances.find((e) => e.active === 1);
              setPayEmpId(firstActive ? firstActive.id : '');
              setPayAmount(
                firstActive && firstActive.pendingEstimate > 0
                  ? String(firstActive.pendingEstimate)
                  : ''
              );
              setPayModalOpen(true);
            }}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 whitespace-nowrap"
          >
            <Wallet className="h-4 w-4" />
            Registar Pagamento
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl px-4 py-3 text-xs font-medium border ${
            feedback.type === 'ok'
              ? 'bg-teal-50 text-teal-800 border-teal-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 4-week Period Calculator */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Apuramento do Período (4 Semanas / 28 Dias)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Apenas depósitos com estado realizado são contabilizados.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Início</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="min-h-[38px] rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Fim</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="min-h-[38px] rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-mono tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={() => loadOverview(startDate, endDate)}
              className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold hover:bg-slate-200 whitespace-nowrap"
            >
              Calcular Período
            </button>
            <button
              type="button"
              onClick={() => setCloseConfirmOpen(true)}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
            >
              <Lock className="h-3.5 w-3.5" />
              Encerrar Período
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80">
            <p className="text-xs text-slate-500">Depósitos confirmados</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900">
              {formatKz(data.currentPeriod.confirmedDepositsTotal)}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80">
            <p className="text-xs text-slate-500">Funcionários elegíveis</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900">
              {data.currentPeriod.eligibleEmployeesCount}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80">
            <p className="text-xs text-slate-500">Comissão individual ({data.commissionRate}%)</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-teal-700">
              {formatKz(data.currentPeriod.perEmployeeAmount)}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80">
            <p className="text-xs text-slate-500">Total geral comissões</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-700">
              {formatKz(data.currentPeriod.totalCommissionsAmount)}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80">
            <p className="text-xs text-slate-500">Restante para a empresa</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900">
              {formatKz(data.currentPeriod.companyRemainingAmount)}
            </p>
          </div>
        </div>
      </div>

      {/* Employees Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Equipa e Saldo de Comissões</h3>
            <p className="text-xs text-slate-500">
              Acumulado global: {formatKz(data.globalState.accumulatedCommissionsTotal)} · Pago:{' '}
              {formatKz(data.globalState.accumulatedCommissionsPaid)} · Pendente:{' '}
              {formatKz(data.globalState.accumulatedCommissionsPending)}
            </p>
          </div>
        </div>

        {data.employeeBalances.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-slate-500">
              Ainda não existem funcionários cadastrados para cálculo de comissões.
            </p>
            <button
              type="button"
              onClick={() => setEmpModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold"
            >
              Cadastrar Primeiro Funcionário
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-3">Funcionário</th>
                  <th className="py-2.5 px-3">Função / Estado</th>
                  <th className="py-2.5 px-3 text-right">Neste período</th>
                  <th className="py-2.5 px-3 text-right">Total apurado</th>
                  <th className="py-2.5 px-3 text-right">Total pago</th>
                  <th className="py-2.5 px-3 text-right">Pendente</th>
                  <th className="py-2.5 pl-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.employeeBalances.map((emp) => (
                  <tr key={emp.id} className={`hover:bg-slate-50/70 ${emp.active === 0 ? 'opacity-60' : ''}`}>
                    <td className="py-3 pr-3 font-medium text-slate-900">
                      {emp.name}
                      {emp.phone && <span className="block text-xs text-slate-500 font-mono">{emp.phone}</span>}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600">
                      {emp.roleTitle} ·{' '}
                      <span className={emp.active === 1 ? 'text-teal-700 font-medium' : 'text-red-600'}>
                        {emp.active === 1 ? 'Ativo' : 'Desativado'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                      {formatKz(emp.periodCommission)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatKz(emp.totalEarnedEstimate)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-teal-700">
                      {formatKz(emp.totalPaid)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-amber-700">
                      {formatKz(emp.pendingEstimate)}
                    </td>
                    <td className="py-3 pl-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setPayEmpId(emp.id);
                            setPayAmount(emp.pendingEstimate > 0 ? String(emp.pendingEstimate) : '');
                            setPayModalOpen(true);
                          }}
                          className="p-1.5 text-teal-700 hover:bg-teal-50 rounded"
                          title="Pagar comissão"
                        >
                          <Wallet className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingEmp(emp);
                            setEmpName(emp.name);
                            setEmpRole(emp.roleTitle);
                            setEmpPhone(emp.phone);
                            setEmpHiredDate(emp.hiredDate);
                            setEmpModalOpen(true);
                          }}
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
                          title="Editar funcionário"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleEmployee(emp)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
                          title={emp.active === 1 ? 'Desativar funcionário' : 'Reativar funcionário'}
                        >
                          {emp.active === 1 ? (
                            <UserX className="h-4 w-4" />
                          ) : (
                            <UserCheck className="h-4 w-4 text-teal-700" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed Cycles & Payments History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-base font-semibold text-slate-900">Ciclos de 4 Semanas Encerrados</h3>
          {data.cycles.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              Ainda não foi encerrado nenhum ciclo de 4 semanas.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.cycles.map((c) => (
                <div key={c.id} className="py-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between font-medium text-slate-900">
                    <span className="font-mono tabular-nums">
                      {formatDatePT(c.startDate)} a {formatDatePT(c.endDate)}
                    </span>
                    <span className="font-mono tabular-nums text-teal-700 font-semibold">
                      {formatKz(c.totalCommissionsAmount)}
                    </span>
                  </div>
                  <p className="text-slate-500 font-mono tabular-nums">
                    Depósitos: {formatKz(c.confirmedDepositsTotal)} · {c.eligibleEmployeesCount} func. ×{' '}
                    {formatKz(c.perEmployeeAmount)} ({c.commissionRate}%) · Empresa:{' '}
                    {formatKz(c.companyRemainingAmount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-base font-semibold text-slate-900">Pagamentos de Comissões</h3>
          {data.payments.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              Nenhum pagamento de comissão registado.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.payments.map((p) => {
                const isVoid = p.status === 'anulado';
                return (
                  <div
                    key={p.id}
                    className={`py-3 flex items-center justify-between gap-3 text-xs ${
                      isVoid ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className={`font-medium text-slate-900 ${isVoid ? 'line-through' : ''}`}>
                        {p.employeeName}
                      </p>
                      <p className="text-slate-500 font-mono tabular-nums">
                        {formatDatePT(p.paymentDate)} · Via {p.source === 'banco' ? 'Banco' : 'Caixa'}
                        {p.notes ? ` · ${p.notes}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {formatKz(p.amount)}
                      </span>
                      {!isVoid && (
                        <button
                          type="button"
                          onClick={() => setVoidPaymentTarget(p)}
                          className="p-1 text-slate-400 hover:text-red-600"
                          title="Anular pagamento"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Employee Modal */}
      {empModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleSaveEmployee}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingEmp ? 'Editar Funcionário' : 'Cadastrar Funcionário'}
              </h3>
              <button
                type="button"
                onClick={() => setEmpModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nome completo *</label>
              <input
                type="text"
                required
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Função / Área</label>
              <input
                type="text"
                value={empRole}
                onChange={(e) => setEmpRole(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Telefone</label>
              <input
                type="text"
                value={empPhone}
                onChange={(e) => setEmpPhone(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Data de entrada</label>
              <input
                type="date"
                value={empHiredDate}
                onChange={(e) => setEmpHiredDate(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEmpModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Payment Modal */}
      {payModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleRegisterPayment}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Registar Pagamento de Comissão</h3>
              <button
                type="button"
                onClick={() => setPayModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Funcionário *</label>
              <select
                required
                value={payEmpId}
                onChange={(e) => setPayEmpId(Number(e.target.value))}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Selecione...</option>
                {data.employeeBalances.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} (Pendente: {formatKz(e.pendingEstimate)})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Data</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Valor (Kz) *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Origem do dinheiro</label>
              <select
                value={paySource}
                onChange={(e) => setPaySource(e.target.value as 'banco' | 'caixa')}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="banco">Conta Bancária (Depósitos)</option>
                <option value="caixa">Caixa (Dinheiro em mão)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ciclo associado <span className="text-slate-400">(opcional)</span>
              </label>
              <select
                value={payCycleId}
                onChange={(e) => setPayCycleId(e.target.value ? Number(e.target.value) : '')}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Pagamento geral / em aberto</option>
                {data.cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatDatePT(c.startDate)} a {formatDatePT(c.endDate)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Observação</label>
              <input
                type="text"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirmar Pagamento
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Close Cycle Confirm Dialog */}
      {closeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Encerrar Período de 4 Semanas</h3>
            <p className="text-sm text-slate-600">
              Período de{' '}
              <strong className="font-mono">
                {formatDatePT(data.currentPeriod.startDate)} a {formatDatePT(data.currentPeriod.endDate)}
              </strong>
              : {formatKz(data.currentPeriod.confirmedDepositsTotal)} em depósitos confirmados ·{' '}
              {data.currentPeriod.eligibleEmployeesCount} funcionários ×{' '}
              {formatKz(data.currentPeriod.perEmployeeAmount)} ={' '}
              <strong>{formatKz(data.currentPeriod.totalCommissionsAmount)}</strong>.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Notas do encerramento</label>
              <input
                type="text"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="Observação opcional..."
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCloseCycle}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                Confirmar Encerramento
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(voidPaymentTarget)}
        title="Anular pagamento de comissão"
        description={
          voidPaymentTarget
            ? `Confirma a anulação do pagamento de ${formatKz(voidPaymentTarget.amount)} a ${
                voidPaymentTarget.employeeName
              }?`
            : ''
        }
        confirmLabel="Confirmar Anulação"
        requireReason
        onConfirm={handleVoidPayment}
        onCancel={() => setVoidPaymentTarget(null)}
      />
    </div>
  );
}
