/**
 * Backward-compatible re-exports for Phase 07 procurement.
 * Core ledger lives in modules/inventory (Phase 08).
 */
export {
  applyMovement,
  getActiveWarehouse,
} from "../inventory/ledger.service.js";
export {
  getStockBalance,
  listMovements,
  listStockBalances,
} from "../inventory/balances.service.js";
export {
  createStockAdjustment,
  postStockAdjustment,
} from "../inventory/documents.service.js";
