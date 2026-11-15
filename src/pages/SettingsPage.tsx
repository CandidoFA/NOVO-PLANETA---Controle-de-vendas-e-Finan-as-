import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Check, Download, Upload } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AppSettings } from '../types/finance';
import { apiFetch } from '../utils/api';

interface SettingsPageProps {
  onSettingsUpdated: (settings: AppSettings) => void;
}

export function SettingsPage({ onSettingsUpdated }: SettingsPageProps) {
  const [companyName, setCompanyName] = useState('NOVO PLANETA');
  const [logoUrl, setLogoUrl] = useState('');
  const [commissionRate, setCommissionRate] = useState('10');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [restoreJson, setRestoreJson] = useState<unknown | null>(null);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    apiFetch<AppSettings>('/api/settings').then((s) => {
      setCompanyName(s.companyName);
      setLogoUrl(s.logoUrl);
      setCommissionRate(String(s.commissionRate));
    });
  }, []);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsMsg(null);
    setSavingSettings(true);
    try {
      const updated = await apiFetch<AppSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          companyName,
          logoUrl,
          commissionRate: Number(commissionRate),
        }),
      });
      onSettingsUpdated(updated);
      setSettingsMsg({ type: 'ok', text: 'Definições atualizadas com sucesso.' });
    } catch (err) {
      setSettingsMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao atualizar definições.',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleExportBackup() {
    setBackupMsg(null);
    try {
      const data = await apiFetch<unknown>('/api/backup/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `novo-planeta-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg({ type: 'ok', text: 'Backup JSON transferido com sucesso.' });
    } catch (err) {
      setBackupMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao exportar backup.',
      });
    }
  }

  function handleSelectRestoreFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        setRestoreJson(parsed);
        setRestoreFileName(file.name);
        setRestoreConfirmOpen(true);
      } catch {
        setBackupMsg({ type: 'err', text: 'O ficheiro selecionado não é um JSON válido.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleConfirmRestore() {
    if (!restoreJson) return;
    setRestoreLoading(true);
    try {
      await apiFetch('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify(restoreJson),
      });
      setRestoreConfirmOpen(false);
      setRestoreJson(null);
      setBackupMsg({ type: 'ok', text: 'Base de dados restaurada com sucesso a partir do backup.' });
    } catch (err) {
      setRestoreConfirmOpen(false);
      setBackupMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao restaurar backup.',
      });
    } finally {
      setRestoreLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Definições e Backup</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Identidade visual, regra de comissões e cópias de segurança.
        </p>
      </div>

      {/* Visual Identity & Commission Rule */}
      <form
        onSubmit={handleSaveSettings}
        className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
          <BrandLogo logoUrl={logoUrl} companyName={companyName} size="lg" />
          <div>
            <h3 className="text-base font-semibold text-slate-900">Identidade Visual e Regras</h3>
            <p className="text-xs text-slate-500">
              Cole o link oficial do logótipo da NOVO PLANETA quando disponível.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Nome da empresa</label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Link oficial do logótipo (URL https://...)
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://exemplo.com/logotipo-novo-planeta.png"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Percentagem de comissão individual (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              required
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums font-semibold"
            />
          </div>
        </div>

        {settingsMsg && (
          <div
            className={`rounded-lg px-3.5 py-2.5 text-xs font-medium border ${
              settingsMsg.type === 'ok'
                ? 'bg-teal-50 text-teal-800 border-teal-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {settingsMsg.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingSettings}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800"
          >
            <Check className="h-4 w-4" />
            {savingSettings ? 'A guardar...' : 'Guardar Definições'}
          </button>
        </div>
      </form>

      {/* Backup */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-slate-900">Cópia de Segurança e Recuperação</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Exporte um ficheiro JSON completo com todas as vendas, despesas, depósitos, funcionários,
              comissões, fechos diários e auditoria para guardar em segurança ou restaurar em caso de falha.
            </p>
          </div>

          {backupMsg && (
            <div
              className={`rounded-lg px-3.5 py-2.5 text-xs font-medium border ${
                backupMsg.type === 'ok'
                  ? 'bg-teal-50 text-teal-800 border-teal-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {backupMsg.text}
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              Exportar Backup Completo
            </button>

            <label className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-800 text-xs font-semibold hover:bg-slate-50 cursor-pointer">
              <Upload className="h-4 w-4" />
              Restaurar Backup (.json)
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleSelectRestoreFile}
                className="hidden"
              />
            </label>
          </div>
        </div>

      <ConfirmDialog
        open={restoreConfirmOpen}
        title="Restaurar base de dados"
        description={`Tem a certeza que deseja restaurar o sistema com o ficheiro "${restoreFileName}"? Os dados atuais serão substituídos pelos do backup.`}
        confirmLabel="Confirmar Restauro"
        loading={restoreLoading}
        onConfirm={handleConfirmRestore}
        onCancel={() => {
          setRestoreConfirmOpen(false);
          setRestoreJson(null);
        }}
      />
    </div>
  );
}
