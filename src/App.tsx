import { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Landmark,
  LayoutDashboard,
  Menu,
  PiggyBank,
  Receipt,
  Settings,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react';
import { BrandLogo } from './components/BrandLogo';
import { CalendarAndAuditPage } from './pages/CalendarAndAuditPage';
import { CommissionsPage } from './pages/CommissionsPage';
import { DailyClosingPage } from './pages/DailyClosingPage';
import { DashboardPage } from './pages/DashboardPage';
import { DepositsPage } from './pages/DepositsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesPage } from './pages/SalesPage';
import { SavedMoneyPage } from './pages/SavedMoneyPage';
import { SettingsPage } from './pages/SettingsPage';
import { AppSettings } from './types/finance';
import { apiFetch } from './utils/api';
import { formatDatePT, getTodayISO } from './utils/format';

type NavId =
  | 'dashboard'
  | 'vendas'
  | 'despesas'
  | 'depositos'
  | 'comissoes'
  | 'fecho'
  | 'guardado'
  | 'relatorios'
  | 'calendario'
  | 'definicoes';

const NAV_ITEMS: { id: NavId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Painel Principal', icon: LayoutDashboard },
  { id: 'vendas', label: 'Registo de Vendas', icon: ShoppingBag },
  { id: 'despesas', label: 'Despesas', icon: Receipt },
  { id: 'depositos', label: 'Depósitos', icon: Landmark },
  { id: 'comissoes', label: 'Comissões (10%)', icon: Users },
  { id: 'fecho', label: 'Fecho Diário', icon: ClipboardCheck },
  { id: 'guardado', label: 'Dinheiro Guardado', icon: PiggyBank },
  { id: 'relatorios', label: 'Relatórios', icon: BarChart3 },
  { id: 'calendario', label: 'Calendário e Auditoria', icon: CalendarDays },
  { id: 'definicoes', label: 'Definições e Backup', icon: Settings },
];

export default function App() {
  const [companyName, setCompanyName] = useState('NOVO PLANETA');
  const [logoUrl, setLogoUrl] = useState('');

  const [activeTab, setActiveTab] = useState<NavId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    apiFetch<AppSettings>('/api/settings')
      .then((settings) => {
        if (settings.companyName) setCompanyName(settings.companyName);
        if (typeof settings.logoUrl === 'string') setLogoUrl(settings.logoUrl);
      })
      .catch(() => {
        // Keep default branding if initial settings fetch fails
      });
  }, []);

  function handleSettingsUpdated(next: AppSettings) {
    setCompanyName(next.companyName);
    setLogoUrl(next.logoUrl);
  }

  const currentNav = NAV_ITEMS.find((item) => item.id === activeTab);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200 shrink-0">
          <BrandLogo logoUrl={logoUrl} companyName={companyName} size="sm" />
          <span className="font-bold text-base tracking-tight text-slate-900 truncate">
            {companyName}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[42px] px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="text-xs text-slate-500">
            <strong className="text-slate-900">Controlo Diário</strong> ·{' '}
            <span className="font-mono">{formatDatePT(getTodayISO())}</span>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandLogo logoUrl={logoUrl} companyName={companyName} size="sm" />
                <span className="font-bold text-sm text-slate-900 truncate">{companyName}</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-slate-200">
              <div className="text-xs text-slate-500">
                <strong className="text-slate-900">Controlo Diário</strong> ·{' '}
                <span className="font-mono">{formatDatePT(getTodayISO())}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar (3-zone contract) */}
        <header className="sticky top-0 z-30 h-14 sm:h-16 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-700 hover:text-slate-900 rounded-lg"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-slate-900 truncate whitespace-nowrap">
              {currentNav?.label}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-5 text-xs font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Painel
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('vendas')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Vendas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('despesas')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Despesas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('depositos')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Depósitos
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fecho')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Fecho Diário
            </button>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('vendas')}
              className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 whitespace-nowrap shrink-0"
            >
              Nova Venda
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardPage onNavigate={(tab) => setActiveTab(tab as NavId)} />
          )}
          {activeTab === 'vendas' && <SalesPage />}
          {activeTab === 'despesas' && <ExpensesPage />}
          {activeTab === 'depositos' && <DepositsPage />}
          {activeTab === 'comissoes' && <CommissionsPage />}
          {activeTab === 'fecho' && <DailyClosingPage />}
          {activeTab === 'guardado' && <SavedMoneyPage />}
          {activeTab === 'relatorios' && <ReportsPage />}
          {activeTab === 'calendario' && <CalendarAndAuditPage initialTab="calendario" />}
          {activeTab === 'definicoes' && (
            <SettingsPage onSettingsUpdated={handleSettingsUpdated} />
          )}
        </main>
      </div>
    </div>
  );
}
