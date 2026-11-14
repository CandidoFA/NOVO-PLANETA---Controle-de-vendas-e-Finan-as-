import { useState } from 'react';
import { formatDatePT, formatKz } from '../utils/format';

export function SalesByAreaChart({
  data,
}: {
  data: { areaId: number; areaName: string; total: number }[];
}) {
  const totalSum = data.reduce((sum, item) => sum + item.total, 0);
  const maxVal = Math.max(...data.map((d) => d.total), 1);

  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        Nenhuma área configurada.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.map((item) => {
        const widthPct = totalSum > 0 ? Math.max(2, (item.total / maxVal) * 100) : 0;
        const sharePct = totalSum > 0 ? Math.round((item.total / totalSum) * 100) : 0;
        return (
          <div key={item.areaId} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-slate-800 truncate">{item.areaName}</span>
              <span className="font-mono tabular-nums text-xs text-slate-600 shrink-0">
                <strong className="text-slate-900 font-semibold">{formatKz(item.total)}</strong>
                <span className="text-slate-400"> · {sharePct}%</span>
              </span>
            </div>
            <div className="h-2.5 w-full rounded-sm bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-sm bg-teal-700 transition-all duration-300"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Total no período</span>
        <span className="font-mono tabular-nums font-semibold text-slate-900">
          {formatKz(totalSum)}
        </span>
      </div>
    </div>
  );
}

export function EvolutionBarChart({
  items,
  labelKey,
  formatLabel,
}: {
  items: { label: string; sales: number; expenses: number; deposits: number }[];
  labelKey?: string;
  formatLabel?: (v: string) => string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const maxVal = Math.max(
    ...items.flatMap((i) => [i.sales, i.expenses, i.deposits]),
    1
  );

  if (items.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        Sem dados disponíveis para o período.
      </div>
    );
  }

  const activeItem = hoveredIdx !== null ? items[hoveredIdx] : null;

  return (
    <div className="space-y-3" data-chart={labelKey}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-teal-700" />
            Vendas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-red-500" />
            Despesas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-slate-800" />
            Depósitos
          </span>
        </div>
        {activeItem && (
          <div className="font-mono tabular-nums text-xs text-slate-800 bg-slate-100 px-2.5 py-1 rounded">
            {formatLabel ? formatLabel(activeItem.label) : activeItem.label} · Vendas:{' '}
            {formatKz(activeItem.sales)} · Desp: {formatKz(activeItem.expenses)} · Dep:{' '}
            {formatKz(activeItem.deposits)}
          </div>
        )}
      </div>

      <div className="relative h-48 flex items-end gap-1.5 pt-4 border-b border-slate-200 overflow-x-auto pb-1">
        {items.map((item, idx) => {
          const sH = Math.round((item.sales / maxVal) * 100);
          const eH = Math.round((item.expenses / maxVal) * 100);
          const dH = Math.round((item.deposits / maxVal) * 100);
          const shortLabel = formatLabel ? formatLabel(item.label) : item.label;

          return (
            <div
              key={`${item.label}-${idx}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`flex-1 min-w-[26px] h-full flex flex-col justify-end items-center gap-1 rounded px-0.5 transition-colors ${
                hoveredIdx === idx ? 'bg-slate-100/80' : ''
              }`}
            >
              <div className="w-full flex-1 flex items-end justify-center gap-0.5">
                <div
                  title={`Vendas: ${formatKz(item.sales)}`}
                  className="w-2 sm:w-2.5 bg-teal-700 rounded-t-xs transition-all"
                  style={{ height: `${item.sales > 0 ? Math.max(4, sH) : 0}%` }}
                />
                <div
                  title={`Despesas: ${formatKz(item.expenses)}`}
                  className="w-2 sm:w-2.5 bg-red-500 rounded-t-xs transition-all"
                  style={{ height: `${item.expenses > 0 ? Math.max(4, eH) : 0}%` }}
                />
                <div
                  title={`Depósitos: ${formatKz(item.deposits)}`}
                  className="w-2 sm:w-2.5 bg-slate-800 rounded-t-xs transition-all"
                  style={{ height: `${item.deposits > 0 ? Math.max(4, dH) : 0}%` }}
                />
              </div>
              <span className="text-[10px] font-mono tabular-nums text-slate-500 truncate max-w-full">
                {shortLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function formatShortDayLabel(isoDate: string): string {
  const pt = formatDatePT(isoDate);
  return pt.slice(0, 5); // DD/MM
}
