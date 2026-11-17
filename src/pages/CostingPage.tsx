import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Calculator,
  CheckCircle2,
  Edit3,
  Layers,
  Package,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import {
  calculateBatchAndProductCosting,
  calculateWeightedAverageMaterialCosts,
  type BatchCostBreakdown,
} from '../lib/costingAndAudit';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { roundCurrency, validateProductionCostingInput } from '../lib/validation';
import {
  ORG_ID,
  type Product,
  type ProductionConsumption,
  type ProductionCosting,
  type ProductionOrder,
  type Purchase,
  type PurchaseItem,
  type RawMaterial,
} from '../types/erp';

type CostingTab = 'products' | 'batches' | 'comparison' | 'charts' | 'wac';

export function CostingPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const realRole = userProfile?.role ?? 'Salesman';

  const canEditOverheads =
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(activeRole) &&
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(realRole);

  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [consumptions, setConsumptions] = useState<ProductionConsumption[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [costings, setCostings] = useState<ProductionCosting[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CostingTab>('products');
  const [selectedProductId, setSelectedProductId] = useState<string>('ALL');

  // Overhead modal state
  const [editingBatch, setEditingBatch] = useState<BatchCostBreakdown | null>(null);
  const [labourInput, setLabourInput] = useState('0');
  const [utilityInput, setUtilityInput] = useState('0');
  const [otherInput, setOtherInput] = useState('0');
  const [notesInput, setNotesInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Batch detail inspection
  const [inspectingBatch, setInspectingBatch] = useState<BatchCostBreakdown | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const unsubOrders = onSnapshot(
      query(collection(db, 'productionOrders'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setProductionOrders(snap.docs.map((d) => d.data() as ProductionOrder));
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setLoadError('Unable to load production orders for costing.');
        handleFirestoreError(err, OperationType.LIST, 'productionOrders');
      },
    );

    const unsubCons = onSnapshot(
      query(collection(db, 'productionConsumption'), where('orgId', '==', ORG_ID)),
      (snap) => setConsumptions(snap.docs.map((d) => d.data() as ProductionConsumption)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'productionConsumption'),
    );

    const unsubMats = onSnapshot(
      query(collection(db, 'rawMaterials'), where('orgId', '==', ORG_ID)),
      (snap) => setMaterials(snap.docs.map((d) => d.data() as RawMaterial)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'rawMaterials'),
    );

    const unsubPurchases = onSnapshot(
      query(collection(db, 'purchases'), where('orgId', '==', ORG_ID)),
      (snap) => setPurchases(snap.docs.map((d) => d.data() as Purchase)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'purchases'),
    );

    const unsubPurchaseItems = onSnapshot(
      query(collection(db, 'purchaseItems'), where('orgId', '==', ORG_ID)),
      (snap) => setPurchaseItems(snap.docs.map((d) => d.data() as PurchaseItem)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'purchaseItems'),
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), where('orgId', '==', ORG_ID)),
      (snap) => setProducts(snap.docs.map((d) => d.data() as Product)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products'),
    );

    const unsubCostings = onSnapshot(
      query(collection(db, 'productionCostings'), where('orgId', '==', ORG_ID)),
      (snap) => setCostings(snap.docs.map((d) => d.data() as ProductionCosting)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'productionCostings'),
    );

    return () => {
      unsubOrders();
      unsubCons();
      unsubMats();
      unsubPurchases();
      unsubPurchaseItems();
      unsubProducts();
      unsubCostings();
    };
  }, [firebaseUser]);

  const wacMap = useMemo(
    () => calculateWeightedAverageMaterialCosts(materials, purchases, purchaseItems),
    [materials, purchases, purchaseItems],
  );

  const wacList = useMemo(
    () => Array.from(wacMap.values()).sort((a, b) => a.materialName.localeCompare(b.materialName)),
    [wacMap],
  );

  const { batches, productSummaries } = useMemo(
    () =>
      calculateBatchAndProductCosting({
        productionOrders,
        consumptions,
        materials,
        products,
        wacMap,
        costings,
      }),
    [productionOrders, consumptions, materials, products, wacMap, costings],
  );

  const kpis = useMemo(() => {
    const completedBatches = batches.filter((b) => b.status === 'Completed');
    const totalMfgCost = roundCurrency(
      completedBatches.reduce((s, b) => s + b.totalProductionCost, 0),
    );
    const totalGoodPackets = completedBatches.reduce((s, b) => s + b.actualGoodQuantity, 0);
    const weightedAvgCostPerPkt =
      totalGoodPackets > 0 ? roundCurrency(totalMfgCost / totalGoodPackets) : null;
    const missingOverheads = completedBatches.filter((b) => !b.hasOverheadEntry).length;
    const profitableProducts = productSummaries.filter(
      (p) => p.profitMarginPercent !== null && p.profitMarginPercent > 0,
    ).length;

    return {
      completedCount: completedBatches.length,
      totalMfgCost,
      weightedAvgCostPerPkt,
      missingOverheads,
      profitableProducts,
      productCount: productSummaries.length,
    };
  }, [batches, productSummaries]);

  const comparisonBatches = useMemo(() => {
    const completed = batches.filter((b) => b.status === 'Completed' && b.actualGoodQuantity > 0);
    if (selectedProductId === 'ALL') return completed;
    return completed.filter((b) => b.productId === selectedProductId);
  }, [batches, selectedProductId]);

  const productSummaryById = useMemo(
    () => new Map(productSummaries.map((p) => [p.productId, p])),
    [productSummaries],
  );

  const openOverheadModal = (batch: BatchCostBreakdown) => {
    setEditingBatch(batch);
    setLabourInput(String(batch.labourCost));
    setUtilityInput(String(batch.gasElectricityCost));
    setOtherInput(String(batch.otherExpenses));
    setNotesInput(batch.costingRecord?.notes ?? '');
    setFormError(null);
  };

  const handleSaveOverhead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !userProfile || !canEditOverheads || !editingBatch) return;

    const check = validateProductionCostingInput({
      labourCost: labourInput,
      gasElectricityCost: utilityInput,
      otherExpenses: otherInput,
      notes: notesInput,
    });
    if (!check.valid) {
      setFormError(check.error);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await runTransaction(db, async (tx) => {
        const costingRef = doc(db, 'productionCostings', editingBatch.productionOrderId);
        const orderRef = doc(db, 'productionOrders', editingBatch.productionOrderId);
        const [costSnap, orderSnap] = await Promise.all([tx.get(costingRef), tx.get(orderRef)]);

        if (!orderSnap.exists()) {
          throw new Error('Linked production order no longer exists.');
        }

        const clean = check.sanitized;
        const auditRef = doc(collection(db, 'auditLogs'));

        if (costSnap.exists()) {
          tx.update(costingRef, {
            labourCost: clean.labourCost,
            gasElectricityCost: clean.gasElectricityCost,
            otherExpenses: clean.otherExpenses,
            notes: clean.notes,
            recordedBy: firebaseUser.uid,
            recordedByName: userProfile.displayName,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(costingRef, {
            id: editingBatch.productionOrderId,
            orgId: ORG_ID,
            productionOrderId: editingBatch.productionOrderId,
            orderNumber: editingBatch.orderNumber,
            productId: editingBatch.productId,
            productName: editingBatch.productName,
            productionDate: editingBatch.productionDate,
            labourCost: clean.labourCost,
            gasElectricityCost: clean.gasElectricityCost,
            otherExpenses: clean.otherExpenses,
            notes: clean.notes,
            recordedBy: firebaseUser.uid,
            recordedByName: userProfile.displayName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        tx.set(auditRef, {
          id: auditRef.id,
          orgId: ORG_ID,
          action: costSnap.exists() ? 'COSTING_OVERHEAD_UPDATED' : 'COSTING_OVERHEAD_RECORDED',
          module: 'Product Costing',
          recordId: editingBatch.productionOrderId,
          recordLabel: editingBatch.orderNumber,
          details: `Saved overheads for ${editingBatch.productName} (${editingBatch.orderNumber}): Labour ₹${clean.labourCost.toFixed(2)}, Gas & Elec ₹${clean.gasElectricityCost.toFixed(2)}, Other ₹${clean.otherExpenses.toFixed(2)}.`,
          userUid: firebaseUser.uid,
          userName: userProfile.displayName,
          userRole: realRole,
          createdAt: serverTimestamp(),
        });
      });

      setEditingBatch(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save production expenses.';
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(
          err,
          OperationType.WRITE,
          `productionCostings/${editingBatch.productionOrderId}`,
        );
      }
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const maxChartPrice = useMemo(() => {
    let m = 1;
    productSummaries.forEach((p) => {
      m = Math.max(m, p.sellingPricePerPacket ?? 0, p.costPerGoodPacket ?? 0);
    });
    return m;
  }, [productSummaries]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Finance &amp; Governance</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            Product Costing &amp; Margin Analysis
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Actual manufacturing cost rollup using Weighted Average Cost (WAC) for raw &amp; packaging materials plus verified batch labour and utilities.
          </p>
        </div>

        <div className="text-xs bg-slate-100 border border-[#DCE6E6] rounded-lg px-3 py-2 text-slate-700 shrink-0">
          Valuation Method: <strong>Weighted Average Cost (WAC)</strong>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Completed Batches Costed</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {kpis.completedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {kpis.missingOverheads > 0
              ? `${kpis.missingOverheads} awaiting overhead entry (₹0)`
              : 'All batches have overhead entries'}
          </p>
        </div>
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Production Cost</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            ₹{kpis.totalMfgCost.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Actual material + packaging + overheads</p>
        </div>
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Avg Cost / Good Packet</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {kpis.weightedAvgCostPerPkt !== null
              ? `₹${kpis.weightedAvgCostPerPkt.toFixed(2)}`
              : 'N/A'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Weighted across completed good output</p>
        </div>
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Profitable Products</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
            {kpis.profitableProducts} / {kpis.productCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Selling price &gt; manufacturing cost</p>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#DCE6E6] pb-3">
        {(
          [
            { id: 'products', label: 'Product Cost Breakdown', icon: Package },
            { id: 'batches', label: 'Production Batch Costing', icon: Calculator },
            { id: 'comparison', label: 'Batch Cost Comparison', icon: Layers },
            { id: 'charts', label: 'Price vs. Cost Charts', icon: BarChart3 },
            { id: 'wac', label: 'WAC Material Valuation', icon: TrendingUp },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[36px] inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-[#DCE6E6] hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Product-Wise Cost Breakdown */}
      {activeTab === 'products' && (
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Product-Wise Manufacturing Cost &amp; Profitability
              </h2>
              <p className="text-xs text-slate-500">
                Aggregated exclusively from completed production runs. Unentered overhead expenses remain ₹0.00 (never invented).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Finished Product</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Good Pkts</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Raw Material</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Packaging</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Labour</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Gas &amp; Elec</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Other Exp</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Total Cost</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Cost/Pkt</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Sell Price</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Profit/Pkt</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={12} className="px-5 py-12 text-center text-sm text-slate-500">
                      Calculating product costing...
                    </td>
                  </tr>
                ) : productSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-12 text-center text-sm text-slate-500">
                      Complete at least one production order with good packet output to view product-wise costing.
                    </td>
                  </tr>
                ) : (
                  productSummaries.map((p) => (
                    <tr key={p.productId} className="hover:bg-slate-50/70 font-mono tabular-nums">
                      <td className="px-4 py-3 font-sans">
                        <p className="font-semibold text-[#3B4F4E]">
                          {p.productName} ({p.packetSize})
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {p.productSku} · {p.batchCount} batch{p.batchCount === 1 ? '' : 'es'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">{p.totalGoodPackets}</td>
                      <td className="px-4 py-3 text-right text-slate-700">₹{p.rawMaterialCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">₹{p.packagingMaterialCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">₹{p.labourCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">₹{p.gasElectricityCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">₹{p.otherExpenses.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#3B4F4E]">
                        ₹{p.totalProductionCost.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#3B4F4E]">
                        {p.costPerGoodPacket !== null ? `₹${p.costPerGoodPacket.toFixed(2)}` : 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">
                        {p.sellingPricePerPacket !== null
                          ? `₹${p.sellingPricePerPacket.toFixed(2)}`
                          : 'N/A'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          (p.profitPerPacket ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {p.profitPerPacket !== null ? `₹${p.profitPerPacket.toFixed(2)}` : 'N/A'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          (p.profitMarginPercent ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {p.profitMarginPercent !== null ? `${p.profitMarginPercent.toFixed(1)}%` : 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Production Batch Costing */}
      {activeTab === 'batches' && (
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Batch-by-Batch Manufacturing Cost &amp; Overhead Expenses
              </h2>
              <p className="text-xs text-slate-500">
                {canEditOverheads
                  ? 'Click "Record Expenses" on any batch to enter actual Labour, Gas & Electricity, and Other Production Expenses.'
                  : 'Production Supervisors have read-only inspection of batch material and overhead costs.'}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Batch Order</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Product</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Good Pkts</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Material + Pkg</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Overheads</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Total Cost</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Cost / Pkt</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-sm text-slate-500">
                      No active or completed production batches recorded yet.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.productionOrderId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="font-mono font-semibold text-[#3B4F4E]">{b.orderNumber}</p>
                        <p className="font-mono text-[11px] text-slate-500">{b.productionDate}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#3B4F4E]">
                          {b.productName} ({b.packetSize})
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-medium ${
                            b.status === 'Completed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : b.status === 'In Progress'
                                ? 'bg-[#EEF3F3] text-[#3B4F4E] border-[#DCE6E6]'
                                : 'bg-slate-100 text-slate-700 border-[#DCE6E6]'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-right tabular-nums">
                        {b.actualGoodQuantity > 0 ? b.actualGoodQuantity : `Plan ${b.plannedQuantity}`}
                      </td>
                      <td className="px-4 py-3 font-mono text-right tabular-nums">
                        <p className="text-[#3B4F4E]">
                          ₹{(b.rawMaterialCost + b.packagingMaterialCost).toFixed(2)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          RM ₹{b.rawMaterialCost.toFixed(0)} + Pkg ₹{b.packagingMaterialCost.toFixed(0)}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-right tabular-nums">
                        {b.hasOverheadEntry ? (
                          <div>
                            <p className="text-[#3B4F4E]">₹{b.totalOverheadCost.toFixed(2)}</p>
                            <p className="text-[11px] text-slate-500">
                              L:{b.labourCost.toFixed(0)} · U:{b.gasElectricityCost.toFixed(0)} · O:{b.otherExpenses.toFixed(0)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-amber-700 font-sans text-[11px]">
                            Not recorded (₹0)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-right tabular-nums text-[#3B4F4E]">
                        ₹{b.totalProductionCost.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-right tabular-nums text-[#3B4F4E]">
                        {b.costPerGoodPacket !== null ? `₹${b.costPerGoodPacket.toFixed(2)}` : 'Pending'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setInspectingBatch(b)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md"
                          >
                            Breakdown
                          </button>
                          {canEditOverheads && (
                            <button
                              type="button"
                              onClick={() => openOverheadModal(b)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-md"
                            >
                              <Edit3 className="w-3 h-3" />
                              {b.hasOverheadEntry ? 'Edit Exp.' : 'Add Exp.'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Cost Comparison Between Batches */}
      {activeTab === 'comparison' && (
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Batch-to-Batch Cost Comparison
              </h2>
              <p className="text-xs text-slate-500">
                Compare each completed batch&apos;s packet cost against the product average and selling price.
              </p>
            </div>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              aria-label="Filter batch comparison by product"
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg"
            >
              <option value="ALL">All Products</option>
              {productSummaries.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.productName} ({p.packetSize})
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Batch Order</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Product</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Good Qty</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Batch Cost/Pkt</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Product Avg/Pkt</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Variance vs Avg</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Selling Price</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Batch Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                {comparisonBatches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center font-sans text-sm text-slate-500">
                      No completed batches with good output available for comparison.
                    </td>
                  </tr>
                ) : (
                  comparisonBatches.map((b) => {
                    const summary = productSummaryById.get(b.productId);
                    const avg = summary?.costPerGoodPacket ?? null;
                    const delta =
                      b.costPerGoodPacket !== null && avg !== null
                        ? roundCurrency(b.costPerGoodPacket - avg)
                        : null;
                    return (
                      <tr key={b.productionOrderId} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#3B4F4E]">{b.orderNumber}</p>
                          <p className="text-[11px] text-slate-500">{b.productionDate}</p>
                        </td>
                        <td className="px-4 py-3 font-sans text-slate-800">{b.productName}</td>
                        <td className="px-4 py-3 text-right">{b.actualGoodQuantity}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#3B4F4E]">
                          {b.costPerGoodPacket !== null ? `₹${b.costPerGoodPacket.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {avg !== null ? `₹${avg.toFixed(2)}` : '—'}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${
                            delta === null
                              ? 'text-slate-400'
                              : delta > 0
                                ? 'text-red-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {delta !== null ? `${delta > 0 ? '+' : ''}₹${delta.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {b.sellingPricePerPacket !== null
                            ? `₹${b.sellingPricePerPacket.toFixed(2)}`
                            : '—'}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${
                            (b.profitMarginPercent ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {b.profitMarginPercent !== null ? `${b.profitMarginPercent.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Selling Price vs Production Cost & Profitability Charts */}
      {activeTab === 'charts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Selling Price vs. Production Cost per Packet
              </h2>
              <p className="text-xs text-slate-500">
                Visual unit margin comparison across finished snack SKUs.
              </p>
            </div>

            {productSummaries.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                Complete production orders to plot selling price vs. production cost.
              </p>
            ) : (
              <div className="space-y-4">
                {productSummaries.map((p) => {
                  const costWidth =
                    p.costPerGoodPacket !== null
                      ? Math.min(100, (p.costPerGoodPacket / maxChartPrice) * 100)
                      : 0;
                  const sellWidth =
                    p.sellingPricePerPacket !== null
                      ? Math.min(100, (p.sellingPricePerPacket / maxChartPrice) * 100)
                      : 0;
                  return (
                    <div key={p.productId} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#3B4F4E]">
                          {p.productName} ({p.packetSize})
                        </span>
                        <span className="font-mono text-slate-600">
                          Cost ₹{p.costPerGoodPacket?.toFixed(2) ?? '0.00'} vs Sell ₹
                          {p.sellingPricePerPacket?.toFixed(2) ?? '0.00'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2.5 bg-slate-100 rounded overflow-hidden">
                          <div
                            className="h-full bg-[#CF9C2D]"
                            style={{ width: `${costWidth}%` }}
                            title={`Production Cost: ₹${p.costPerGoodPacket?.toFixed(2) ?? 0}`}
                          />
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded overflow-hidden">
                          <div
                            className="h-full bg-emerald-600"
                            style={{ width: `${sellWidth}%` }}
                            title={`Selling Price: ₹${p.sellingPricePerPacket?.toFixed(2) ?? 0}`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 flex items-center gap-4 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#CF9C2D]" />
                    Production Cost / Packet
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
                    Selling Price / Packet
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Profitability &amp; Cost Composition Share
              </h2>
              <p className="text-xs text-slate-500">
                Cost split across Ingredients, Packaging, Labour, Utilities &amp; Other Expenses.
              </p>
            </div>

            {productSummaries.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                No product costing composition available yet.
              </p>
            ) : (
              <div className="space-y-4">
                {productSummaries.map((p) => {
                  const total = Math.max(0.01, p.totalProductionCost);
                  const rmPct = (p.rawMaterialCost / total) * 100;
                  const pkgPct = (p.packagingMaterialCost / total) * 100;
                  const labPct = (p.labourCost / total) * 100;
                  const utilPct = ((p.gasElectricityCost + p.otherExpenses) / total) * 100;
                  return (
                    <div key={p.productId} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#3B4F4E]">{p.productName}</span>
                        <span
                          className={`font-mono font-semibold ${
                            (p.profitMarginPercent ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          Margin {p.profitMarginPercent !== null ? `${p.profitMarginPercent.toFixed(1)}%` : 'N/A'}
                        </span>
                      </div>
                      <div className="h-3 w-full bg-slate-100 rounded overflow-hidden flex">
                        <div className="h-full bg-indigo-600" style={{ width: `${rmPct}%` }} title={`Raw Material ${rmPct.toFixed(1)}%`} />
                        <div className="h-full bg-amber-500" style={{ width: `${pkgPct}%` }} title={`Packaging ${pkgPct.toFixed(1)}%`} />
                        <div className="h-full bg-cyan-600" style={{ width: `${labPct}%` }} title={`Labour ${labPct.toFixed(1)}%`} />
                        <div className="h-full bg-rose-500" style={{ width: `${utilPct}%` }} title={`Utilities & Other ${utilPct.toFixed(1)}%`} />
                      </div>
                      <div className="flex flex-wrap justify-between text-[11px] font-mono text-slate-500">
                        <span>RM {rmPct.toFixed(0)}%</span>
                        <span>Pkg {pkgPct.toFixed(0)}%</span>
                        <span>Lab {labPct.toFixed(0)}%</span>
                        <span>Util/Oth {utilPct.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600" /> Ingredients
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" /> Packaging
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-cyan-600" /> Labour
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-rose-500" /> Gas, Elec &amp; Other
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Weighted Average Cost Valuation Table */}
      {activeTab === 'wac' && (
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6]">
            <h2 className="text-base font-semibold text-[#3B4F4E]">
              Weighted Average Cost (WAC) Material Valuation Register
            </h2>
            <p className="text-xs text-slate-500">
              Formula: (Opening Stock × Opening Rate + Received Purchase Subtotal) ÷ (Opening Qty + Received Qty). Packaging categories are separated from ingredients automatically.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Material</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Cost Group</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Opening Qty</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Received Qty</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Received Spend</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">WAC Unit Cost</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-600">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {wacList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                      No raw materials or packaging items registered yet.
                    </td>
                  </tr>
                ) : (
                  wacList.map((m) => (
                    <tr key={m.rawMaterialId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#3B4F4E]">{m.materialName}</p>
                        <p className="font-mono text-[11px] text-slate-500">
                          {m.materialCode} · {m.category}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-medium ${
                            m.isPackaging
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-[#EEF3F3] text-[#3B4F4E] border-[#DCE6E6]'
                          }`}
                        >
                          {m.isPackaging ? 'Packaging' : 'Raw Material'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-right">
                        {m.openingStock} {m.unit}
                      </td>
                      <td className="px-4 py-3 font-mono text-right">
                        {m.receivedQuantity} {m.unit}
                      </td>
                      <td className="px-4 py-3 font-mono text-right">
                        ₹{m.receivedSubtotal.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-[#3B4F4E] text-right">
                        ₹{m.wacUnitCost.toFixed(2)} / {m.unit}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.valuationSource}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Overhead Entry Modal */}
      {editingBatch && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#3B4F4E]">
                  Production Overhead Expenses · {editingBatch.orderNumber}
                </h2>
                <p className="text-xs text-slate-500">{editingBatch.productName}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingBatch(null)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOverhead} className="p-6 space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3 grid grid-cols-2 gap-3 text-xs font-mono">
                <div>
                  <p className="text-slate-500">Raw Material Cost (WAC)</p>
                  <p className="font-semibold text-[#3B4F4E]">
                    ₹{editingBatch.rawMaterialCost.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Packaging Cost (WAC)</p>
                  <p className="font-semibold text-[#3B4F4E]">
                    ₹{editingBatch.packagingMaterialCost.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="cost-labour" className="block text-xs font-medium text-slate-700 mb-1">
                    Labour Cost (₹) *
                  </label>
                  <input
                    id="cost-labour"
                    type="number"
                    min="0"
                    step="0.01"
                    value={labourInput}
                    onChange={(e) => setLabourInput(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cost-util" className="block text-xs font-medium text-slate-700 mb-1">
                    Gas &amp; Electricity (₹) *
                  </label>
                  <input
                    id="cost-util"
                    type="number"
                    min="0"
                    step="0.01"
                    value={utilityInput}
                    onChange={(e) => setUtilityInput(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cost-other" className="block text-xs font-medium text-slate-700 mb-1">
                    Other Expenses (₹) *
                  </label>
                  <input
                    id="cost-other"
                    type="number"
                    min="0"
                    step="0.01"
                    value={otherInput}
                    onChange={(e) => setOtherInput(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cost-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Expense Notes
                </label>
                <input
                  id="cost-notes"
                  type="text"
                  maxLength={500}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Shift labour hours, LPG cylinder usage, machine depreciation..."
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingBatch(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save Batch Expenses'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Material Breakdown Modal */}
      {inspectingBatch && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-2xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#3B4F4E]">
                  Batch Cost Sheet · {inspectingBatch.orderNumber}
                </h2>
                <p className="text-xs text-slate-500">
                  {inspectingBatch.productName} ({inspectingBatch.packetSize}) ·{' '}
                  {inspectingBatch.productionDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingBatch(null)}
                aria-label="Close breakdown"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">Good Output</p>
                  <p className="font-semibold text-[#3B4F4E] mt-0.5">
                    {inspectingBatch.actualGoodQuantity} pkts
                  </p>
                </div>
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">Total Cost</p>
                  <p className="font-semibold text-[#3B4F4E] mt-0.5">
                    ₹{inspectingBatch.totalProductionCost.toFixed(2)}
                  </p>
                </div>
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">Cost / Packet</p>
                  <p className="font-semibold text-[#3B4F4E] mt-0.5">
                    {inspectingBatch.costPerGoodPacket !== null
                      ? `₹${inspectingBatch.costPerGoodPacket.toFixed(2)}`
                      : 'N/A'}
                  </p>
                </div>
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">Profit / Packet</p>
                  <p
                    className={`font-semibold mt-0.5 ${
                      (inspectingBatch.profitPerPacket ?? 0) >= 0
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {inspectingBatch.profitPerPacket !== null
                      ? `₹${inspectingBatch.profitPerPacket.toFixed(2)}`
                      : 'N/A'}
                  </p>
                </div>
              </div>

              <div className="border border-[#DCE6E6] rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-[#DCE6E6]">
                      <th className="px-3.5 py-2 font-semibold text-slate-600">Material</th>
                      <th className="px-3.5 py-2 font-semibold text-slate-600">Type</th>
                      <th className="px-3.5 py-2 font-semibold text-slate-600 text-right">Qty Used</th>
                      <th className="px-3.5 py-2 font-semibold text-slate-600 text-right">WAC Rate</th>
                      <th className="px-3.5 py-2 font-semibold text-slate-600 text-right">Line Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {inspectingBatch.materialLineDetails.map((line) => (
                      <tr key={line.materialCode}>
                        <td className="px-3.5 py-2 font-medium text-[#3B4F4E]">
                          {line.materialName}
                        </td>
                        <td className="px-3.5 py-2 text-slate-600">
                          {line.isPackaging ? 'Packaging' : 'Raw Material'}
                        </td>
                        <td className="px-3.5 py-2 font-mono text-right">
                          {line.quantityUsed} {line.unit}
                        </td>
                        <td className="px-3.5 py-2 font-mono text-right">
                          ₹{line.wacUnitCost.toFixed(2)}
                        </td>
                        <td className="px-3.5 py-2 font-mono font-semibold text-right">
                          ₹{line.totalCost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3.5 text-xs space-y-1 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-600">Labour Expense:</span>
                  <span>₹{inspectingBatch.labourCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Gas &amp; Electricity:</span>
                  <span>₹{inspectingBatch.gasElectricityCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Other Production Expenses:</span>
                  <span>₹{inspectingBatch.otherExpenses.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
