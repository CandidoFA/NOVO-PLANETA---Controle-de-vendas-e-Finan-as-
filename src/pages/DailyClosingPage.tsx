import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import { DailyClosing } from '../types/finance';
import { apiFetch } from '../utils/api';
import { formatDatePT, formatDateTimePT, formatKz, getTodayISO } from '../utils/format';

interface ClosingPreview {
  closingDate: string;
  areaBreakdown: { areaId: number; areaName: string; total: number }[];
  totalSales: number;
  totalExpenses: number;
  netAfterExpenses: number;
  totalDeposited: number;
  expectedCash: number;
  existingClosing: DailyClosing | null;
}

export function DailyClosingPage() {
  const [selectedDate, setSelectedDate] = useState(getTodayISO());
  const [preview, setPreview] = useState<ClosingPreview | null>(null);
  const [history, setHistory] = useState<DailyClosing[]>([]);
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function loadAll(date: string) {
    const [prev, hist] = await Promise.all([
      apiFetch<ClosingPreview>(`/api/daily-closings/preview?date=${encodeURIComponent(date)}`),
      apiFetch<DailyClosing[]>('/api/daily-closings'),
    ]);
    setPreview(prev);
    setHistory(hist);
    if (prev.existingClosing) {
      setCountedCash(String(prev.existingClosing.countedCash));
      setNotes(prev.existingClosing.notes || '');
    } else {
      setCountedCash(String(Math.max(0, prev.expectedCash)));
      setNotes('');
    }
    setCorrectionReason('');
  }

  useEffect(() => {
    loadAll(selectedDate);
  }, [selectedDate]);

  async function handleConfirmClosing(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setFeedback(null);
    const counted = Number(countedCash);
    if (!Number.isFinite(counted) || counted < 0) {
      setFeedback({ type: 'err', text: 'Introduza o valor efetivamente apurado em caixa.' });
      return;
    }
    if (preview.existingClosing && !correctionReason.trim()) {
      setFeedback({
        type: 'err',
        text: 'Este dia já está fechado. Indique o motivo da correção para registo em auditoria.',
      });
      return;
    }

    setSaving(true);
    try {
      await apiFetch('/api/daily-closings', {
        method: 'POST',
        body: JSON.stringify({
          closingDate: selectedDate,
          countedCash: counted,
          notes: notes.trim(),
          correctionReason: correctionReason.trim(),
        }),
      });
      setFeedback({
        type: 'ok',
        text: preview.existingClosing
          ? `Fecho diário de ${formatDatePT(selectedDate)} atualizado com registo em auditoria.`
          : `Fecho diário de ${formatDatePT(selectedDate)} confirmado e guardado no histórico.`,
      });
      await loadAll(selectedDate);
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao fechar dia.' });
    } finally {
      setSaving(false);
    }
  }

  const countedNum = Number(countedCash);
  const liveDifference =
    preview && Number.isFinite(countedNum) ? countedNum - preview.expectedCash : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Fecho Diário</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Conferência de vendas por área, despesas, depósitos e apuramento final de caixa.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-700">Data do fecho:</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono tabular-nums bg-white"
          />
        </div>
      </div>

      {preview && (
        <form
          onSubmit={handleConfirmClosing}
          className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Resumo de {formatDatePT(preview.closingDate)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {preview.existingClosing
                  ? `Dia fechado por ${preview.existingClosing.closedBy} em ${formatDateTimePT(
                      preview.existingClosing.closedAt
                    )}`
                  : 'Dia ainda em aberto para conferência'}
              </p>
            </div>
            {preview.existingClosing && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
                <Lock className="h-3.5 w-3.5" />
                Fechado
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Breakdown */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-700">Vendas por área</p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {preview.areaBreakdown.map((area) => (
                  <div key={area.areaId} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span className="text-slate-700">{area.areaName}</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900">
                      {formatKz(area.total)}
                    </span>
                  </div>
                ))}
                <div className="px-4 py-3 flex items-center justify-between text-sm bg-slate-50 font-semibold">
                  <span className="text-slate-900">4. Total geral de vendas</span>
                  <span className="font-mono tabular-nums text-teal-700">
                    {formatKz(preview.totalSales)}
                  </span>
                </div>
              </div>
            </div>

            {/* Financial Totals */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-700">Apuramento financeiro do dia</p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                <div className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <span className="text-slate-700">5. Total de despesas</span>
                  <span className="font-mono tabular-nums text-red-600 font-medium">
                    -{formatKz(preview.totalExpenses)}
                  </span>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <span className="text-slate-700">6. Total líquido após despesas</span>
                  <span className="font-mono tabular-nums text-slate-900 font-semibold">
                    {formatKz(preview.netAfterExpenses)}
                  </span>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between text-sm">
                  <span className="text-slate-700">7. Total depositado no dia</span>
                  <span className="font-mono tabular-nums text-slate-900 font-medium">
                    -{formatKz(preview.totalDeposited)}
                  </span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between text-sm bg-slate-50 font-semibold">
                  <span className="text-slate-900">8. Dinheiro esperado em caixa</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {formatKz(preview.expectedCash)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Valor efetivamente apurado em caixa (Kz) *
              </label>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                9. Diferença (Apurado − Esperado)
              </label>
              <div
                className={`min-h-[44px] rounded-lg border px-3 py-2 flex items-center font-mono tabular-nums text-sm font-bold ${
                  Math.abs(liveDifference) < 0.01
                    ? 'bg-teal-50 border-teal-200 text-teal-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                {liveDifference > 0 ? `+${formatKz(liveDifference)}` : formatKz(liveDifference)}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Observações</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas sobre o fecho..."
                className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {preview.existingClosing && (
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-1.5">
                Motivo da correção (obrigatório para alterar um dia já fechado) *
              </label>
              <input
                type="text"
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Explique a razão da correção para ficar registada na auditoria..."
                className="w-full min-h-[44px] rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2 text-sm"
              />
            </div>
          )}

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
              className="min-h-[44px] inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4" />
              {saving
                ? 'A guardar...'
                : preview.existingClosing
                  ? 'Guardar Correção do Fecho'
                  : 'Confirmar e Fechar o Dia'}
            </button>
          </div>
        </form>
      )}

      {/* History */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Histórico de Fechos Diários</h3>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            Ainda não existem fechos diários registados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-3">Data</th>
                  <th className="py-2.5 px-3 text-right">Vendas</th>
                  <th className="py-2.5 px-3 text-right">Despesas</th>
                  <th className="py-2.5 px-3 text-right">Líquido</th>
                  <th className="py-2.5 px-3 text-right">Depositado</th>
                  <th className="py-2.5 px-3 text-right">Esperado</th>
                  <th className="py-2.5 px-3 text-right">Apurado</th>
                  <th className="py-2.5 px-3 text-right">Diferença</th>
                  <th className="py-2.5 pl-3">Responsável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedDate(c.closingDate)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="py-3 pr-3 font-mono tabular-nums text-xs font-semibold text-slate-900">
                      {formatDatePT(c.closingDate)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-teal-700">
                      {formatKz(c.totalSales)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-red-600">
                      {formatKz(c.totalExpenses)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                      {formatKz(c.netAfterExpenses)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatKz(c.totalDeposited)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatKz(c.expectedCash)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatKz(c.countedCash)}
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${
                        Math.abs(c.differenceAmount) < 0.01 ? 'text-teal-700' : 'text-amber-700'
                      }`}
                    >
                      {formatKz(c.differenceAmount)}
                    </td>
                    <td className="py-3 pl-3 text-xs text-slate-600">{c.closedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
