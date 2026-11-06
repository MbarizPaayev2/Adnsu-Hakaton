import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class RefundEmployerPurchaseDto {
  /** Why the refund is owed (shown in the audit log and kept on the purchase). */
  @IsString()
  @Length(5, 500)
  reason!: string;

  /** Required when the credit was already used for a published listing (a platform failure): the listing is withdrawn when the refund succeeds. */
  @IsOptional()
  @IsBoolean()
  endListing?: boolean;
}
