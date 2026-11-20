import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Atomically allocate next document number for a module (tenant-scoped). */
export async function nextDocumentNumber(
  tx: Tx,
  organizationId: string,
  module: string,
  prefix: string,
  padding = 4
): Promise<string> {
  const year = new Date().getFullYear();
  const existing = await tx.documentSequence.findUnique({
    where: {
      organizationId_module_year: { organizationId, module, year },
    },
  });

  let currentNumber: number;
  let pad = padding;
  if (!existing) {
    const created = await tx.documentSequence.create({
      data: {
        organizationId,
        module,
        prefix,
        year,
        currentNumber: 1,
        padding,
      },
    });
    currentNumber = created.currentNumber;
    pad = created.padding;
  } else {
    const updated = await tx.documentSequence.update({
      where: { id: existing.id },
      data: { currentNumber: { increment: 1 } },
    });
    currentNumber = updated.currentNumber;
    pad = updated.padding;
  }

  return `${prefix}-${year}-${String(currentNumber).padStart(pad, "0")}`;
}
