import { WorkflowDocumentType } from "@prisma/client";
import type { TenantId } from "../../../types/tenant.js";

const wf = { fromWorkflow: true as const };

export async function applyDomainDecision(
  documentType: WorkflowDocumentType,
  decision: "APPROVED" | "REJECTED",
  tenantId: TenantId,
  documentId: string,
  userId?: string | null,
  rejectionReason?: string
) {
  switch (documentType) {
    case WorkflowDocumentType.PURCHASE_REQUEST: {
      const purchasing = await import("../../procurement/purchasing.service.js");
      if (decision === "APPROVED") {
        return purchasing.approvePurchaseRequest(tenantId, documentId, userId ?? undefined, wf);
      }
      return purchasing.rejectPurchaseRequest(
        tenantId,
        documentId,
        rejectionReason,
        userId ?? undefined,
        wf
      );
    }
    case WorkflowDocumentType.PURCHASE_ORDER: {
      const purchasing = await import("../../procurement/purchasing.service.js");
      if (decision === "APPROVED") {
        return purchasing.issuePurchaseOrder(tenantId, documentId, userId ?? undefined, wf);
      }
      return purchasing.rejectPurchaseOrderWorkflow(tenantId, documentId, rejectionReason);
    }
    case WorkflowDocumentType.SALES_DISCOUNT: {
      const sales = await import("../../sales/sales.service.js");
      if (decision === "APPROVED") {
        return sales.confirmSalesOrder(tenantId, documentId, wf);
      }
      return sales.rejectSalesDiscountWorkflow(tenantId, documentId, rejectionReason);
    }
    case WorkflowDocumentType.SALES_RETURN: {
      const sales = await import("../../sales/sales.service.js");
      if (decision === "APPROVED") {
        return sales.postSalesReturn(tenantId, documentId, userId ?? undefined, wf);
      }
      return sales.cancelSalesReturnWorkflow(tenantId, documentId, rejectionReason);
    }
    case WorkflowDocumentType.EXPENSE: {
      const expenses = await import("../../finance/expenses.service.js");
      if (decision === "APPROVED") {
        return expenses.approveExpense(tenantId, documentId, userId ?? undefined, wf);
      }
      return expenses.rejectExpense(
        tenantId,
        documentId,
        rejectionReason,
        userId ?? undefined,
        wf
      );
    }
    case WorkflowDocumentType.PAYMENT: {
      const vouchers = await import("../../finance/vouchers.service.js");
      if (decision === "APPROVED") {
        return vouchers.postFinPayment(tenantId, documentId, userId ?? undefined, wf);
      }
      return vouchers.cancelFinPaymentWorkflow(tenantId, documentId, rejectionReason);
    }
    case WorkflowDocumentType.STOCK_ADJUSTMENT: {
      const inventoryDocs = await import("../../inventory/documents.service.js");
      if (decision === "APPROVED") {
        return inventoryDocs.postStockAdjustment(tenantId, documentId, userId ?? undefined, wf);
      }
      return inventoryDocs.cancelStockAdjustmentWorkflow(tenantId, documentId, rejectionReason);
    }
    case WorkflowDocumentType.LEAVE_REQUEST: {
      const leave = await import("../../hr/leave.service.js");
      return leave.decideLeaveRequest(
        tenantId,
        documentId,
        decision,
        rejectionReason,
        userId ?? undefined,
        wf
      );
    }
    case WorkflowDocumentType.PAYROLL_RUN: {
      const payroll = await import("../../hr/payroll.service.js");
      if (decision === "APPROVED") {
        return payroll.approveRun(tenantId, documentId, userId ?? undefined, wf);
      }
      return payroll.rejectRunWorkflow(tenantId, documentId, rejectionReason);
    }
    case WorkflowDocumentType.MANUAL_JOURNAL: {
      const journals = await import("../../accounting/journal.service.js");
      if (decision === "APPROVED") {
        return journals.postJournal(tenantId, documentId, userId ?? undefined, wf);
      }
      return journals.rejectJournalWorkflow(tenantId, documentId, rejectionReason);
    }
    default:
      return null;
  }
}
