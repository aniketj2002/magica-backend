import { UserRepository } from '../repositories/user.repository';
import { CreditLedgerRepository } from '../repositories/creditLedger.repository';

export const UserService = {
  async createUserWithInitialCredits(clerkId: string, email: string | undefined, name: string) {
    const user = await UserRepository.createUser(clerkId, email, name);
    await CreditLedgerRepository.addAdjustment(user.id, 20);
    return user;
  }
};
