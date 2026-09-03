import { db } from '../prisma/db';

export const CreditLedgerRepository = {
  async addAdjustment(userId: string, amount: number) {
    return await db.orm.public.CreditLedger.create({
      userId,
      type: 'ADJUSTMENT',
      amount,
    });
  }
};
