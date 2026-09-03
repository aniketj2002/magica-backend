import { db } from '../prisma/db';
import { Temporal } from '@js-temporal/polyfill';

export const UserRepository = {
  async findUserByClerkId(clerkId: string) {
    // Attempt to find the user by their unique clerkId
    return await db.orm.public.User.findFirst({
      where: { clerkId },
    });
  },

  async createUser(clerkId: string, email: string | undefined, name: string) {
    return await db.orm.public.User.create({
      clerkId,
      email,
      name,
      updatedAt: Temporal.Now.instant(),
    });
  }
};
