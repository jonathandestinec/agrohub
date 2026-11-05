import { randomUUID } from "node:crypto";
import type { LedgerAccount, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { koboFromDb } from "@/lib/money";

// Every money movement on an order, as balanced groups of entries (positive = debit). Per order
// the entries sum to zero. Lines per kind:
//   payment.captured   PAYSTACK_BALANCE +T, HELD -T
//   paystack.fee       PAYSTACK_FEES +f, PAYSTACK_BALANCE -f   (AgroHub absorbs Paystack's fee)
//   refund.issued      HELD +R, REFUND_PAYABLE -R
//   refund.processed   REFUND_PAYABLE +R, PAYSTACK_BALANCE -R
//   order.released     HELD +(T-R), COOPERATIVE_PAYABLE -c, FARMER_PAYABLE -f each, PLATFORM_FEE -fee
//   payout.paid        COOPERATIVE_PAYABLE or FARMER_PAYABLE +p, PAYSTACK_BALANCE -p
export type LedgerKind =
  | "payment.captured"
  | "paystack.fee"
  | "refund.issued"
  | "refund.processed"
  | "order.released"
  | "payout.paid";

export type LedgerLine = { account: LedgerAccount; amountKobo: number; recipientRef?: string };

export async function postLedger(
  tx: Prisma.TransactionClient,
  input: { orderId: string; kind: LedgerKind; lines: LedgerLine[]; now?: Date },
): Promise<string> {
  let sum = BigInt(0);
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.amountKobo) || line.amountKobo === 0) throw new Error("LEDGER_BAD_LINE");
    sum += BigInt(line.amountKobo);
  }
  if (input.lines.length < 2 || sum !== BigInt(0)) throw new Error("LEDGER_UNBALANCED");
  const groupId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: input.lines.map((line) => ({
      orderId: input.orderId,
      groupId,
      kind: input.kind,
      account: line.account,
      recipientRef: line.recipientRef ?? null,
      amountKobo: BigInt(line.amountKobo),
      ...(input.now ? { createdAt: input.now } : {}),
    })),
  });
  return groupId;
}

// System read: the balance of one account (or the whole order) in an order's ledger.
export async function ledgerBalance(orderId: string, account?: LedgerAccount): Promise<number> {
  const result = await prisma.ledgerEntry.aggregate({
    where: { orderId, ...(account ? { account } : {}) },
    _sum: { amountKobo: true },
  });
  return koboFromDb(result._sum.amountKobo ?? BigInt(0));
}
