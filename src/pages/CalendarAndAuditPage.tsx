import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, ShieldAlert } from 'lucide-react';
import { AuditLog } from '../types/finance';
import { apiFetch } from '../utils/api';
import {
  formatDatePT,
  formatDateTimePT,
  formatKz,
  getTodayISO,
  MONTH_NAMES_PT,
  WEEKDAYS_SHORT_PT,
} from '../utils/format';

interface CalendarData {
  year: number;
  month: number;
  salesByDay: Record<string, { date: string; total: number; count: number }>;
  expensesByDay: Record<string, number>;
  depositsByDay: Record<string, number>;
  closingsByDay: Record<string, number>;
}

export function CalendarAndAuditPage({ initialTab = 'calendario' }: { initialTab?: 'calendario' | 'auditoria' }) {
  const [subTab, setSubTab] = useState<'calendario' | 'auditoria'>(initialTab);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [calData, setCalData] = useState<CalendarData | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(getTodayISO());

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [entityFilter, setEntityFilter] = useState('');

  useEffect(() => {
    setSubTab(initialTab);
  }, [initialTab]);

  async function loadCalendar(y: number, m: number) {
    const res = await apiFetch<CalendarData>(`/api/calendar?year=${y}&month=${m}`);
    setCalData(res);
  }

  async function loadAudit(entity: string) {
    const qs = entity ? `?entityType=${encodeURIComponent(entity)}` : '';
    const rows = await apiFetch<AuditLog[]>(`/api/audit-logs${qs}`);
    setAuditLogs(rows);
  }

  useEffect(() => {
    loadCalendar(year, month);
  }, [year, month]);

  useEffect(() => {
    loadAudit(entityFilter);
  }, [entityFilter, subTab]);

  function prevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekdayJs = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const leadingEmpty = firstWeekdayJs === 0 ? 6 : firstWeekdayJs - 1; // Monday first

  const todayISO = getTodayISO();

  const selectedDaySales = calData?.salesByDay[selectedDay]?.total || 0;
  const selectedDayExpenses = calData?.expensesByDay[selectedDay] || 0;
  const selectedDayDeposits = calData?.depositsByDay[selectedDay] || 0;
  const selectedDayClosed =
    calData && selectedDay in calData.closingsByDay ? calData.closingsByDay[selectedDay] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Calendário Financeiro e Auditoria
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Acompanhamento diário dos movimentos no calendário e registo imutável de auditoria.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSubTab('calendario')}
            className={`min-h-[38px] px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subTab === 'calendario' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Calendário Financeiro
          </button>
          <button
            type="button"
            onClick={() => setSubTab('auditoria')}
            className={`min-h-[38px] px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subTab === 'auditoria' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Histórico de Auditoria
          </button>
        </div>
      </div>

      {subTab === 'calendario' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {MONTH_NAMES_PT[month - 1]} {year}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
                  aria-label="Mês anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
                  aria-label="Mês seguinte"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-slate-500">
              {WEEKDAYS_SHORT_PT.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: leadingEmpty }).map((_, idx) => (
                <div key={`empty-${idx}`} className="h-20 rounded-lg bg-slate-50/50" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const dayNum = idx + 1;
                const iso = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const sTotal = calData?.salesByDay[iso]?.total || 0;
                const eTotal = calData?.expensesByDay[iso] || 0;
                const dTotal = calData?.depositsByDay[iso] || 0;
                const isClosed = calData ? iso in calData.closingsByDay : false;
                const isSelected = selectedDay === iso;
                const isToday = todayISO === iso;

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedDay(iso)}
                    className={`h-20 rounded-lg border p-1.5 text-left flex flex-col justify-between transition-colors ${
                      isSelected
                        ? 'border-teal-700 bg-teal-50/50'
                        : isToday
                          ? 'border-slate-400 bg-white'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-xs font-mono tabular-nums font-semibold ${
                          isToday ? 'text-teal-700' : 'text-slate-800'
                        }`}
                      >
                        {dayNum}
                      </span>
                      {isClosed && (
                        <span title="Dia fechado" className="inline-flex">
                          <Lock className="h-3 w-3 text-teal-700" />
                        </span>
                      )}
                    </div>

                    <div className="space-y-0.5 text-[10px] font-mono tabular-nums leading-tight overflow-hidden">
                      {sTotal > 0 && (
                        <div className="text-teal-700 truncate">+{Math.round(sTotal)}</div>
                      )}
                      {eTotal > 0 && (
                        <div className="text-red-600 truncate">-{Math.round(eTotal)}</div>
                      )}
                      {dTotal > 0 && (
                        <div className="text-slate-700 truncate">Dep {Math.round(dTotal)}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Day Summary */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 self-start">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Resumo de {formatDatePT(selectedDay)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedDayClosed !== null ? 'Fecho diário confirmado' : 'Dia sem fecho registado'}
              </p>
            </div>

            <div className="divide-y divide-slate-100 text-sm">
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-600">Vendas</span>
                <span className="font-mono tabular-nums font-semibold text-teal-700">
                  {formatKz(selectedDaySales)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-600">Despesas</span>
                <span className="font-mono tabular-nums font-semibold text-red-600">
                  {formatKz(selectedDayExpenses)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-600">Líquido do dia</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {formatKz(selectedDaySales - selectedDayExpenses)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-slate-600">Depósitos realizados</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {formatKz(selectedDayDeposits)}
                </span>
              </div>
              {selectedDayClosed !== null && (
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-600">Diferença no fecho</span>
                  <span className="font-mono tabular-nums font-semibold text-amber-700">
                    {formatKz(selectedDayClosed)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-teal-700" />
              <h3 className="text-base font-semibold text-slate-900">
                Registo de Auditoria e Operações
              </h3>
            </div>

            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="min-h-[38px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium"
            >
              <option value="">Todas as operações</option>
              <option value="venda">Vendas</option>
              <option value="despesa">Despesas</option>
              <option value="deposito">Depósitos</option>
              <option value="fecho_diario">Fechos diários</option>
              <option value="ciclo_comissoes">Ciclos de comissões</option>
              <option value="pagamento_comissao">Pagamentos de comissões</option>
              <option value="seguranca">Segurança e palavra-passe</option>
              <option value="backup">Backups</option>
            </select>
          </div>

          {auditLogs.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Sem registos de auditoria para este filtro.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pr-3">Data e Hora</th>
                    <th className="py-2.5 px-3">Responsável</th>
                    <th className="py-2.5 px-3">Operação</th>
                    <th className="py-2.5 pl-3">Descrição</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pr-3 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {formatDateTimePT(log.createdAt)}
                      </td>
                      <td className="py-3 px-3 text-xs font-semibold text-slate-900 whitespace-nowrap">
                        {log.actor}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-3 pl-3 text-xs text-slate-800">{log.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
