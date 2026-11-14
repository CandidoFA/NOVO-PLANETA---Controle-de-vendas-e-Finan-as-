import { FormEvent, useEffect, useState } from 'react';
import { Check, CheckCircle2, Edit3, Info, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DepositRecord } from '../types/finance';
import { apiFetch } from '../utils/api';
import { formatDatePT, formatKz, getTodayISO } from '../utils/format';

interface DepositsPayload {
  deposits: DepositRecord[];
  summary: {
    dailyTotal: number;
    weeklyTotal: number;
    fourWeeksTotal: number;
    pendingTotal: number;
  };
}

export function DepositsPage() {
  const today = getTodayISO();
  const [payload, setPayload] = useState<DepositsPayload | null>(null);
  const [includeVoided, setIncludeVoided] = useState(false);

  const [depositDate, setDepositDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [relatedPeriod, setRelatedPeriod] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'realizado' | 'pendente'>('realizado');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [editingDeposit, setEditingDeposit] = useState<DepositRecord | null>(null);
  const [voidTarget, setVoidTarget] = useState<DepositRecord | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);

  async function loadDeposits() {
    const res = await apiFetch<DepositsPayload>(
      `/api/deposits?includeVoided=${includeVoided ? 'true' : 'false'}`
    );
    setPayload(res);
  }

  useEffect(() => {
    loadDeposits();
  }, [includeVoided]);

  async function handleCreateDeposit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0 || !bankName.trim()) {
      setFeedback({ type: 'err', text: 'Indique o valor depositado e o banco.' });
      return;
    }

    setSaving(true);
    try {
      await apiFetch('/api/deposits', {
        method: 'POST',
        body: JSON.stringify({
          depositDate,
          amount: val,
          bankName: bankName.trim(),
          referenceCode: referenceCode.trim(),
          relatedPeriod: relatedPeriod.trim(),
          notes: notes.trim(),
          status,
        }),
      });
      setAmount('');
      setReferenceCode('');
      setRelatedPeriod('');
      setNotes('');
      setFeedback({
        type: 'ok',
        text: `Depósito de ${formatKz(val)} registado (${status}).`,
      });
      await loadDeposits();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao registar depósito.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmPending(dep: DepositRecord) {
    await apiFetch(`/api/deposits/${dep.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'realizado' }),
    });
    await loadDeposits();
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingDeposit) return;
    await apiFetch(`/api/deposits/${editingDeposit.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        depositDate: editingDeposit.depositDate,
        amount: Number(editingDeposit.amount),
        bankName: editingDeposit.bankName,
        referenceCode: editingDeposit.referenceCode,
        relatedPeriod: editingDeposit.relatedPeriod,
        notes: editingDeposit.notes,
        status: editingDeposit.status === 'pendente' ? 'pendente' : 'realizado',
      }),
    });
    setEditingDeposit(null);
    await loadDeposits();
  }

  async function handleVoid(reason?: string) {
    if (!voidTarget) return;
    setVoidLoading(true);
    try {
      await apiFetch(`/api/deposits/${voidTarget.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setVoidTarget(null);
      await loadDeposits();
    } finally {
      setVoidLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Depósitos Bancários</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Controlo de transferências de caixa para o banco. Base de cálculo das comissões.
        </p>
      </div>

      {/* Anti-duplication rule note */}
      <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-slate-700">
        <Info className="h-4 w-4 text-teal-700 shrink-0 mt-0.5" />
        <p>
          <strong>Nota contabilística:</strong> Um depósito bancário não representa nova receita; transfere
          dinheiro da caixa para a conta bancária. Apenas depósitos com estado{' '}
          <strong>realizado</strong> entram no cálculo das comissões e saldo bancário.
        </p>
      </div>

      {/* Totals Summary */}
      {payload && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Depositado hoje</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
              {formatKz(payload.summary.dailyTotal)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Depositado na semana (7 dias)</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
              {formatKz(payload.summary.weeklyTotal)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Depositado em 4 semanas (28 dias)</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-teal-700">
              {formatKz(payload.summary.fourWeeksTotal)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Pendentes de confirmação</p>
            <p className="mt-1 text-xl font-bold font-mono tabular-nums text-amber-700">
              {formatKz(payload.summary.pendingTotal)}
            </p>
          </div>
        </div>
      )}

      {/* New Deposit Form */}
      <form
        onSubmit={handleCreateDeposit}
        className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
      >
        <h3 className="text-base font-semibold text-slate-900">Registar Novo Depósito</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Data do depósito</label>
            <input
              type="date"
              required
              value={depositDate}
              onChange={(e) => setDepositDate(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Valor depositado (Kz) *</label>
            <input
              type="number"
              min="1"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ex: 250000"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums font-semibold"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Banco ou instituição financeira *
            </label>
            <input
              type="text"
              required
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Ex: BAI, BFA, BIC, Millennium..."
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Referência / N.º do comprovativo
            </label>
            <input
              type="text"
              value={referenceCode}
              onChange={(e) => setReferenceCode(e.target.value)}
              placeholder="Ex: COMP-2026-0041"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Período / Vendas relacionadas <span className="text-slate-400">(opcional)</span>
            </label>
            <input
              type="text"
              value={relatedPeriod}
              onChange={(e) => setRelatedPeriod(e.target.value)}
              placeholder="Ex: Vendas de 10/11 a 14/11"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Estado do depósito</label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
              {(['realizado', 'pendente'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatus(st)}
                  className={`min-h-[36px] text-xs font-semibold rounded-md capitalize transition-colors ${
                    status === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Observação</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Nota opcional..."
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {feedback && (
          <div
            className={`rounded-lg px-3.5 py-2.5 text-xs font-medium border ${
              feedback.type === 'ok'
                ? 'bg-teal-50 text-teal-800 border-teal-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap"
          >
            <Check className="h-4 w-4" />
            {saving ? 'A guardar...' : 'Guardar Depósito'}
          </button>
        </div>
      </form>

      {/* Deposit History */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">Histórico de Depósitos</h3>
          <button
            type="button"
            onClick={() => setIncludeVoided((v) => !v)}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border ${
              includeVoided
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {includeVoided ? 'Ocultar anulados' : 'Mostrar anulados'}
          </button>
        </div>

        {!payload || payload.deposits.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            Nenhum depósito registado até ao momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-3">Data</th>
                  <th className="py-2.5 px-3">Banco</th>
                  <th className="py-2.5 px-3">Referência</th>
                  <th className="py-2.5 px-3">Período / Notas</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3 text-right">Valor</th>
                  <th className="py-2.5 pl-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payload.deposits.map((dep) => {
                  const isVoid = dep.status === 'anulado';
                  return (
                    <tr key={dep.id} className={`hover:bg-slate-50/70 ${isVoid ? 'opacity-50' : ''}`}>
                      <td className="py-3 pr-3 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {formatDatePT(dep.depositDate)}
                      </td>
                      <td className={`py-3 px-3 font-medium text-slate-900 ${isVoid ? 'line-through' : ''}`}>
                        {dep.bankName}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-600">
                        {dep.referenceCode || '—'}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-500">
                        {[dep.relatedPeriod, dep.notes].filter(Boolean).join(' · ') || '—'}
                        {isVoid && (
                          <span className="block text-red-600">Anulado: {dep.voidReason}</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium whitespace-nowrap">
                        {dep.status === 'realizado' && <span className="text-teal-700">Realizado</span>}
                        {dep.status === 'pendente' && <span className="text-amber-700">Pendente</span>}
                        {dep.status === 'anulado' && <span className="text-red-600">Anulado</span>}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          isVoid ? 'line-through text-slate-500' : 'text-slate-900'
                        }`}
                      >
                        {formatKz(dep.amount)}
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        {!isVoid && (
                          <div className="inline-flex items-center gap-1">
                            {dep.status === 'pendente' && (
                              <button
                                type="button"
                                onClick={() => handleConfirmPending(dep)}
                                className="p-1.5 text-teal-700 hover:bg-teal-50 rounded"
                                title="Confirmar como realizado"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingDeposit({ ...dep })}
                              className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
                              title="Editar depósito"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setVoidTarget(dep)}
                              className="p-1.5 text-slate-500 hover:text-red-600 rounded"
                              title="Anular depósito"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Deposit Modal */}
      {editingDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Editar Depósito</h3>
              <button
                type="button"
                onClick={() => setEditingDeposit(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Data</label>
              <input
                type="date"
                required
                value={editingDeposit.depositDate}
                onChange={(e) => setEditingDeposit({ ...editingDeposit, depositDate: e.target.value })}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Valor (Kz)</label>
              <input
                type="number"
                min="1"
                step="any"
                required
                value={editingDeposit.amount}
                onChange={(e) =>
                  setEditingDeposit({ ...editingDeposit, amount: Number(e.target.value) })
                }
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Banco</label>
              <input
                type="text"
                required
                value={editingDeposit.bankName}
                onChange={(e) => setEditingDeposit({ ...editingDeposit, bankName: e.target.value })}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Estado</label>
              <select
                value={editingDeposit.status}
                onChange={(e) =>
                  setEditingDeposit({
                    ...editingDeposit,
                    status: e.target.value as 'realizado' | 'pendente',
                  })
                }
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="realizado">Realizado</option>
                <option value="pendente">Pendente</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Observação</label>
              <input
                type="text"
                value={editingDeposit.notes}
                onChange={(e) => setEditingDeposit({ ...editingDeposit, notes: e.target.value })}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingDeposit(null)}
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

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Anular depósito bancário"
        description={
          voidTarget
            ? `Confirma a anulação do depósito de ${formatKz(voidTarget.amount)} (${
                voidTarget.bankName
              })? Esta alteração será registada na auditoria.`
            : ''
        }
        confirmLabel="Confirmar Anulação"
        requireReason
        loading={voidLoading}
        onConfirm={handleVoid}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}
