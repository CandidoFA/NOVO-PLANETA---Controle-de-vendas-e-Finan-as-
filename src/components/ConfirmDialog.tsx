import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  loading?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  requireReason = false,
  reasonLabel = 'Motivo da operação',
  reasonPlaceholder = 'Descreva o motivo para registo na auditoria...',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');

  if (!open) return null;

  const canConfirm = !requireReason || reason.trim().length >= 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-lg p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                variant === 'danger' ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-700'
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">{description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setReason('');
              onCancel();
            }}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {requireReason && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">{reasonLabel}</label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setReason('');
              onCancel();
            }}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading || !canConfirm}
            onClick={() => {
              const r = reason.trim();
              setReason('');
              onConfirm(r || undefined);
            }}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-teal-700 hover:bg-teal-800'
            }`}
          >
            {loading ? 'A processar...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
