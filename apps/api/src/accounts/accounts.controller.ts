import { Body, Controller, Delete, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { DeleteAccountDto } from '../auth/dto/delete-account.dto';
import { AccountDeletionService } from './account-deletion.service';

// Lives outside AuthModule because deletion needs BillingModule, which itself
// depends on AuthModule. Same route as before: DELETE /auth/account.
@Controller('auth')
export class AccountsController {
  constructor(private deletion: AccountDeletionService) {}

  @Delete('account')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  deleteAccount(@GetUser('id') userId: string, @Body() body: DeleteAccountDto) {
    return this.deletion.deleteOwnAccount(userId, body.password);
  }
}
