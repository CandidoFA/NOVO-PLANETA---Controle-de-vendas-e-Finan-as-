import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Check, Edit3, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SaleRecord, ServiceArea, ServiceItem } from '../types/finance';
import { apiFetch } from '../utils/api';
import { formatDatePT, formatKz, getTodayISO } from '../utils/format';

export function SalesPage() {
  const today = getTodayISO();
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);

  const [saleDate, setSaleDate] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [filterDate, setFilterDate] = useState(today);
  const [showAllDates, setShowAllDates] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [includeVoided, setIncludeVoided] = useState(false);

  // Catalog Management modal
  const [manageOpen, setManageOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceAreaId, setNewServiceAreaId] = useState<number | ''>('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [editingArea, setEditingArea] = useState<ServiceArea | null>(null);

  // Edit sale modal
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null);
  const [editSaleAmount, setEditSaleAmount] = useState('');
  const [editSaleDate, setEditSaleDate] = useState('');
  const [editSaleNotes, setEditSaleNotes] = useState('');

  // Void confirmation
  const [voidTarget, setVoidTarget] = useState<SaleRecord | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);

  async function loadCatalog() {
    const res = await apiFetch<{ areas: ServiceArea[]; services: ServiceItem[] }>('/api/catalog');
    const activeAreas = res.areas.filter((a) => a.active === 1);
    setAreas(res.areas);
    setServices(res.services);
    if (activeAreas.length > 0 && !selectedAreaId) {
      setSelectedAreaId(activeAreas[0].id);
      const firstSvc = res.services.find((s) => s.areaId === activeAreas[0].id && s.active === 1);
      if (firstSvc) setSelectedServiceId(firstSvc.id);
    }
    if (activeAreas.length > 0 && !newServiceAreaId) {
      setNewServiceAreaId(activeAreas[0].id);
    }
  }

  async function loadSales() {
    const params = new URLSearchParams();
    if (!showAllDates && filterDate) {
      params.set('startDate', filterDate);
      params.set('endDate', filterDate);
    }
    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }
    if (includeVoided) {
      params.set('includeVoided', 'true');
    }
    const rows = await apiFetch<SaleRecord[]>(`/api/sales?${params.toString()}`);
    setSales(rows);
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    loadSales();
  }, [filterDate, showAllDates, searchQuery, includeVoided]);

  const activeAreas = useMemo(() => areas.filter((a) => a.active === 1), [areas]);
  const currentAreaServices = useMemo(
    () => services.filter((s) => s.areaId === selectedAreaId && s.active === 1),
    [services, selectedAreaId]
  );

  function handleSelectArea(areaId: number) {
    setSelectedAreaId(areaId);
    const areaSvcs = services.filter((s) => s.areaId === areaId && s.active === 1);
    setSelectedServiceId(areaSvcs.length > 0 ? areaSvcs[0].id : null);
    if (areaSvcs[0]?.defaultPrice) {
      setUnitPrice(String(areaSvcs[0].defaultPrice));
      if (quantity) {
        setTotalAmount(String(Number(quantity) * areaSvcs[0].defaultPrice));
      } else {
        setTotalAmount(String(areaSvcs[0].defaultPrice));
      }
    }
  }

  function handleSelectService(svc: ServiceItem) {
    setSelectedServiceId(svc.id);
    if (svc.defaultPrice) {
      setUnitPrice(String(svc.defaultPrice));
      const qtyNum = Number(quantity);
      if (qtyNum > 0) {
        setTotalAmount(String(qtyNum * svc.defaultPrice));
      } else {
        setTotalAmount(String(svc.defaultPrice));
      }
    }
  }

  function handleQuantityOrUnitChange(nextQty: string, nextUnit: string) {
    setQuantity(nextQty);
    setUnitPrice(nextUnit);
    const q = Number(nextQty);
    const u = Number(nextUnit);
    if (q > 0 && u > 0) {
      setTotalAmount(String(q * u));
    }
  }

  async function handleSaveSale(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!selectedAreaId || !selectedServiceId) {
      setFeedback({ type: 'err', text: 'Selecione a área e o serviço realizado.' });
      return;
    }
    const parsedTotal = Number(totalAmount);
    if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) {
      setFeedback({ type: 'err', text: 'Introduza um valor total válido superior a 0 Kz.' });
      return;
    }

    setSaving(true);
    try {
      await apiFetch<SaleRecord>('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          saleDate,
          areaId: selectedAreaId,
          serviceId: selectedServiceId,
          quantity: quantity ? Number(quantity) : null,
          unitPrice: unitPrice ? Number(unitPrice) : null,
          totalAmount: parsedTotal,
          notes,
        }),
      });
      setQuantity('');
      setUnitPrice('');
      setTotalAmount('');
      setNotes('');
      setFeedback({ type: 'ok', text: `Venda de ${formatKz(parsedTotal)} registada com sucesso.` });
      if (!showAllDates && filterDate !== saleDate) {
        setFilterDate(saleDate);
      } else {
        await loadSales();
      }
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao guardar venda.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleVoidSale(reason?: string) {
    if (!voidTarget) return;
    setVoidLoading(true);
    try {
      await apiFetch(`/api/sales/${voidTarget.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setVoidTarget(null);
      await loadSales();
    } finally {
      setVoidLoading(false);
    }
  }

  async function handleSaveEditSale(e: FormEvent) {
    e.preventDefault();
    if (!editingSale) return;
    await apiFetch(`/api/sales/${editingSale.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        saleDate: editSaleDate,
        totalAmount: Number(editSaleAmount),
        notes: editSaleNotes,
      }),
    });
    setEditingSale(null);
    await loadSales();
  }

  async function handleCreateArea(e: FormEvent) {
    e.preventDefault();
    if (!newAreaName.trim()) return;
    await apiFetch('/api/areas', {
      method: 'POST',
      body: JSON.stringify({ name: newAreaName.trim() }),
    });
    setNewAreaName('');
    await loadCatalog();
  }

  async function handleCreateService(e: FormEvent) {
    e.preventDefault();
    if (!newServiceAreaId || !newServiceName.trim()) return;
    await apiFetch('/api/services', {
      method: 'POST',
      body: JSON.stringify({
        areaId: Number(newServiceAreaId),
        name: newServiceName.trim(),
        defaultPrice: newServicePrice ? Number(newServicePrice) : null,
      }),
    });
    setNewServiceName('');
    setNewServicePrice('');
    await loadCatalog();
  }

  async function handleUpdateService(svc: ServiceItem) {
    await apiFetch(`/api/services/${svc.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: svc.name,
        defaultPrice: svc.defaultPrice,
        active: svc.active,
      }),
    });
    setEditingService(null);
    await loadCatalog();
  }

  async function handleDeleteService(id: number) {
    await apiFetch(`/api/services/${id}`, { method: 'DELETE' });
    await loadCatalog();
  }

  async function handleUpdateArea(area: ServiceArea) {
    await apiFetch(`/api/areas/${area.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: area.name, active: area.active }),
    });
    setEditingArea(null);
    await loadCatalog();
  }

  async function handleDeleteArea(id: number) {
    await apiFetch(`/api/areas/${id}`, { method: 'DELETE' });
    await loadCatalog();
  }

  const activeSalesSum = sales
    .filter((s) => s.status === 'ativo')
    .reduce((sum, s) => sum + s.totalAmount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Registo de Vendas</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Selecione a área e o serviço para registar rapidamente uma venda em Kwanza.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap self-start sm:self-auto"
        >
          <Settings2 className="h-4 w-4" />
          Gerir Áreas e Serviços
        </button>
      </div>

      {/* Fast Registration Card */}
      <form
        onSubmit={handleSaveSale}
        className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-2">
            1. Área ou Departamento
          </label>
          <div className="flex flex-wrap gap-2">
            {activeAreas.map((area) => (
              <button
                key={area.id}
                type="button"
                onClick={() => handleSelectArea(area.id)}
                className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap ${
                  selectedAreaId === area.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {area.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-2">
            2. Serviço Realizado
          </label>
          {currentAreaServices.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum serviço ativo nesta área. Clique em "Gerir Áreas e Serviços" para adicionar.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {currentAreaServices.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => handleSelectService(svc)}
                  className={`min-h-[44px] px-3.5 py-2.5 rounded-lg border text-left text-sm transition-colors flex items-center justify-between gap-2 ${
                    selectedServiceId === svc.id
                      ? 'bg-teal-700 text-white border-teal-700 font-semibold'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <span className="truncate">{svc.name}</span>
                  {svc.defaultPrice ? (
                    <span
                      className={`font-mono tabular-nums text-xs shrink-0 ${
                        selectedServiceId === svc.id ? 'text-teal-100' : 'text-slate-500'
                      }`}
                    >
                      {formatKz(svc.defaultPrice)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Data da venda</label>
            <input
              type="date"
              required
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Quantidade <span className="text-slate-400">(opcional)</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => handleQuantityOrUnitChange(e.target.value, unitPrice)}
              placeholder="Ex: 5"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Valor unitário Kz <span className="text-slate-400">(opc.)</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={unitPrice}
              onChange={(e) => handleQuantityOrUnitChange(quantity, e.target.value)}
              placeholder="Ex: 500"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Valor total (Kz) *
            </label>
            <input
              type="number"
              min="1"
              step="any"
              required
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              placeholder="Ex: 12500"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums font-semibold text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Observação <span className="text-slate-400">(opcional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Nota adicional..."
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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-slate-500">
            Total calculado:{' '}
            <strong className="font-mono tabular-nums text-slate-900 text-sm">
              {formatKz(Number(totalAmount) || 0)}
            </strong>
          </p>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            <Check className="h-4 w-4" />
            {saving ? 'A guardar...' : 'Guardar Venda'}
          </button>
        </div>
      </form>

      {/* Sales List & Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Vendas registadas{' '}
              <span className="font-mono tabular-nums text-teal-700 ml-1">
                · Total: {formatKz(activeSalesSum)}
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {showAllDates ? 'Todas as datas' : `Data: ${formatDatePT(filterDate)}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar serviço ou nota..."
                className="min-h-[40px] rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-sm w-56"
              />
            </div>

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

        {sales.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            Nenhuma venda encontrada para os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-3">Data</th>
                  <th className="py-2.5 px-3">Área</th>
                  <th className="py-2.5 px-3">Serviço</th>
                  <th className="py-2.5 px-3 text-right">Qtd × Unit.</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                  <th className="py-2.5 px-3">Observação</th>
                  <th className="py-2.5 pl-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map((sale) => {
                  const isVoid = sale.status === 'anulado';
                  return (
                    <tr key={sale.id} className={`hover:bg-slate-50/70 ${isVoid ? 'opacity-50' : ''}`}>
                      <td className="py-3 pr-3 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {formatDatePT(sale.saleDate)}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {sale.areaName}
                      </td>
                      <td className={`py-3 px-3 font-medium text-slate-900 ${isVoid ? 'line-through' : ''}`}>
                        {sale.serviceName}
                        {isVoid && (
                          <span className="ml-2 text-xs text-red-600 no-underline">
                            (Anulada: {sale.voidReason})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {sale.quantity && sale.unitPrice
                          ? `${sale.quantity} × ${formatKz(sale.unitPrice)}`
                          : '—'}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          isVoid ? 'line-through text-slate-500' : 'text-teal-700'
                        }`}
                      >
                        {formatKz(sale.totalAmount)}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-500 max-w-[200px] truncate">
                        {sale.notes || '—'}
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        {!isVoid && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSale(sale);
                                setEditSaleAmount(String(sale.totalAmount));
                                setEditSaleDate(sale.saleDate);
                                setEditSaleNotes(sale.notes || '');
                              }}
                              className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
                              title="Editar venda"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setVoidTarget(sale)}
                              className="p-1.5 text-slate-500 hover:text-red-600 rounded"
                              title="Anular venda"
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

      {/* Edit Sale Modal */}
      {editingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleSaveEditSale}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Editar Venda · {editingSale.serviceName}
              </h3>
              <button
                type="button"
                onClick={() => setEditingSale(null)}
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
                value={editSaleDate}
                onChange={(e) => setEditSaleDate(e.target.value)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Valor total (Kz)</label>
              <input
                type="number"
                min="1"
                step="any"
                required
                value={editSaleAmount}
                onChange={(e) => setEditSaleAmount(e.target.value)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Observação</label>
              <input
                type="text"
                value={editSaleNotes}
                onChange={(e) => setEditSaleNotes(e.target.value)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingSale(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800"
              >
                Guardar Alteração
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Catalog Management Modal */}
      {manageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Gerir Áreas e Serviços</h3>
                <p className="text-xs text-slate-500">
                  Adicione, edite ou desative áreas e serviços sem alterar o código do sistema.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Add New Area */}
            <form onSubmit={handleCreateArea} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newAreaName}
                onChange={(e) => setNewAreaName(e.target.value)}
                placeholder="Nome da nova área (ex: PAPELARIA)"
                className="flex-1 min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                Criar Área
              </button>
            </form>

            {/* Add New Service */}
            <form
              onSubmit={handleCreateService}
              className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-4 border-t border-slate-100"
            >
              <select
                value={newServiceAreaId}
                onChange={(e) => setNewServiceAreaId(Number(e.target.value))}
                className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {activeAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newServiceName}
                onChange={(e) => setNewServiceName(e.target.value)}
                placeholder="Nome do novo serviço..."
                className="sm:col-span-2 min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={newServicePrice}
                  onChange={(e) => setNewServicePrice(e.target.value)}
                  placeholder="Preço Kz (opc.)"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
                />
                <button
                  type="submit"
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 whitespace-nowrap"
                >
                  Adicionar
                </button>
              </div>
            </form>

            {/* List of Areas & Services */}
            <div className="space-y-4 pt-2">
              {areas.map((area) => {
                const areaServices = services.filter((s) => s.areaId === area.id);
                return (
                  <div key={area.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      {editingArea?.id === area.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editingArea.name}
                            onChange={(e) => setEditingArea({ ...editingArea, name: e.target.value })}
                            className="rounded border border-slate-300 px-2.5 py-1 text-sm font-semibold"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateArea(editingArea)}
                            className="px-3 py-1 bg-teal-700 text-white text-xs rounded"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingArea(null)}
                            className="px-2 py-1 text-xs text-slate-600"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-slate-900 text-sm">{area.name}</h4>
                          {area.active === 0 && (
                            <span className="text-xs text-red-600">· Desativada</span>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingArea(area)}
                          className="p-1.5 text-slate-500 hover:text-slate-900"
                          title="Editar área"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteArea(area.id)}
                          className="p-1.5 text-slate-500 hover:text-red-600"
                          title="Eliminar ou desativar área"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {areaServices.map((svc) => (
                        <div key={svc.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                          {editingService?.id === svc.id ? (
                            <div className="flex flex-wrap items-center gap-2 flex-1">
                              <input
                                type="text"
                                value={editingService.name}
                                onChange={(e) =>
                                  setEditingService({ ...editingService, name: e.target.value })
                                }
                                className="flex-1 min-w-[160px] rounded border border-slate-300 px-2.5 py-1 text-sm"
                              />
                              <input
                                type="number"
                                value={editingService.defaultPrice ?? ''}
                                onChange={(e) =>
                                  setEditingService({
                                    ...editingService,
                                    defaultPrice: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                                placeholder="Preço Kz"
                                className="w-28 rounded border border-slate-300 px-2.5 py-1 text-sm font-mono tabular-nums"
                              />
                              <button
                                type="button"
                                onClick={() => handleUpdateService(editingService)}
                                className="px-3 py-1 bg-teal-700 text-white text-xs rounded"
                              >
                                Guardar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingService(null)}
                                className="px-2 py-1 text-xs text-slate-600"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className={svc.active === 0 ? 'text-slate-400 line-through' : 'text-slate-800'}>
                                {svc.name}
                                {svc.defaultPrice ? (
                                  <span className="ml-2 font-mono text-xs text-slate-500">
                                    · {formatKz(svc.defaultPrice)}
                                  </span>
                                ) : null}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setEditingService(svc)}
                                  className="p-1 text-slate-500 hover:text-slate-900"
                                  title="Editar serviço"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteService(svc.id)}
                                  className="p-1 text-slate-500 hover:text-red-600"
                                  title="Eliminar ou desativar serviço"
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
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Anular registo de venda"
        description={
          voidTarget
            ? `Tem a certeza que deseja anular a venda "${voidTarget.serviceName}" no valor de ${formatKz(
                voidTarget.totalAmount
              )}? O movimento permanecerá registado na auditoria.`
            : ''
        }
        confirmLabel="Confirmar Anulação"
        requireReason
        loading={voidLoading}
        onConfirm={handleVoidSale}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}
