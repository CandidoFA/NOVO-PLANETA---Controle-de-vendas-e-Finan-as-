import { FormEvent, useEffect, useState } from 'react';
import { Check, Edit3, Plus, Settings2, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExpenseCategory, ExpenseRecord, ServiceArea } from '../types/finance';
import { apiFetch } from '../utils/api';
import { formatDatePT, formatKz, getTodayISO } from '../utils/format';

export function ExpensesPage() {
  const today = getTodayISO();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);

  const [expenseDate, setExpenseDate] = useState(today);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [areaId, setAreaId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [filterDate, setFilterDate] = useState(today);
  const [showAllDates, setShowAllDates] = useState(false);
  const [includeVoided, setIncludeVoided] = useState(false);

  // Category modal
  const [manageCats, setManageCats] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [editingCat, setEditingCat] = useState<ExpenseCategory | null>(null);

  // Void dialog
  const [voidTarget, setVoidTarget] = useState<ExpenseRecord | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);

  async function loadMeta() {
    const [cats, catalog] = await Promise.all([
      apiFetch<ExpenseCategory[]>('/api/expense-categories'),
      apiFetch<{ areas: ServiceArea[] }>('/api/catalog'),
    ]);
    setCategories(cats);
    setAreas(catalog.areas.filter((a) => a.active === 1));
    const activeCats = cats.filter((c) => c.active === 1);
    if (activeCats.length > 0 && !categoryId) {
      setCategoryId(activeCats[0].id);
    }
  }

  async function loadExpenses() {
    const params = new URLSearchParams();
    if (!showAllDates && filterDate) {
      params.set('startDate', filterDate);
      params.set('endDate', filterDate);
    }
    if (includeVoided) {
      params.set('includeVoided', 'true');
    }
    const rows = await apiFetch<ExpenseRecord[]>(`/api/expenses?${params.toString()}`);
    setExpenses(rows);
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [filterDate, showAllDates, includeVoided]);

  async function handleSaveExpense(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const val = Number(amount);
    if (!categoryId || !description.trim() || !Number.isFinite(val) || val <= 0) {
      setFeedback({ type: 'err', text: 'Preencha a categoria, descrição e valor válido.' });
      return;
    }

    setSaving(true);
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          expenseDate,
          categoryId: Number(categoryId),
          description: description.trim(),
          amount: val,
          areaId: areaId ? Number(areaId) : null,
          notes,
        }),
      });
      setDescription('');
      setAmount('');
      setNotes('');
      setFeedback({ type: 'ok', text: `Despesa de ${formatKz(val)} registada.` });
      if (!showAllDates && filterDate !== expenseDate) {
        setFilterDate(expenseDate);
      } else {
        await loadExpenses();
      }
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao guardar despesa.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleVoidExpense(reason?: string) {
    if (!voidTarget) return;
    setVoidLoading(true);
    try {
      await apiFetch(`/api/expenses/${voidTarget.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setVoidTarget(null);
      await loadExpenses();
    } finally {
      setVoidLoading(false);
    }
  }

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    await apiFetch('/api/expense-categories', {
      method: 'POST',
      body: JSON.stringify({ name: newCatName.trim() }),
    });
    setNewCatName('');
    await loadMeta();
  }

  async function handleUpdateCategory(cat: ExpenseCategory) {
    await apiFetch(`/api/expense-categories/${cat.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: cat.name, active: cat.active }),
    });
    setEditingCat(null);
    await loadMeta();
  }

  async function handleDeleteCategory(id: number) {
    await apiFetch(`/api/expense-categories/${id}`, { method: 'DELETE' });
    await loadMeta();
  }

  const activeCategories = categories.filter((c) => c.active === 1);
  const totalActiveExpenses = expenses
    .filter((e) => e.status === 'ativo')
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Despesas</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Registe várias despesas diárias com cálculo automático do total do dia.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setManageCats(true)}
          className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap self-start sm:self-auto"
        >
          <Settings2 className="h-4 w-4" />
          Gerir Categorias
        </button>
      </div>

      <form
        onSubmit={handleSaveExpense}
        className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Data</label>
            <input
              type="date"
              required
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Categoria</label>
            <select
              required
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Valor (Kz) *</label>
            <input
              type="number"
              min="1"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ex: 5000"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums font-semibold"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Descrição *</label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Gasóleo para gerador"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Área relacionada <span className="text-slate-400">(opcional)</span>
            </label>
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : '')}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Geral da empresa</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Observação <span className="text-slate-400">(opcional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalhes adicionais..."
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
            className="min-h-[44px] inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            <Check className="h-4 w-4" />
            {saving ? 'A guardar...' : 'Registar Despesa'}
          </button>
        </div>
      </form>

      {/* Expenses List */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Despesas registadas{' '}
              <span className="font-mono tabular-nums text-red-600 ml-1">
                · Total: {formatKz(totalActiveExpenses)}
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {showAllDates ? 'Todas as datas' : `Data: ${formatDatePT(filterDate)}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!showAllDates && (
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums"
              />
            )}
            <button
              type="button"
              onClick={() => setShowAllDates((v) => !v)}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap ${
                showAllDates
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {showAllDates ? 'Ver apenas 1 dia' : 'Ver histórico completo'}
            </button>
            <button
              type="button"
              onClick={() => setIncludeVoided((v) => !v)}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap ${
                includeVoided
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {includeVoided ? 'Ocultar anuladas' : 'Mostrar anuladas'}
            </button>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            Nenhuma despesa registada para este período.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-3">Data</th>
                  <th className="py-2.5 px-3">Categoria</th>
                  <th className="py-2.5 px-3">Descrição</th>
                  <th className="py-2.5 px-3">Área</th>
                  <th className="py-2.5 px-3 text-right">Valor</th>
                  <th className="py-2.5 pl-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((exp) => {
                  const isVoid = exp.status === 'anulado';
                  return (
                    <tr key={exp.id} className={`hover:bg-slate-50/70 ${isVoid ? 'opacity-50' : ''}`}>
                      <td className="py-3 pr-3 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {formatDatePT(exp.expenseDate)}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {exp.categoryName}
                      </td>
                      <td className={`py-3 px-3 text-slate-900 ${isVoid ? 'line-through' : ''}`}>
                        {exp.description}
                        {exp.notes && <span className="block text-xs text-slate-500">{exp.notes}</span>}
                        {isVoid && (
                          <span className="block text-xs text-red-600">Anulada: {exp.voidReason}</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 whitespace-nowrap">
                        {exp.areaName || 'Geral'}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          isVoid ? 'line-through text-slate-500' : 'text-red-600'
                        }`}
                      >
                        {formatKz(exp.amount)}
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        {!isVoid && (
                          <button
                            type="button"
                            onClick={() => setVoidTarget(exp)}
                            className="p-1.5 text-slate-500 hover:text-red-600 rounded"
                            title="Anular despesa"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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

      {/* Category Management Modal */}
      {manageCats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Categorias de Despesas</h3>
              <button
                type="button"
                onClick={() => setManageCats(false)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="flex gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Nova categoria (ex: Energia, Internet)..."
                className="flex-1 min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                Adicionar
              </button>
            </form>

            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {categories.map((cat) => (
                <div key={cat.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                  {editingCat?.id === cat.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={editingCat.name}
                        onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                        className="flex-1 rounded border border-slate-300 px-2.5 py-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateCategory(editingCat)}
                        className="px-3 py-1 bg-teal-700 text-white text-xs rounded"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCat(null)}
                        className="px-2 py-1 text-xs text-slate-600"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className={cat.active === 0 ? 'text-slate-400 line-through' : 'text-slate-800'}>
                        {cat.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingCat(cat)}
                          className="p-1 text-slate-500 hover:text-slate-900"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="p-1 text-slate-500 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Anular registo de despesa"
        description={
          voidTarget
            ? `Confirma a anulação da despesa "${voidTarget.description}" (${formatKz(
                voidTarget.amount
              )})?`
            : ''
        }
        confirmLabel="Confirmar Anulação"
        requireReason
        loading={voidLoading}
        onConfirm={handleVoidExpense}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}
