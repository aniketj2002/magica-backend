import { UserRepository } from '../repositories/user.repository';
import { CreditLedgerRepository } from '../repositories/creditLedger.repository';

export const UserService = {
  async createUserWithInitialCredits(clerkId: string, email: string | undefined, name: string) {
    // Check if the user already exists to make this operation idempotent
    const existingUser = await UserRepository.findUserByClerkId(clerkId);
    if (existingUser) {
      console.log(`User ${clerkId} already exists, skipping creation.`);
      return existingUser;
    }

    const user = await UserRepository.createUser(clerkId, email, name);
    await CreditLedgerRepository.addAdjustment(user.id, 20);
    return user;
  }
};
