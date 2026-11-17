import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  Factory,
  Play,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  BLUEPRINT_CONSTRAINTS,
  calculateBomRequirementsForProduction,
  roundCurrency,
  roundQuantity,
  validateProductionCompletionInput,
  validateProductionPlanInput,
  type ProductionConsumptionDraft,
} from '../lib/validation';
import {
  ORG_ID,
  PRODUCTION_STATUSES,
  type Bom,
  type BomItem,
  type ErpUser,
  type Product,
  type ProductionConsumption,
  type ProductionOrder,
  type ProductionStatus,
  type ProductionVariance,
  type RawMaterial,
  type StockBalance,
} from '../types/erp';

type ProductionTab = 'orders' | 'variance';
type StatusFilter = 'All' | ProductionStatus;

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function generateDefaultOrderNumber(existingCount: number): string {
  const year = new Date().getFullYear();
  return `PROD-${year}-${String(existingCount + 1).padStart(4, '0')}`;
}

export function ProductionPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage =
    activeRole === 'Owner' ||
    activeRole === 'Admin' ||
    activeRole === 'Production Supervisor';
  const canDelete = activeRole === 'Owner' || activeRole === 'Admin';
  const canListUsers = activeRole === 'Owner' || activeRole === 'Admin';

  const [activeTab, setActiveTab] = useState<ProductionTab>('orders');
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [consumptions, setConsumptions] = useState<ProductionConsumption[]>([]);
  const [variances, setVariances] = useState<ProductionVariance[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [supervisors, setSupervisors] = useState<ErpUser[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  // Create Production Plan Modal
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [productId, setProductId] = useState('');
  const [bomId, setBomId] = useState('');
  const [plannedQuantity, setPlannedQuantity] = useState('100');
  const [productionDate, setProductionDate] = useState(getTodayIso());
  const [supervisorUid, setSupervisorUid] = useState('');
  const [notes, setNotes] = useState('');
  const [planError, setPlanError] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  // Issue Raw Materials Modal
  const [issuingOrder, setIssuingOrder] = useState<ProductionOrder | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  // Complete Production Modal
  const [completingOrder, setCompletingOrder] = useState<ProductionOrder | null>(null);
  const [actualGoodQuantity, setActualGoodQuantity] = useState('');
  const [damagedQuantity, setDamagedQuantity] = useState('0');
  const [completionNotes, setCompletionNotes] = useState('');
  const [consumptionDrafts, setConsumptionDrafts] = useState<ProductionConsumptionDraft[]>([]);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  // View Order Details Modal
  const [viewingOrder, setViewingOrder] = useState<ProductionOrder | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Delete Order Confirmation Modal
  const [deletingOrder, setDeletingOrder] = useState<ProductionOrder | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    let loadedOrders = false;
    let loadedConsumptions = false;
    const finishIfReady = () => {
      if (loadedOrders && loadedConsumptions) {
        setLoading(false);
      }
    };

    const unsubOrders = onSnapshot(
      query(collection(db, 'productionOrders'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as ProductionOrder);
        rows.sort((a, b) => {
          const dateCmp = b.productionDate.localeCompare(a.productionDate);
          if (dateCmp !== 0) return dateCmp;
          return b.orderNumber.localeCompare(a.orderNumber);
        });
        setOrders(rows);
        loadedOrders = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load production orders from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'productionOrders');
      },
    );

    const unsubConsumptions = onSnapshot(
      query(collection(db, 'productionConsumption'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setConsumptions(snap.docs.map((d) => d.data() as ProductionConsumption));
        loadedConsumptions = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load production consumption records from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'productionConsumption');
      },
    );

    const unsubVariances = onSnapshot(
      query(collection(db, 'productionVariances'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as ProductionVariance);
        rows.sort((a, b) => {
          const dateCmp = b.productionDate.localeCompare(a.productionDate);
          if (dateCmp !== 0) return dateCmp;
          return b.orderNumber.localeCompare(a.orderNumber);
        });
        setVariances(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'productionVariances');
      },
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Product);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );

    const unsubBoms = onSnapshot(
      query(collection(db, 'bom'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Bom);
        rows.sort((a, b) => b.version - a.version);
        setBoms(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bom');
      },
    );

    const unsubBomItems = onSnapshot(
      query(collection(db, 'bomItems'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setBomItems(snap.docs.map((d) => d.data() as BomItem));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bomItems');
      },
    );

    const unsubMaterials = onSnapshot(
      query(collection(db, 'rawMaterials'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as RawMaterial);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setMaterials(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'rawMaterials');
      },
    );

    let unsubUsers = () => {};
    if (canListUsers) {
      unsubUsers = onSnapshot(
        collection(db, 'users'),
        (snap) => {
          const rows = snap.docs
            .map((d) => d.data() as ErpUser)
            .filter(
              (u) =>
                u.status === 'Active' &&
                (u.role === 'Production Supervisor' || u.role === 'Admin' || u.role === 'Owner'),
            );
          rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
          setSupervisors(rows);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'users');
        },
      );
    }

    return () => {
      unsubOrders();
      unsubConsumptions();
      unsubVariances();
      unsubProducts();
      unsubBoms();
      unsubBomItems();
      unsubMaterials();
      unsubUsers();
    };
  }, [firebaseUser, canListUsers]);

  const consumptionsByOrderId = useMemo(() => {
    const map = new Map<string, ProductionConsumption[]>();
    consumptions.forEach((item) => {
      const list = map.get(item.productionOrderId);
      if (list) list.push(item);
      else map.set(item.productionOrderId, [item]);
    });
    return map;
  }, [consumptions]);

  const varianceByOrderId = useMemo(
    () => new Map(variances.map((v) => [v.productionOrderId, v])),
    [variances],
  );

  const bomsByProduct = useMemo(() => {
    const map = new Map<string, Bom[]>();
    boms.forEach((b) => {
      const list = map.get(b.productId);
      if (list) list.push(b);
      else map.set(b.productId, [b]);
    });
    return map;
  }, [boms]);

  const pickPreferredBom = (prodId: string): Bom | undefined => {
    const list = bomsByProduct.get(prodId) ?? [];
    return (
      list.find((b) => b.status === 'Active') ??
      list.find((b) => b.status !== 'Archived') ??
      list[0]
    );
  };

  const selectedProductBoms = useMemo(
    () => (productId ? bomsByProduct.get(productId) ?? [] : []),
    [productId, bomsByProduct],
  );

  const selectedBom = useMemo(
    () => boms.find((b) => b.id === bomId) ?? null,
    [boms, bomId],
  );

  const liveRequirements = useMemo(() => {
    if (!selectedBom) return null;
    const scopedItems = bomItems.filter((item) => item.bomId === selectedBom.id);
    const qty = Number(plannedQuantity);
    return calculateBomRequirementsForProduction(selectedBom, scopedItems, qty, materials);
  }, [selectedBom, bomItems, plannedQuantity, materials]);

  const supervisorOptions = useMemo(() => {
    if (canListUsers && supervisors.length > 0) return supervisors;
    if (userProfile) return [userProfile];
    return [];
  }, [canListUsers, supervisors, userProfile]);

  const summary = useMemo(() => {
    let planned = 0;
    let inProgress = 0;
    let completed = 0;
    let totalGood = 0;
    let totalDamaged = 0;

    orders.forEach((o) => {
      if (o.status === 'Planned') planned += 1;
      else if (o.status === 'In Progress') inProgress += 1;
      else if (o.status === 'Completed') {
        completed += 1;
        totalGood += o.actualGoodQuantity;
        totalDamaged += o.damagedQuantity;
      }
    });

    return {
      total: orders.length,
      planned,
      inProgress,
      completed,
      totalGood: roundQuantity(totalGood),
      totalDamaged: roundQuantity(totalDamaged),
    };
  }, [orders]);

  const varianceSummary = useMemo(() => {
    if (variances.length === 0) {
      return {
        runs: 0,
        expectedQty: 0,
        actualGoodQty: 0,
        damagedQty: 0,
        yieldEfficiencyPct: 0,
        yieldVarianceQty: 0,
        expectedMatCost: 0,
        actualMatCost: 0,
        costVariance: 0,
        damagedMaterialQty: 0,
      };
    }

    let expectedQty = 0;
    let actualGoodQty = 0;
    let damagedQty = 0;
    let expectedMatCost = 0;
    let actualMatCost = 0;
    let damagedMaterialQty = 0;

    variances.forEach((v) => {
      expectedQty += v.expectedQuantity;
      actualGoodQty += v.actualGoodQuantity;
      damagedQty += v.damagedQuantity;
      expectedMatCost += v.expectedMaterialCost;
      actualMatCost += v.actualMaterialCost;
      damagedMaterialQty += v.damagedMaterialQty;
    });

    const yieldVarianceQty = roundQuantity(actualGoodQty - expectedQty);
    const yieldEfficiencyPct =
      expectedQty > 0 ? roundCurrency((actualGoodQty / expectedQty) * 100) : 0;

    return {
      runs: variances.length,
      expectedQty: roundQuantity(expectedQty),
      actualGoodQty: roundQuantity(actualGoodQty),
      damagedQty: roundQuantity(damagedQty),
      yieldEfficiencyPct,
      yieldVarianceQty,
      expectedMatCost: roundCurrency(expectedMatCost),
      actualMatCost: roundCurrency(actualMatCost),
      costVariance: roundCurrency(actualMatCost - expectedMatCost),
      damagedMaterialQty: roundQuantity(damagedMaterialQty),
    };
  }, [variances]);

  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return orders.filter((o) => {
      const matchesStatus = statusFilter === 'All' || o.status === statusFilter;
      const matchesSearch =
        !term ||
        o.orderNumber.toLowerCase().includes(term) ||
        o.productName.toLowerCase().includes(term) ||
        o.productSku.toLowerCase().includes(term) ||
        o.bomCode.toLowerCase().includes(term) ||
        o.supervisorName.toLowerCase().includes(term) ||
        o.productionDate.includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [orders, searchTerm, statusFilter]);

  const filteredVariances = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return variances.filter(
      (v) =>
        !term ||
        v.orderNumber.toLowerCase().includes(term) ||
        v.productName.toLowerCase().includes(term) ||
        v.productionDate.includes(term),
    );
  }, [variances, searchTerm]);

  const openCreatePlanModal = () => {
    const firstProduct = products.find((p) => (bomsByProduct.get(p.id) ?? []).length > 0) ?? products[0];
    const preferredBom = firstProduct ? pickPreferredBom(firstProduct.id) : undefined;
    const defaultSupervisor =
      supervisorOptions.find((u) => u.uid === userProfile?.uid) ?? supervisorOptions[0];

    setOrderNumber(generateDefaultOrderNumber(orders.length));
    setProductId(firstProduct?.id ?? '');
    setBomId(preferredBom?.id ?? '');
    setPlannedQuantity(preferredBom ? String(preferredBom.batchSize) : '100');
    setProductionDate(getTodayIso());
    setSupervisorUid(defaultSupervisor?.uid ?? firebaseUser?.uid ?? '');
    setNotes('');
    setPlanError(null);
    setPlanModalOpen(true);
  };

  const handleProductSelectionChange = (nextProdId: string) => {
    setProductId(nextProdId);
    const preferredBom = pickPreferredBom(nextProdId);
    setBomId(preferredBom?.id ?? '');
    if (preferredBom) {
      setPlannedQuantity(String(preferredBom.batchSize));
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage) return;

    const chosenSup = supervisorOptions.find((s) => s.uid === supervisorUid);
    const supervisorName = chosenSup?.displayName ?? userProfile?.displayName ?? 'Supervisor';

    const validation = validateProductionPlanInput(
      {
        orderNumber,
        productId,
        bomId,
        plannedQuantity,
        productionDate,
        supervisorUid,
        supervisorName,
        notes,
      },
      products,
      boms,
      bomItems,
      materials,
    );

    if (!validation.valid) {
      setPlanError(validation.error);
      return;
    }

    const duplicateOrder = orders.find(
      (o) => o.orderNumber === validation.sanitized.orderNumber,
    );
    if (duplicateOrder) {
      setPlanError(`Production order number "${validation.sanitized.orderNumber}" already exists.`);
      return;
    }

    setSavingPlan(true);
    setPlanError(null);

    try {
      const batch = writeBatch(db);
      const orderRef = doc(collection(db, 'productionOrders'));
      const { requirements, ...orderHeader } = validation.sanitized;

      batch.set(orderRef, {
        id: orderRef.id,
        orgId: ORG_ID,
        ...orderHeader,
        actualGoodQuantity: 0,
        damagedQuantity: 0,
        status: 'Planned',
        materialsIssued: false,
        finishedGoodsPosted: false,
        createdBy: firebaseUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      requirements.forEach((req) => {
        const consRef = doc(collection(db, 'productionConsumption'));
        batch.set(consRef, {
          id: consRef.id,
          orgId: ORG_ID,
          productionOrderId: orderRef.id,
          rawMaterialId: req.rawMaterialId,
          materialName: req.materialName,
          materialCode: req.materialCode,
          unit: req.unit,
          expectedQuantity: req.expectedQuantity,
          issuedQuantity: 0,
          actualConsumedQuantity: 0,
          damagedMaterialQuantity: 0,
          varianceQuantity: 0,
          unitCost: req.unitCost,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
      setPlanModalOpen(false);
      setActionBanner(`Production plan ${orderHeader.orderNumber} created and BOM requirements verified.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.CREATE, 'productionOrders');
      }
      setPlanError('Failed to save production plan to Cloud Firestore.');
    } finally {
      setSavingPlan(false);
    }
  };

  const openIssueModal = (order: ProductionOrder) => {
    setIssuingOrder(order);
    setIssueError(null);
  };

  const handleConfirmIssue = async () => {
    if (!firebaseUser || !canManage || !issuingOrder) return;
    const orderConsumptions = consumptionsByOrderId.get(issuingOrder.id) ?? [];
    if (orderConsumptions.length === 0) {
      setIssueError('No raw material requirements found for this production order.');
      return;
    }

    setIssuing(true);
    setIssueError(null);
    const operatorName = (userProfile?.displayName || 'ERP Operator').slice(
      0,
      BLUEPRINT_CONSTRAINTS.displayName.maxLength,
    );
    const todayIso = getTodayIso();

    try {
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, 'productionOrders', issuingOrder.id);
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error('Production order no longer exists.');
        }
        const liveOrder = orderSnap.data() as ProductionOrder;
        if (liveOrder.status !== 'Planned' || liveOrder.materialsIssued) {
          throw new Error(
            `Materials cannot be issued because order status is "${liveOrder.status}".`,
          );
        }

        const wipBalRef = doc(db, 'stockBalances', `wip_${liveOrder.productId}`);
        const wipSnap = await transaction.get(wipBalRef);

        const materialChecks: Array<{
          consRef: ReturnType<typeof doc>;
          consData: ProductionConsumption;
          matRef: ReturnType<typeof doc>;
          matData: RawMaterial;
          balRef: ReturnType<typeof doc>;
          balExists: boolean;
          balData: StockBalance | null;
          newStock: number;
        }> = [];

        for (const cons of orderConsumptions) {
          const consRef = doc(db, 'productionConsumption', cons.id);
          const matRef = doc(db, 'rawMaterials', cons.rawMaterialId);
          const balRef = doc(db, 'stockBalances', `rm_${cons.rawMaterialId}`);

          const [consSnap, matSnap, balSnap] = await Promise.all([
            transaction.get(consRef),
            transaction.get(matRef),
            transaction.get(balRef),
          ]);

          if (!consSnap.exists()) {
            throw new Error(`Consumption line for ${cons.materialName} no longer exists.`);
          }
          if (!matSnap.exists()) {
            throw new Error(`Raw material ${cons.materialName} no longer exists.`);
          }

          const liveCons = consSnap.data() as ProductionConsumption;
          const liveMat = matSnap.data() as RawMaterial;
          const newStock = roundQuantity(liveMat.currentStock - liveCons.expectedQuantity);
          if (newStock < 0) {
            throw new Error(
              `Insufficient stock for ${liveMat.name} (${liveMat.materialCode}): required ${liveCons.expectedQuantity} ${liveMat.unit}, available ${liveMat.currentStock} ${liveMat.unit}.`,
            );
          }

          materialChecks.push({
            consRef,
            consData: liveCons,
            matRef,
            matData: liveMat,
            balRef,
            balExists: balSnap.exists(),
            balData: balSnap.exists() ? (balSnap.data() as StockBalance) : null,
            newStock,
          });
        }

        for (const item of materialChecks) {
          transaction.update(item.matRef, {
            currentStock: item.newStock,
            updatedAt: serverTimestamp(),
          });

          if (item.balExists && item.balData) {
            transaction.update(item.balRef, {
              itemCode: item.matData.materialCode,
              itemName: item.matData.name,
              unit: item.matData.unit,
              issuedToProduction: roundQuantity(
                item.balData.issuedToProduction + item.consData.expectedQuantity,
              ),
              currentBalance: item.newStock,
              minimumStockLevel: item.matData.minimumStockLevel,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              updatedAt: serverTimestamp(),
            });
          } else {
            transaction.set(item.balRef, {
              id: item.balRef.id,
              orgId: ORG_ID,
              itemId: item.matData.id,
              itemCode: item.matData.materialCode,
              itemName: item.matData.name,
              stockCategory: 'raw_material',
              unit: item.matData.unit,
              openingStock: item.matData.openingStock,
              receivedFromPurchases: 0,
              issuedToProduction: item.consData.expectedQuantity,
              receivedFromProduction: 0,
              dispatchedThroughSales: 0,
              adjustmentsNet: 0,
              currentBalance: item.newStock,
              minimumStockLevel: item.matData.minimumStockLevel,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          transaction.update(item.consRef, {
            issuedQuantity: item.consData.expectedQuantity,
            updatedAt: serverTimestamp(),
          });

          const rmLedgerRef = doc(collection(db, 'inventoryLedger'));
          transaction.set(rmLedgerRef, {
            id: rmLedgerRef.id,
            orgId: ORG_ID,
            transactionDate: todayIso,
            itemId: item.matData.id,
            itemCode: item.matData.materialCode,
            itemName: item.matData.name,
            stockCategory: 'raw_material',
            unit: item.matData.unit,
            transactionType: 'Production Issue',
            quantityIn: 0,
            quantityOut: item.consData.expectedQuantity,
            balance: item.newStock,
            referenceDoc: liveOrder.orderNumber,
            reason: `Materials issued for ${liveOrder.productName} (${liveOrder.expectedQuantity} pkts)`.slice(
              0,
              300,
            ),
            userUid: firebaseUser.uid,
            userName: operatorName,
            createdAt: serverTimestamp(),
          });
        }

        const prevWipBal = wipSnap.exists() ? (wipSnap.data() as StockBalance) : null;
        const newWipBalance = roundQuantity(
          (prevWipBal?.currentBalance ?? 0) + liveOrder.expectedQuantity,
        );
        if (prevWipBal) {
          transaction.update(wipBalRef, {
            itemCode: liveOrder.productSku,
            itemName: `${liveOrder.productName} (WIP)`.slice(0, 120),
            unit: 'packets',
            receivedFromProduction: roundQuantity(
              prevWipBal.receivedFromProduction + liveOrder.expectedQuantity,
            ),
            currentBalance: newWipBalance,
            updatedBy: firebaseUser.uid,
            updatedByName: operatorName,
            updatedAt: serverTimestamp(),
          });
        } else {
          transaction.set(wipBalRef, {
            id: wipBalRef.id,
            orgId: ORG_ID,
            itemId: liveOrder.productId,
            itemCode: liveOrder.productSku,
            itemName: `${liveOrder.productName} (WIP)`.slice(0, 120),
            stockCategory: 'wip',
            unit: 'packets',
            openingStock: 0,
            receivedFromPurchases: 0,
            issuedToProduction: 0,
            receivedFromProduction: liveOrder.expectedQuantity,
            dispatchedThroughSales: 0,
            adjustmentsNet: 0,
            currentBalance: newWipBalance,
            minimumStockLevel: 0,
            updatedBy: firebaseUser.uid,
            updatedByName: operatorName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        const wipLedgerRef = doc(collection(db, 'inventoryLedger'));
        transaction.set(wipLedgerRef, {
          id: wipLedgerRef.id,
          orgId: ORG_ID,
          transactionDate: todayIso,
          itemId: liveOrder.productId,
          itemCode: liveOrder.productSku,
          itemName: `${liveOrder.productName} (WIP)`.slice(0, 120),
          stockCategory: 'wip',
          unit: 'packets',
          transactionType: 'WIP Issue',
          quantityIn: liveOrder.expectedQuantity,
          quantityOut: 0,
          balance: newWipBalance,
          referenceDoc: liveOrder.orderNumber,
          reason: `Work-in-progress batch started (${liveOrder.bomCode} v${liveOrder.bomVersion})`.slice(
            0,
            300,
          ),
          userUid: firebaseUser.uid,
          userName: operatorName,
          createdAt: serverTimestamp(),
        });

        transaction.update(orderRef, {
          status: 'In Progress',
          materialsIssued: true,
          issuedBy: firebaseUser.uid,
          issuedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setActionBanner(`Raw materials issued and batch ${issuingOrder.orderNumber} moved to In Progress.`);
      setIssuingOrder(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `productionOrders/${issuingOrder.id}`);
      }
      setIssueError(msg || 'Failed to issue raw materials for production.');
    } finally {
      setIssuing(false);
    }
  };

  const openCompleteModal = (order: ProductionOrder) => {
    const orderCons = consumptionsByOrderId.get(order.id) ?? [];
    setCompletingOrder(order);
    setActualGoodQuantity(String(order.expectedQuantity));
    setDamagedQuantity('0');
    setCompletionNotes(order.notes);
    setConsumptionDrafts(
      orderCons.map((c) => ({
        id: c.id,
        actualConsumedQuantity: String(c.issuedQuantity || c.expectedQuantity),
        damagedMaterialQuantity: '0',
      })),
    );
    setCompleteError(null);
  };

  const liveCompletionPreview = useMemo(() => {
    if (!completingOrder) return null;
    const orderCons = consumptionsByOrderId.get(completingOrder.id) ?? [];
    return validateProductionCompletionInput(
      {
        actualGoodQuantity,
        damagedQuantity,
        notes: completionNotes,
        consumptions: consumptionDrafts,
      },
      completingOrder.expectedQuantity,
      orderCons,
      materials,
    );
  }, [
    completingOrder,
    actualGoodQuantity,
    damagedQuantity,
    completionNotes,
    consumptionDrafts,
    consumptionsByOrderId,
    materials,
  ]);

  const handleConfirmComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage || !completingOrder) return;

    const orderConsumptions = consumptionsByOrderId.get(completingOrder.id) ?? [];
    const validation = validateProductionCompletionInput(
      {
        actualGoodQuantity,
        damagedQuantity,
        notes: completionNotes,
        consumptions: consumptionDrafts,
      },
      completingOrder.expectedQuantity,
      orderConsumptions,
      materials,
    );

    if (!validation.valid) {
      setCompleteError(validation.error);
      return;
    }

    setCompleting(true);
    setCompleteError(null);
    const operatorName = (userProfile?.displayName || 'ERP Operator').slice(
      0,
      BLUEPRINT_CONSTRAINTS.displayName.maxLength,
    );
    const todayIso = getTodayIso();

    try {
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, 'productionOrders', completingOrder.id);
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error('Production order no longer exists.');
        }
        const liveOrder = orderSnap.data() as ProductionOrder;
        if (
          liveOrder.status !== 'In Progress' ||
          !liveOrder.materialsIssued ||
          liveOrder.finishedGoodsPosted
        ) {
          throw new Error(
            'This production order is already completed or has not had materials issued yet.',
          );
        }

        const wipRef = doc(db, 'stockBalances', `wip_${liveOrder.productId}`);
        const fgRef = doc(db, 'stockBalances', `fg_${liveOrder.productId}`);
        const dmgFgRef = doc(db, 'stockBalances', `dmg_fg_${liveOrder.productId}`);

        const [wipSnap, fgSnap, dmgFgSnap] = await Promise.all([
          transaction.get(wipRef),
          transaction.get(fgRef),
          transaction.get(dmgFgRef),
        ]);

        const lineState: Array<{
          line: (typeof validation.sanitized.lines)[number];
          consRef: ReturnType<typeof doc>;
          matRef: ReturnType<typeof doc>;
          matData: RawMaterial;
          rmBalRef: ReturnType<typeof doc>;
          rmBalData: StockBalance | null;
          dmgRmBalRef: ReturnType<typeof doc>;
          dmgRmBalData: StockBalance | null;
          newMatStock: number;
        }> = [];

        for (const line of validation.sanitized.lines) {
          const consRef = doc(db, 'productionConsumption', line.id);
          const matRef = doc(db, 'rawMaterials', line.rawMaterialId);
          const rmBalRef = doc(db, 'stockBalances', `rm_${line.rawMaterialId}`);
          const dmgRmBalRef = doc(db, 'stockBalances', `dmg_rm_${line.rawMaterialId}`);

          const [consSnap, matSnap, rmBalSnap, dmgRmBalSnap] = await Promise.all([
            transaction.get(consRef),
            transaction.get(matRef),
            transaction.get(rmBalRef),
            transaction.get(dmgRmBalRef),
          ]);

          if (!consSnap.exists() || !matSnap.exists()) {
            throw new Error(`Referenced material ${line.materialName} could not be found.`);
          }

          const liveMat = matSnap.data() as RawMaterial;
          const newMatStock = roundQuantity(liveMat.currentStock - line.deltaFromIssued);
          if (newMatStock < 0) {
            throw new Error(
              `Negative stock prevented for ${liveMat.name}: extra consumption ${line.deltaFromIssued} ${liveMat.unit} exceeds available ${liveMat.currentStock} ${liveMat.unit}.`,
            );
          }

          lineState.push({
            line,
            consRef,
            matRef,
            matData: liveMat,
            rmBalRef,
            rmBalData: rmBalSnap.exists() ? (rmBalSnap.data() as StockBalance) : null,
            dmgRmBalRef,
            dmgRmBalData: dmgRmBalSnap.exists() ? (dmgRmBalSnap.data() as StockBalance) : null,
            newMatStock,
          });
        }

        // Apply all raw material & consumption updates
        for (const item of lineState) {
          transaction.update(item.consRef, {
            actualConsumedQuantity: item.line.actualConsumedQuantity,
            damagedMaterialQuantity: item.line.damagedMaterialQuantity,
            varianceQuantity: item.line.varianceQuantity,
            updatedAt: serverTimestamp(),
          });

          if (item.line.deltaFromIssued !== 0) {
            transaction.update(item.matRef, {
              currentStock: item.newMatStock,
              updatedAt: serverTimestamp(),
            });

            if (item.rmBalData) {
              transaction.update(item.rmBalRef, {
                issuedToProduction: roundQuantity(
                  Math.max(0, item.rmBalData.issuedToProduction + item.line.deltaFromIssued),
                ),
                currentBalance: item.newMatStock,
                updatedBy: firebaseUser.uid,
                updatedByName: operatorName,
                updatedAt: serverTimestamp(),
              });
            } else {
              transaction.set(item.rmBalRef, {
                id: item.rmBalRef.id,
                orgId: ORG_ID,
                itemId: item.matData.id,
                itemCode: item.matData.materialCode,
                itemName: item.matData.name,
                stockCategory: 'raw_material',
                unit: item.matData.unit,
                openingStock: item.matData.openingStock,
                receivedFromPurchases: 0,
                issuedToProduction: Math.max(0, item.line.actualConsumedQuantity),
                receivedFromProduction: 0,
                dispatchedThroughSales: 0,
                adjustmentsNet: 0,
                currentBalance: item.newMatStock,
                minimumStockLevel: item.matData.minimumStockLevel,
                updatedBy: firebaseUser.uid,
                updatedByName: operatorName,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }

            const deltaAbs = roundQuantity(Math.abs(item.line.deltaFromIssued));
            const ledgerRef = doc(collection(db, 'inventoryLedger'));
            transaction.set(ledgerRef, {
              id: ledgerRef.id,
              orgId: ORG_ID,
              transactionDate: todayIso,
              itemId: item.matData.id,
              itemCode: item.matData.materialCode,
              itemName: item.matData.name,
              stockCategory: 'raw_material',
              unit: item.matData.unit,
              transactionType:
                item.line.deltaFromIssued > 0
                  ? 'Production Extra Consumption'
                  : 'Production Return',
              quantityIn: item.line.deltaFromIssued < 0 ? deltaAbs : 0,
              quantityOut: item.line.deltaFromIssued > 0 ? deltaAbs : 0,
              balance: item.newMatStock,
              referenceDoc: liveOrder.orderNumber,
              reason:
                item.line.deltaFromIssued > 0
                  ? `Extra consumption recorded on completion of ${liveOrder.orderNumber}`
                  : `Unused issued material returned on completion of ${liveOrder.orderNumber}`,
              userUid: firebaseUser.uid,
              userName: operatorName,
              createdAt: serverTimestamp(),
            });
          }

          if (item.line.damagedMaterialQuantity > 0) {
            const prevDmgBal = item.dmgRmBalData?.currentBalance ?? 0;
            const newDmgBal = roundQuantity(prevDmgBal + item.line.damagedMaterialQuantity);
            const dmgName = `${item.matData.name} (Damaged)`.slice(0, 120);

            if (item.dmgRmBalData) {
              transaction.update(item.dmgRmBalRef, {
                itemCode: item.matData.materialCode,
                itemName: dmgName,
                unit: item.matData.unit,
                receivedFromProduction: roundQuantity(
                  item.dmgRmBalData.receivedFromProduction + item.line.damagedMaterialQuantity,
                ),
                currentBalance: newDmgBal,
                updatedBy: firebaseUser.uid,
                updatedByName: operatorName,
                updatedAt: serverTimestamp(),
              });
            } else {
              transaction.set(item.dmgRmBalRef, {
                id: item.dmgRmBalRef.id,
                orgId: ORG_ID,
                itemId: item.matData.id,
                itemCode: item.matData.materialCode,
                itemName: dmgName,
                stockCategory: 'damaged',
                unit: item.matData.unit,
                openingStock: 0,
                receivedFromPurchases: 0,
                issuedToProduction: 0,
                receivedFromProduction: item.line.damagedMaterialQuantity,
                dispatchedThroughSales: 0,
                adjustmentsNet: 0,
                currentBalance: newDmgBal,
                minimumStockLevel: 0,
                updatedBy: firebaseUser.uid,
                updatedByName: operatorName,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }

            const dmgRmLedgerRef = doc(collection(db, 'inventoryLedger'));
            transaction.set(dmgRmLedgerRef, {
              id: dmgRmLedgerRef.id,
              orgId: ORG_ID,
              transactionDate: todayIso,
              itemId: item.matData.id,
              itemCode: item.matData.materialCode,
              itemName: dmgName,
              stockCategory: 'damaged',
              unit: item.matData.unit,
              transactionType: 'Damaged Output',
              quantityIn: item.line.damagedMaterialQuantity,
              quantityOut: 0,
              balance: newDmgBal,
              referenceDoc: liveOrder.orderNumber,
              reason: `Damaged / rejected raw material from batch ${liveOrder.orderNumber}`.slice(
                0,
                300,
              ),
              userUid: firebaseUser.uid,
              userName: operatorName,
              createdAt: serverTimestamp(),
            });
          }
        }

        // Release WIP stock
        const wipData = wipSnap.exists() ? (wipSnap.data() as StockBalance) : null;
        const currentWip = wipData?.currentBalance ?? 0;
        const releaseWipQty = roundQuantity(Math.min(currentWip, liveOrder.expectedQuantity));
        const newWipBal = roundQuantity(Math.max(0, currentWip - releaseWipQty));

        if (wipData) {
          transaction.update(wipRef, {
            itemCode: liveOrder.productSku,
            itemName: `${liveOrder.productName} (WIP)`.slice(0, 120),
            unit: 'packets',
            issuedToProduction: roundQuantity(wipData.issuedToProduction + releaseWipQty),
            currentBalance: newWipBal,
            updatedBy: firebaseUser.uid,
            updatedByName: operatorName,
            updatedAt: serverTimestamp(),
          });
        } else {
          transaction.set(wipRef, {
            id: wipRef.id,
            orgId: ORG_ID,
            itemId: liveOrder.productId,
            itemCode: liveOrder.productSku,
            itemName: `${liveOrder.productName} (WIP)`.slice(0, 120),
            stockCategory: 'wip',
            unit: 'packets',
            openingStock: 0,
            receivedFromPurchases: 0,
            issuedToProduction: releaseWipQty,
            receivedFromProduction: 0,
            dispatchedThroughSales: 0,
            adjustmentsNet: 0,
            currentBalance: 0,
            minimumStockLevel: 0,
            updatedBy: firebaseUser.uid,
            updatedByName: operatorName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (releaseWipQty > 0) {
          const wipLedgerRef = doc(collection(db, 'inventoryLedger'));
          transaction.set(wipLedgerRef, {
            id: wipLedgerRef.id,
            orgId: ORG_ID,
            transactionDate: todayIso,
            itemId: liveOrder.productId,
            itemCode: liveOrder.productSku,
            itemName: `${liveOrder.productName} (WIP)`.slice(0, 120),
            stockCategory: 'wip',
            unit: 'packets',
            transactionType: 'WIP Completion',
            quantityIn: 0,
            quantityOut: releaseWipQty,
            balance: newWipBal,
            referenceDoc: liveOrder.orderNumber,
            reason: `WIP batch completed (${validation.sanitized.actualGoodQuantity} good, ${validation.sanitized.damagedQuantity} damaged)`.slice(
              0,
              300,
            ),
            userUid: firebaseUser.uid,
            userName: operatorName,
            createdAt: serverTimestamp(),
          });
        }

        // Post Finished Goods stock
        const fgData = fgSnap.exists() ? (fgSnap.data() as StockBalance) : null;
        const newFgBal = roundQuantity(
          (fgData?.currentBalance ?? 0) + validation.sanitized.actualGoodQuantity,
        );
        if (fgData) {
          transaction.update(fgRef, {
            itemCode: liveOrder.productSku,
            itemName: liveOrder.productName,
            unit: 'packets',
            receivedFromProduction: roundQuantity(
              fgData.receivedFromProduction + validation.sanitized.actualGoodQuantity,
            ),
            currentBalance: newFgBal,
            updatedBy: firebaseUser.uid,
            updatedByName: operatorName,
            updatedAt: serverTimestamp(),
          });
        } else {
          transaction.set(fgRef, {
            id: fgRef.id,
            orgId: ORG_ID,
            itemId: liveOrder.productId,
            itemCode: liveOrder.productSku,
            itemName: liveOrder.productName,
            stockCategory: 'finished_goods',
            unit: 'packets',
            openingStock: 0,
            receivedFromPurchases: 0,
            issuedToProduction: 0,
            receivedFromProduction: validation.sanitized.actualGoodQuantity,
            dispatchedThroughSales: 0,
            adjustmentsNet: 0,
            currentBalance: newFgBal,
            minimumStockLevel: 0,
            updatedBy: firebaseUser.uid,
            updatedByName: operatorName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (validation.sanitized.actualGoodQuantity > 0) {
          const fgLedgerRef = doc(collection(db, 'inventoryLedger'));
          transaction.set(fgLedgerRef, {
            id: fgLedgerRef.id,
            orgId: ORG_ID,
            transactionDate: todayIso,
            itemId: liveOrder.productId,
            itemCode: liveOrder.productSku,
            itemName: liveOrder.productName,
            stockCategory: 'finished_goods',
            unit: 'packets',
            transactionType: 'Production Output',
            quantityIn: validation.sanitized.actualGoodQuantity,
            quantityOut: 0,
            balance: newFgBal,
            referenceDoc: liveOrder.orderNumber,
            reason: `Finished good packets produced in batch ${liveOrder.orderNumber}`.slice(0, 300),
            userUid: firebaseUser.uid,
            userName: operatorName,
            createdAt: serverTimestamp(),
          });
        }

        // Post Damaged / Rejected Packets stock
        if (validation.sanitized.damagedQuantity > 0) {
          const dmgFgData = dmgFgSnap.exists() ? (dmgFgSnap.data() as StockBalance) : null;
          const newDmgFgBal = roundQuantity(
            (dmgFgData?.currentBalance ?? 0) + validation.sanitized.damagedQuantity,
          );
          const dmgFgName = `${liveOrder.productName} (Damaged)`.slice(0, 120);

          if (dmgFgData) {
            transaction.update(dmgFgRef, {
              itemCode: liveOrder.productSku,
              itemName: dmgFgName,
              unit: 'packets',
              receivedFromProduction: roundQuantity(
                dmgFgData.receivedFromProduction + validation.sanitized.damagedQuantity,
              ),
              currentBalance: newDmgFgBal,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              updatedAt: serverTimestamp(),
            });
          } else {
            transaction.set(dmgFgRef, {
              id: dmgFgRef.id,
              orgId: ORG_ID,
              itemId: liveOrder.productId,
              itemCode: liveOrder.productSku,
              itemName: dmgFgName,
              stockCategory: 'damaged',
              unit: 'packets',
              openingStock: 0,
              receivedFromPurchases: 0,
              issuedToProduction: 0,
              receivedFromProduction: validation.sanitized.damagedQuantity,
              dispatchedThroughSales: 0,
              adjustmentsNet: 0,
              currentBalance: newDmgFgBal,
              minimumStockLevel: 0,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          const dmgFgLedgerRef = doc(collection(db, 'inventoryLedger'));
          transaction.set(dmgFgLedgerRef, {
            id: dmgFgLedgerRef.id,
            orgId: ORG_ID,
            transactionDate: todayIso,
            itemId: liveOrder.productId,
            itemCode: liveOrder.productSku,
            itemName: dmgFgName,
            stockCategory: 'damaged',
            unit: 'packets',
            transactionType: 'Damaged Output',
            quantityIn: validation.sanitized.damagedQuantity,
            quantityOut: 0,
            balance: newDmgFgBal,
            referenceDoc: liveOrder.orderNumber,
            reason: `Damaged / rejected packets from batch ${liveOrder.orderNumber}`.slice(0, 300),
            userUid: firebaseUser.uid,
            userName: operatorName,
            createdAt: serverTimestamp(),
          });
        }

        // Record immutable Production Variance document (ID matches productionOrderId)
        const varianceRef = doc(db, 'productionVariances', liveOrder.id);
        transaction.set(varianceRef, {
          id: liveOrder.id,
          orgId: ORG_ID,
          productionOrderId: liveOrder.id,
          orderNumber: liveOrder.orderNumber,
          productId: liveOrder.productId,
          productName: liveOrder.productName,
          productionDate: liveOrder.productionDate,
          expectedQuantity: liveOrder.expectedQuantity,
          actualGoodQuantity: validation.sanitized.actualGoodQuantity,
          damagedQuantity: validation.sanitized.damagedQuantity,
          yieldVarianceQty: validation.sanitized.yieldVarianceQty,
          yieldVariancePercent: validation.sanitized.yieldVariancePercent,
          expectedMaterialCost: validation.sanitized.expectedMaterialCost,
          actualMaterialCost: validation.sanitized.actualMaterialCost,
          materialCostVariance: validation.sanitized.materialCostVariance,
          damagedMaterialQty: validation.sanitized.damagedMaterialQty,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
        });

        transaction.update(orderRef, {
          status: 'Completed',
          finishedGoodsPosted: true,
          actualGoodQuantity: validation.sanitized.actualGoodQuantity,
          damagedQuantity: validation.sanitized.damagedQuantity,
          notes: validation.sanitized.notes,
          completedBy: firebaseUser.uid,
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setActionBanner(
        `Batch ${completingOrder.orderNumber} completed. Finished goods and variance posted atomically.`,
      );
      setCompletingOrder(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `productionOrders/${completingOrder.id}`);
      }
      setCompleteError(msg || 'Failed to complete production order.');
    } finally {
      setCompleting(false);
    }
  };

  const handleCancelOrder = async (order: ProductionOrder) => {
    if (!firebaseUser || !canManage || order.status !== 'Planned' || order.materialsIssued) return;
    setCancelling(true);
    setDetailError(null);
    try {
      await updateDoc(doc(db, 'productionOrders', order.id), {
        status: 'Cancelled',
        updatedAt: serverTimestamp(),
      });
      setViewingOrder(null);
      setActionBanner(`Production plan ${order.orderNumber} cancelled.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `productionOrders/${order.id}`);
      }
      setDetailError('Failed to cancel production order.');
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!deletingOrder || !canDelete || deletingOrder.materialsIssued) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const batch = writeBatch(db);
      const orderCons = consumptionsByOrderId.get(deletingOrder.id) ?? [];
      orderCons.forEach((c) => {
        batch.delete(doc(db, 'productionConsumption', c.id));
      });
      batch.delete(doc(db, 'productionOrders', deletingOrder.id));
      await batch.commit();
      setDeletingOrder(null);
      setActionBanner(`Deleted production plan ${deletingOrder.orderNumber}.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.DELETE, `productionOrders/${deletingOrder.id}`);
      }
      setDeleteError('Failed to delete production order from Cloud Firestore.');
    } finally {
      setDeleting(false);
    }
  };

  const prerequisitesMissing = products.length === 0 || boms.length === 0;
  const chartRuns = useMemo(() => variances.slice(0, 8), [variances]);
  const maxChartQty = useMemo(() => {
    let maxVal = 1;
    chartRuns.forEach((v) => {
      maxVal = Math.max(maxVal, v.expectedQuantity, v.actualGoodQuantity + v.damagedQuantity);
    });
    return maxVal;
  }, [chartRuns]);
  const maxChartCost = useMemo(() => {
    let maxVal = 1;
    chartRuns.forEach((v) => {
      maxVal = Math.max(maxVal, v.expectedMaterialCost, v.actualMaterialCost);
    });
    return maxVal;
  }, [chartRuns]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Procurement & Production</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            Production Management
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Plan BOM batches, verify raw material availability, issue floor stock, and audit yield
            and consumption variance.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canManage && (
            <button
              type="button"
              onClick={openCreatePlanModal}
              disabled={prerequisitesMissing}
              title={
                prerequisitesMissing
                  ? 'Register at least one Finished Product and Bill of Materials first'
                  : 'Create Production Plan'
              }
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              New Production Plan
            </button>
          )}
        </div>
      </div>

      {/* Prerequisite Notice */}
      {!loading && prerequisitesMissing && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-900"
        >
          <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Products and BOM Required Before Production</p>
            <p className="mt-0.5 text-xs text-amber-800">
              {products.length === 0 && 'No finished products registered yet. '}
              {boms.length === 0 && 'No Bills of Materials defined yet. '}
              Define a finished product and its BOM first so production plans can calculate required
              raw materials automatically.
            </p>
          </div>
        </div>
      )}

      {actionBanner && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{actionBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-emerald-700 hover:text-emerald-900"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Sub-view Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Production views"
          className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'orders'}
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap inline-flex items-center gap-2 ${
              activeTab === 'orders'
                ? 'bg-white text-[#3B4F4E] shadow-xs'
                : 'text-slate-600 hover:text-[#3B4F4E]'
            }`}
          >
            <Factory className="w-3.5 h-3.5 shrink-0" />
            Production Orders ({orders.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'variance'}
            onClick={() => setActiveTab('variance')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap inline-flex items-center gap-2 ${
              activeTab === 'variance'
                ? 'bg-white text-[#3B4F4E] shadow-xs'
                : 'text-slate-600 hover:text-[#3B4F4E]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 shrink-0" />
            Production Variance ({variances.length})
          </button>
        </div>
      </div>

      {activeTab === 'orders' ? (
        <>
          {/* Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Total Production Orders</p>
              <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
                {summary.total}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                <span className="font-mono tabular-nums">{summary.planned}</span> planned ·{' '}
                <span className="font-mono tabular-nums">{summary.inProgress}</span> active
              </p>
            </div>

            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">In Progress Batches</p>
              <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
                {summary.inProgress}
              </p>
              <p className="mt-1 text-xs text-slate-500">Materials issued to floor WIP</p>
            </div>

            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Good Packets Produced</p>
              <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
                {summary.totalGood}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Across <span className="font-mono tabular-nums">{summary.completed}</span> completed
                runs
              </p>
            </div>

            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Damaged / Rejected Packets</p>
              <p
                className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${
                  summary.totalDamaged > 0 ? 'text-amber-700' : 'text-[#3B4F4E]'
                }`}
              >
                {summary.totalDamaged}
              </p>
              <p className="mt-1 text-xs text-slate-500">Tracked separately in damaged stock</p>
            </div>
          </div>

          {/* Orders Table */}
          <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search order no., product, BOM, supervisor..."
                  aria-label="Search production orders"
                  className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div
                role="tablist"
                aria-label="Filter by production status"
                className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start xl:self-auto"
              >
                {(['All', ...PRODUCTION_STATUSES] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      statusFilter === status
                        ? 'bg-white text-[#3B4F4E] shadow-xs'
                        : 'text-slate-600 hover:text-[#3B4F4E]'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Order No.
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Date
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Finished Product & BOM
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Supervisor
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Planned / Exp.
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Good / Damaged
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-500">
                        Loading production orders from Cloud Firestore...
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <div className="max-w-md mx-auto flex flex-col items-center">
                          <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                            <Factory className="w-5 h-5" />
                          </div>
                          <h2 className="text-base font-semibold text-[#3B4F4E]">
                            {orders.length === 0
                              ? 'No production orders scheduled yet'
                              : 'No matching production orders'}
                          </h2>
                          <p className="mt-1.5 text-sm text-slate-600">
                            {orders.length === 0
                              ? 'Select a finished product and BOM to plan your first batch and verify raw material availability.'
                              : 'Try clearing your search query or selecting another status filter.'}
                          </p>
                          {orders.length === 0 && canManage && !prerequisitesMissing && (
                            <button
                              type="button"
                              onClick={openCreatePlanModal}
                              className="mt-4 min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Create First Production Plan
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#3B4F4E] whitespace-nowrap">
                          {order.orderNumber}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {order.productionDate}
                        </td>
                        <td className="px-5 py-3.5 min-w-[210px]">
                          <p className="text-sm font-medium text-[#3B4F4E]">{order.productName}</p>
                          <p className="text-xs text-slate-500 font-mono">
                            {order.productSku} · {order.bomCode} v{order.bomVersion}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-700 whitespace-nowrap">
                          {order.supervisorName}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs font-medium text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                          {order.plannedQuantity} pkts
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-right tabular-nums whitespace-nowrap">
                          {order.status === 'Completed' ? (
                            <span>
                              <span className="font-semibold text-emerald-700">
                                {order.actualGoodQuantity}
                              </span>
                              {' / '}
                              <span
                                className={
                                  order.damagedQuantity > 0
                                    ? 'font-semibold text-amber-700'
                                    : 'text-slate-500'
                                }
                              >
                                {order.damagedQuantity}
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-400">Pending</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                          {order.status === 'Completed' ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              Completed
                            </span>
                          ) : order.status === 'In Progress' ? (
                            <span className="inline-flex items-center gap-1.5 text-[#3B4F4E]">
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              In Progress
                            </span>
                          ) : order.status === 'Planned' ? (
                            <span className="inline-flex items-center gap-1.5 text-amber-700">
                              <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                              Planned
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-slate-500">
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                              Cancelled
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            {canManage && order.status === 'Planned' && !order.materialsIssued && (
                              <button
                                type="button"
                                onClick={() => openIssueModal(order)}
                                className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#2C3C3B] bg-[#EEF3F3] hover:bg-[#E5EDED] border border-[#DCE6E6] rounded-md transition-colors whitespace-nowrap"
                              >
                                <Play className="w-3.5 h-3.5 shrink-0" />
                                Issue Materials
                              </button>
                            )}
                            {canManage &&
                              order.status === 'In Progress' &&
                              order.materialsIssued &&
                              !order.finishedGoodsPosted && (
                                <button
                                  type="button"
                                  onClick={() => openCompleteModal(order)}
                                  className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors whitespace-nowrap"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  Complete
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={() => {
                                setDetailError(null);
                                setViewingOrder(order);
                              }}
                              className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-500" />
                              View
                            </button>
                            {canDelete && !order.materialsIssued && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteError(null);
                                  setDeletingOrder(order);
                                }}
                                className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-[#DCE6E6] rounded-md transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
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
        </>
      ) : (
        /* Production Variance Tab */
        <div className="space-y-6">
          {/* Variance Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Overall Yield Efficiency</p>
              <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
                {varianceSummary.runs > 0 ? `${varianceSummary.yieldEfficiencyPct.toFixed(1)}%` : '0.0%'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                <span className="font-mono tabular-nums">{varianceSummary.actualGoodQty}</span> good /{' '}
                <span className="font-mono tabular-nums">{varianceSummary.expectedQty}</span> expected
              </p>
            </div>

            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Net Yield Variance</p>
              <p
                className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${
                  varianceSummary.yieldVarianceQty < 0
                    ? 'text-red-700'
                    : varianceSummary.yieldVarianceQty > 0
                      ? 'text-emerald-700'
                      : 'text-[#3B4F4E]'
                }`}
              >
                {varianceSummary.yieldVarianceQty > 0 ? '+' : ''}
                {varianceSummary.yieldVarianceQty} pkts
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Damaged packets:{' '}
                <span className="font-mono tabular-nums">{varianceSummary.damagedQty}</span>
              </p>
            </div>

            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Material Cost Variance</p>
              <p
                className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${
                  varianceSummary.costVariance > 0
                    ? 'text-red-700'
                    : varianceSummary.costVariance < 0
                      ? 'text-emerald-700'
                      : 'text-[#3B4F4E]'
                }`}
              >
                {varianceSummary.costVariance > 0 ? '+' : ''}₹
                {varianceSummary.costVariance.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Exp ₹{varianceSummary.expectedMatCost.toFixed(2)} vs Act ₹
                {varianceSummary.actualMatCost.toFixed(2)}
              </p>
            </div>

            <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Damaged Raw Material</p>
              <p
                className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${
                  varianceSummary.damagedMaterialQty > 0 ? 'text-amber-700' : 'text-[#3B4F4E]'
                }`}
              >
                {varianceSummary.damagedMaterialQty}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Across <span className="font-mono tabular-nums">{varianceSummary.runs}</span> completed
                batches
              </p>
            </div>
          </div>

          {/* Dashboard Charts for Completed Batches */}
          {chartRuns.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="bg-white border border-[#DCE6E6] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-[#3B4F4E]">
                      Expected vs. Actual Good & Damaged Output
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Packet yield comparison across latest completed production runs
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 inline-block" />
                      Expected
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs bg-[#CF9C2D] inline-block" />
                      Good
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                      Damaged
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {chartRuns.map((run) => {
                    const expW = Math.min(100, (run.expectedQuantity / maxChartQty) * 100);
                    const goodW = Math.min(100, (run.actualGoodQuantity / maxChartQty) * 100);
                    const dmgW = Math.min(100 - goodW, (run.damagedQuantity / maxChartQty) * 100);
                    return (
                      <div key={run.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-medium text-slate-800 truncate">
                            {run.orderNumber} · {run.productName}
                          </span>
                          <span className="font-mono tabular-nums text-slate-600 shrink-0">
                            {run.actualGoodQuantity}/{run.expectedQuantity} pkts (
                            {run.yieldVariancePercent > 0 ? '+' : ''}
                            {run.yieldVariancePercent.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="w-full h-2 bg-slate-100 rounded-xs overflow-hidden">
                            <div
                              className="h-full bg-slate-300"
                              style={{ width: `${expW}%` }}
                            />
                          </div>
                          <div className="w-full h-2.5 bg-slate-100 rounded-xs overflow-hidden flex">
                            <div
                              className="h-full bg-[#CF9C2D]"
                              style={{ width: `${goodW}%` }}
                            />
                            {dmgW > 0 && (
                              <div
                                className="h-full bg-amber-500"
                                style={{ width: `${dmgW}%` }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="bg-white border border-[#DCE6E6] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-[#3B4F4E]">
                      Expected vs. Actual Material Cost (₹)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      BOM standard material cost compared against actual floor consumption
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 inline-block" />
                      Expected ₹
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                      Actual ₹
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {chartRuns.map((run) => {
                    const expW = Math.min(100, (run.expectedMaterialCost / maxChartCost) * 100);
                    const actW = Math.min(100, (run.actualMaterialCost / maxChartCost) * 100);
                    const overBudget = run.materialCostVariance > 0;
                    return (
                      <div key={run.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-medium text-slate-800 truncate">
                            {run.orderNumber}
                          </span>
                          <span
                            className={`font-mono tabular-nums shrink-0 ${
                              overBudget ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            Exp ₹{run.expectedMaterialCost.toFixed(0)} · Act ₹
                            {run.actualMaterialCost.toFixed(0)} (
                            {run.materialCostVariance > 0 ? '+' : ''}₹
                            {run.materialCostVariance.toFixed(0)})
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="w-full h-2 bg-slate-100 rounded-xs overflow-hidden">
                            <div className="h-full bg-slate-300" style={{ width: `${expW}%` }} />
                          </div>
                          <div className="w-full h-2.5 bg-slate-100 rounded-xs overflow-hidden">
                            <div
                              className={`h-full ${overBudget ? 'bg-red-600' : 'bg-emerald-600'}`}
                              style={{ width: `${actW}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* Variance Table */}
          <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search variance by order no., product, or date..."
                  aria-label="Search production variances"
                  className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {filteredVariances.length} variance records
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Order No.
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Date
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Product
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Expected Qty
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Actual Good
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Damaged Pkts
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Yield Var %
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Exp. Mat Cost
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Act. Mat Cost
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Damaged Mat
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredVariances.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-16 text-center">
                        <div className="max-w-md mx-auto flex flex-col items-center">
                          <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                            <BarChart3 className="w-5 h-5" />
                          </div>
                          <h2 className="text-base font-semibold text-[#3B4F4E]">
                            No production variance records yet
                          </h2>
                          <p className="mt-1.5 text-sm text-slate-600">
                            Complete an In Progress production order to calculate packet yield
                            variance and raw material consumption variance automatically.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredVariances.map((v) => {
                      const matchedOrder = orders.find((o) => o.id === v.productionOrderId);
                      return (
                        <tr
                          key={v.id}
                          onClick={() => {
                            if (matchedOrder) {
                              setDetailError(null);
                              setViewingOrder(matchedOrder);
                            }
                          }}
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#3B4F4E] whitespace-nowrap">
                            {v.orderNumber}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            {v.productionDate}
                          </td>
                          <td className="px-5 py-3.5 text-sm font-medium text-[#3B4F4E] whitespace-nowrap">
                            {v.productName}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                            {v.expectedQuantity}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs font-semibold text-emerald-700 text-right tabular-nums whitespace-nowrap">
                            {v.actualGoodQuantity}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-amber-700 text-right tabular-nums whitespace-nowrap">
                            {v.damagedQuantity}
                          </td>
                          <td
                            className={`px-5 py-3.5 font-mono text-xs font-semibold text-right tabular-nums whitespace-nowrap ${
                              v.yieldVariancePercent < 0
                                ? 'text-red-700'
                                : v.yieldVariancePercent > 0
                                  ? 'text-emerald-700'
                                  : 'text-slate-800'
                            }`}
                          >
                            {v.yieldVariancePercent > 0 ? '+' : ''}
                            {v.yieldVariancePercent.toFixed(2)}%
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                            ₹{v.expectedMaterialCost.toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs font-medium text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                            ₹{v.actualMaterialCost.toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                            {v.damagedMaterialQty}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Create Production Plan Modal */}
      {planModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="plan-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                  New Production Plan
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically fetches the product BOM and verifies raw material availability
                  before scheduling.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleCreatePlan(e)}
              className="p-6 space-y-5 max-h-[82vh] overflow-y-auto"
            >
              {planError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{planError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="prod-order-num" className="block text-xs font-medium text-slate-700 mb-1">
                    Order Number *
                  </label>
                  <input
                    id="prod-order-num"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.code.maxLength}
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="prod-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Production Date *
                  </label>
                  <input
                    id="prod-date"
                    type="date"
                    required
                    value={productionDate}
                    onChange={(e) => setProductionDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="prod-supervisor" className="block text-xs font-medium text-slate-700 mb-1">
                    Production Supervisor *
                  </label>
                  <select
                    id="prod-supervisor"
                    required
                    value={supervisorUid}
                    onChange={(e) => setSupervisorUid(e.target.value)}
                    disabled={!canListUsers && supervisorOptions.length <= 1}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {supervisorOptions.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="prod-product" className="block text-xs font-medium text-slate-700 mb-1">
                    Finished Product *
                  </label>
                  <select
                    id="prod-product"
                    required
                    value={productId}
                    onChange={(e) => handleProductSelectionChange(e.target.value)}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    <option value="">Select product...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.packetSize})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="prod-bom" className="block text-xs font-medium text-slate-700 mb-1">
                    Bill of Materials (BOM) *
                  </label>
                  <select
                    id="prod-bom"
                    required
                    value={bomId}
                    onChange={(e) => setBomId(e.target.value)}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {selectedProductBoms.length === 0 ? (
                      <option value="">No BOM found for this product</option>
                    ) : (
                      selectedProductBoms.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bomCode} v{b.version} ({b.status}, batch {b.batchSize})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label htmlFor="prod-qty" className="block text-xs font-medium text-slate-700 mb-1">
                    Planned Quantity (Packets) *
                  </label>
                  <input
                    id="prod-qty"
                    type="number"
                    required
                    min="0.001"
                    step="0.001"
                    value={plannedQuantity}
                    onChange={(e) => setPlannedQuantity(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              {/* Automatic BOM Material Availability Table */}
              <div className="border border-[#DCE6E6] rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-[#DCE6E6] flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-[#3B4F4E]">
                      Calculated Raw Material Requirements & Stock Check
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {selectedBom
                        ? `Scaled from ${selectedBom.bomCode} v${selectedBom.version} (standard batch: ${selectedBom.batchSize} pkts)`
                        : 'Select a product with an active BOM to calculate required materials.'}
                    </p>
                  </div>
                  {liveRequirements && liveRequirements.requirements.length > 0 && (
                    <span
                      className={`text-xs font-semibold inline-flex items-center gap-1.5 ${
                        liveRequirements.allAvailable ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {liveRequirements.allAvailable ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          All Materials Available
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4" />
                          Insufficient Raw Material Stock
                        </>
                      )}
                    </span>
                  )}
                </div>

                {!selectedBom || !liveRequirements || liveRequirements.requirements.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500">
                    No BOM components available for the selected product/quantity.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#DCE6E6] bg-white">
                          <th className="px-4 py-2 text-[11px] font-semibold text-slate-600">
                            Raw Material
                          </th>
                          <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                            Required Qty
                          </th>
                          <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                            Available Stock
                          </th>
                          <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                            Est. Cost
                          </th>
                          <th className="px-4 py-2 text-[11px] font-semibold text-slate-600">
                            Availability
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {liveRequirements.requirements.map((req) => (
                          <tr
                            key={req.rawMaterialId}
                            className={!req.sufficient ? 'bg-red-50/60' : undefined}
                          >
                            <td className="px-4 py-2.5 text-xs">
                              <p className="font-medium text-[#3B4F4E]">{req.materialName}</p>
                              <p className="font-mono text-[11px] text-slate-500">
                                {req.materialCode}
                              </p>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#3B4F4E] text-right tabular-nums">
                              {req.expectedQuantity} {req.unit}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-700 text-right tabular-nums">
                              {req.availableStock} {req.unit}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-700 text-right tabular-nums">
                              ₹{req.expectedCost.toFixed(2)}
                            </td>
                            <td className="px-4 py-2.5 text-xs font-medium">
                              {req.sufficient ? (
                                <span className="text-emerald-700">Ready</span>
                              ) : (
                                <span className="text-red-700">
                                  Short by {req.shortage} {req.unit}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="prod-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Production Shift / Batch Notes
                </label>
                <input
                  id="prod-notes"
                  type="text"
                  maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Line assignment, packaging lot, or quality instructions"
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPlanModalOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPlan || !liveRequirements?.allAvailable}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg"
                >
                  {savingPlan ? 'Saving Plan...' : 'Create Production Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue Raw Materials Confirmation Modal */}
      {issuingOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="issue-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                  Issue Raw Materials & Start ({issuingOrder.orderNumber})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deducts raw materials atomically, moves batch to Work-in-Progress (WIP), and logs
                  ledger entries.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIssuingOrder(null)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {issueError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{issueError}</span>
                </div>
              )}

              <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3 text-xs text-slate-700 space-y-1">
                <p>
                  <span className="font-medium text-[#3B4F4E]">Product:</span>{' '}
                  {issuingOrder.productName} ({issuingOrder.expectedQuantity} packets)
                </p>
                <p>
                  <span className="font-medium text-[#3B4F4E]">BOM:</span> {issuingOrder.bomCode} v
                  {issuingOrder.bomVersion} · <span className="font-medium">Supervisor:</span>{' '}
                  {issuingOrder.supervisorName}
                </p>
              </div>

              <div className="border border-[#DCE6E6] rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#DCE6E6] bg-slate-50">
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600">Material</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                        To Issue
                      </th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                        Current Stock
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(consumptionsByOrderId.get(issuingOrder.id) ?? []).map((c) => {
                      const mat = materials.find((m) => m.id === c.rawMaterialId);
                      const avail = mat?.currentStock ?? 0;
                      const ok = avail >= c.expectedQuantity;
                      return (
                        <tr key={c.id} className={!ok ? 'bg-red-50' : undefined}>
                          <td className="px-4 py-2 text-xs text-[#3B4F4E]">
                            {c.materialName}{' '}
                            <span className="font-mono text-slate-500">({c.materialCode})</span>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs font-semibold text-[#3B4F4E] text-right tabular-nums">
                            {c.expectedQuantity} {c.unit}
                          </td>
                          <td
                            className={`px-4 py-2 font-mono text-xs text-right tabular-nums ${
                              ok ? 'text-emerald-700' : 'text-red-700 font-semibold'
                            }`}
                          >
                            {avail} {c.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIssuingOrder(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmIssue()}
                  disabled={issuing}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg"
                >
                  {issuing ? 'Issuing Stock...' : 'Confirm Issue & Start Production'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Complete Production & Record Consumption Modal */}
      {completingOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="complete-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-4xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="complete-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                  Complete Production & Record Output ({completingOrder.orderNumber})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Posts finished goods & damaged stock, reconciles material variance, and locks the
                  order against duplicate completion.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompletingOrder(null)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmComplete(e)}
              className="p-6 space-y-5 max-h-[82vh] overflow-y-auto"
            >
              {completeError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{completeError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-[11px] font-medium text-slate-500">Expected Output</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-[#3B4F4E] tabular-nums">
                    {completingOrder.expectedQuantity} pkts
                  </p>
                </div>

                <div>
                  <label htmlFor="comp-good" className="block text-xs font-medium text-slate-700 mb-1">
                    Actual Good Packets *
                  </label>
                  <input
                    id="comp-good"
                    type="number"
                    required
                    min="0"
                    step="0.001"
                    value={actualGoodQuantity}
                    onChange={(e) => setActualGoodQuantity(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="comp-damaged" className="block text-xs font-medium text-slate-700 mb-1">
                    Damaged / Rejected Packets *
                  </label>
                  <input
                    id="comp-damaged"
                    type="number"
                    required
                    min="0"
                    step="0.001"
                    value={damagedQuantity}
                    onChange={(e) => setDamagedQuantity(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div className="border border-[#DCE6E6] rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-[#DCE6E6]">
                  <h3 className="text-xs font-semibold text-[#3B4F4E]">
                    Actual Raw Material Consumption & Damage Reconciliation
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    If actual consumption differs from issued quantity, stock is automatically
                    returned to or drawn from raw material inventory.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE6E6] bg-white">
                        <th className="px-4 py-2 text-[11px] font-semibold text-slate-600">Material</th>
                        <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                          Expected / Issued
                        </th>
                        <th className="px-4 py-2 text-[11px] font-semibold text-slate-600">
                          Actual Consumed
                        </th>
                        <th className="px-4 py-2 text-[11px] font-semibold text-slate-600">
                          Damaged Mat.
                        </th>
                        <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                          Variance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(consumptionsByOrderId.get(completingOrder.id) ?? []).map((c) => {
                        const draft = consumptionDrafts.find((d) => d.id === c.id);
                        const actVal = Number(draft?.actualConsumedQuantity ?? c.expectedQuantity);
                        const varQty = Number.isFinite(actVal)
                          ? roundQuantity(actVal - c.expectedQuantity)
                          : 0;
                        const varPct =
                          c.expectedQuantity > 0
                            ? roundCurrency((varQty / c.expectedQuantity) * 100)
                            : 0;
                        return (
                          <tr key={c.id}>
                            <td className="px-4 py-2.5 text-xs">
                              <p className="font-medium text-[#3B4F4E]">{c.materialName}</p>
                              <p className="font-mono text-[11px] text-slate-500">
                                {c.materialCode} ({c.unit})
                              </p>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-700 text-right tabular-nums">
                              {c.expectedQuantity} / {c.issuedQuantity} {c.unit}
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="number"
                                required
                                min="0"
                                step="0.001"
                                aria-label={`Actual consumed ${c.materialName}`}
                                value={draft?.actualConsumedQuantity ?? ''}
                                onChange={(e) =>
                                  setConsumptionDrafts((prev) =>
                                    prev.map((row) =>
                                      row.id === c.id
                                        ? { ...row, actualConsumedQuantity: e.target.value }
                                        : row,
                                    ),
                                  )
                                }
                                className="w-28 h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="number"
                                required
                                min="0"
                                step="0.001"
                                aria-label={`Damaged ${c.materialName}`}
                                value={draft?.damagedMaterialQuantity ?? '0'}
                                onChange={(e) =>
                                  setConsumptionDrafts((prev) =>
                                    prev.map((row) =>
                                      row.id === c.id
                                        ? { ...row, damagedMaterialQuantity: e.target.value }
                                        : row,
                                    ),
                                  )
                                }
                                className="w-24 h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              />
                            </td>
                            <td
                              className={`px-4 py-2.5 font-mono text-xs font-semibold text-right tabular-nums ${
                                varQty > 0
                                  ? 'text-red-700'
                                  : varQty < 0
                                    ? 'text-emerald-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              {varQty > 0 ? '+' : ''}
                              {varQty} {c.unit}{' '}
                              <span className="text-[11px] font-normal">
                                ({varPct > 0 ? '+' : ''}
                                {varPct.toFixed(1)}%)
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {liveCompletionPreview && liveCompletionPreview.valid && (
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-slate-500">Projected Yield Variance</p>
                    <p className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                      {liveCompletionPreview.sanitized.yieldVarianceQty > 0 ? '+' : ''}
                      {liveCompletionPreview.sanitized.yieldVarianceQty} pkts (
                      {liveCompletionPreview.sanitized.yieldVariancePercent > 0 ? '+' : ''}
                      {liveCompletionPreview.sanitized.yieldVariancePercent.toFixed(2)}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Material Cost (Exp vs Act)</p>
                    <p className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                      ₹{liveCompletionPreview.sanitized.expectedMaterialCost.toFixed(2)} vs ₹
                      {liveCompletionPreview.sanitized.actualMaterialCost.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Damaged Material Total</p>
                    <p className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                      {liveCompletionPreview.sanitized.damagedMaterialQty}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="comp-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Completion / QC Notes
                </label>
                <input
                  id="comp-notes"
                  type="text"
                  maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="Quality inspection notes or wastage cause"
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCompletingOrder(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={completing}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 rounded-lg"
                >
                  {completing ? 'Completing & Posting Stock...' : 'Complete Production Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Production Order Detail Modal */}
      {viewingOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-order-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="view-order-title" className="text-base font-semibold text-[#3B4F4E]">
                  Production Order {viewingOrder.orderNumber}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {viewingOrder.productName} ({viewingOrder.productSku}) · {viewingOrder.bomCode}{' '}
                  v{viewingOrder.bomVersion}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingOrder(null)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {detailError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {detailError}
                </div>
              )}

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-slate-50 border border-[#DCE6E6] rounded-lg p-4">
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="mt-1 font-semibold text-[#3B4F4E]">{viewingOrder.status}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Production Date</dt>
                  <dd className="mt-1 font-mono text-[#3B4F4E]">{viewingOrder.productionDate}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Supervisor</dt>
                  <dd className="mt-1 font-medium text-[#3B4F4E]">{viewingOrder.supervisorName}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Planned / Good / Damaged</dt>
                  <dd className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                    {viewingOrder.plannedQuantity} / {viewingOrder.actualGoodQuantity} /{' '}
                    {viewingOrder.damagedQuantity}
                  </dd>
                </div>
              </dl>

              {varianceByOrderId.get(viewingOrder.id) && (
                <div className="bg-[#EEF3F3]/80 border border-[#DCE6E6] rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <p className="text-slate-600">Yield Variance</p>
                    <p className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                      {varianceByOrderId.get(viewingOrder.id)!.yieldVarianceQty > 0 ? '+' : ''}
                      {varianceByOrderId.get(viewingOrder.id)!.yieldVarianceQty} pkts (
                      {varianceByOrderId.get(viewingOrder.id)!.yieldVariancePercent.toFixed(2)}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600">Expected Material Cost</p>
                    <p className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                      ₹{varianceByOrderId.get(viewingOrder.id)!.expectedMaterialCost.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600">Actual Material Cost</p>
                    <p className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                      ₹{varianceByOrderId.get(viewingOrder.id)!.actualMaterialCost.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600">Cost Variance</p>
                    <p className="mt-1 font-mono font-semibold text-[#3B4F4E] tabular-nums">
                      ₹{varianceByOrderId.get(viewingOrder.id)!.materialCostVariance.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}

              <div className="border border-[#DCE6E6] rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#DCE6E6] bg-slate-50">
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600">Material</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                        Expected
                      </th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                        Issued
                      </th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                        Actual
                      </th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                        Damaged
                      </th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-slate-600 text-right">
                        Variance
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(consumptionsByOrderId.get(viewingOrder.id) ?? []).map((c) => {
                      const varPct =
                        c.expectedQuantity > 0
                          ? roundCurrency((c.varianceQuantity / c.expectedQuantity) * 100)
                          : 0;
                      return (
                        <tr key={c.id}>
                          <td className="px-4 py-2.5 text-xs">
                            <span className="font-medium text-[#3B4F4E]">{c.materialName}</span>{' '}
                            <span className="font-mono text-slate-500">({c.materialCode})</span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-700 text-right tabular-nums">
                            {c.expectedQuantity} {c.unit}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-700 text-right tabular-nums">
                            {c.issuedQuantity} {c.unit}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs font-medium text-[#3B4F4E] text-right tabular-nums">
                            {c.actualConsumedQuantity} {c.unit}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-amber-700 text-right tabular-nums">
                            {c.damagedMaterialQuantity} {c.unit}
                          </td>
                          <td
                            className={`px-4 py-2.5 font-mono text-xs font-semibold text-right tabular-nums ${
                              c.varianceQuantity > 0
                                ? 'text-red-700'
                                : c.varianceQuantity < 0
                                  ? 'text-emerald-700'
                                  : 'text-slate-800'
                            }`}
                          >
                            {c.varianceQuantity > 0 ? '+' : ''}
                            {c.varianceQuantity} {c.unit}{' '}
                            {c.expectedQuantity > 0 && viewingOrder.status === 'Completed' && (
                              <span className="text-[11px] font-normal">
                                ({varPct > 0 ? '+' : ''}
                                {varPct.toFixed(1)}%)
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {viewingOrder.notes && (
                <p className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">Notes:</span> {viewingOrder.notes}
                </p>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  {canManage &&
                    viewingOrder.status === 'Planned' &&
                    !viewingOrder.materialsIssued && (
                      <button
                        type="button"
                        disabled={cancelling}
                        onClick={() => void handleCancelOrder(viewingOrder)}
                        className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-lg"
                      >
                        {cancelling ? 'Cancelling...' : 'Cancel Production Plan'}
                      </button>
                    )}
                </div>
                <button
                  type="button"
                  onClick={() => setViewingOrder(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-order-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 id="delete-order-title" className="text-base font-semibold text-[#3B4F4E]">
              Delete Production Order
            </h2>
            <p className="text-sm text-slate-600">
              Permanently remove{' '}
              <span className="font-mono font-semibold text-[#3B4F4E]">
                {deletingOrder.orderNumber}
              </span>{' '}
              and its planned material requirements from Firestore?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingOrder(null)}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteOrder()}
                disabled={deleting}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg"
              >
                {deleting ? 'Deleting...' : 'Delete Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
