import { db } from '../prisma/db';

export const UserRepository = {
  async createUser(clerkId: string, email: string | undefined, name: string) {
    return await db.orm.public.User.create({
      clerkId,
      email,
      name,
      updatedAt: new Date(),
    });
  }
};
