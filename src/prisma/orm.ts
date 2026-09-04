import { db } from '@/prisma/db';

/** Client surface repositories need inside or outside a transaction. */
export type OrmClient = Pick<typeof db, 'orm'>;
