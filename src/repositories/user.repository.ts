import { db } from '../prisma/db';
import { Temporal } from '@js-temporal/polyfill';

export const UserRepository = {
  async findUserByClerkId(clerkId: string) {
    return await db.orm.public.User.where({ clerkId }).first();
  },

  async createUser(clerkId: string, email: string | undefined, name: string, initialCredits: number) {
    return await db.orm.public.User.create({
      clerkId,
      email,
      name,
      balance: initialCredits,
      updatedAt: Temporal.Now.instant(),
    });
  }
};
