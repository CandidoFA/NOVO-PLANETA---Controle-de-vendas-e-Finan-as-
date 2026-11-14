import { FormEvent, useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { AdminRole } from '../types/finance';
import { apiFetch, setStoredToken } from '../utils/api';

interface LoginPageProps {
  companyName: string;
  logoUrl: string;
  isDefaultPassword: boolean;
  onAuthenticated: (role: AdminRole, isDefaultPassword: boolean) => void;
}

export function LoginPage({
  companyName,
  logoUrl,
  isDefaultPassword,
  onAuthenticated,
}: LoginPageProps) {
  const [role, setRole] = useState<AdminRole>('CEO');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; role: AdminRole; token: string; isDefaultPassword: boolean }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ role, password }),
        }
      );
      setStoredToken(res.token);
      onAuthenticated(res.role, res.isDefaultPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar sessão.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs">
        <div className="flex items-center gap-3.5 pb-6 border-b border-slate-100">
          <BrandLogo logoUrl={logoUrl} companyName={companyName} size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 truncate">
              {companyName}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Controlo Diário de Vendas e Finanças
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center gap-2 text-xs text-slate-600 mb-5">
            <ShieldCheck className="h-4 w-4 text-teal-700 shrink-0" />
            <span>Acesso exclusivo de administração · CEO e PCA</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Perfil de acesso responsável
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                {(['CEO', 'PCA'] as AdminRole[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRole(option)}
                    className={`min-h-[44px] text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                      role === option
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                Palavra-passe administrativa
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Introduza a palavra-passe"
                  className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-800"
                  aria-label={showPassword ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isDefaultPassword && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900">
                Primeiro acesso: utilize a palavra-passe inicial{' '}
                <span className="font-mono font-semibold">NovoPlaneta2026</span> e altere-a em Definições.
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              <Lock className="h-4 w-4" />
              {loading ? 'A verificar acesso...' : `Entrar como ${role}`}
            </button>
          </form>
        </div>

        <p className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500 text-center">
          Registo público desativado · Todos os movimentos ficam registados em auditoria.
        </p>
      </div>
    </div>
  );
}
