import { auth, currentUser } from '@clerk/nextjs/server';
import { AppError } from '@/lib/errors';
import { UserRepository } from '@/repositories/user.repository';
import { UserService } from '@/services/user.service';

export type LocalUser = NonNullable<Awaited<ReturnType<typeof UserRepository.findUserByClerkId>>>;

/**
 * Resolve the authenticated local User from Clerk session.
 * Never reads a client-supplied userId. JIT-creates the local row as a webhook backstop.
 */
export async function requireUser(): Promise<LocalUser> {
  const session = await auth();
  const clerkId = session.userId;
  if (!clerkId) {
    throw AppError.unauthorized();
  }

  const existing = await UserRepository.findUserByClerkId(clerkId);
  if (existing) {
    return existing;
  }


  // create account if doesn't exists
  const clerkUser = await currentUser();
  if (!clerkUser || clerkUser.id !== clerkId) {
    throw AppError.unauthorized();
  }

  const email = clerkUser.primaryEmailAddress?.emailAddress;
  const name =
    clerkUser.fullName?.trim() ||
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
    email ||
    clerkId;

  return UserService.createUserWithInitialCredits(clerkId, email, name);
}
