import { IsString } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsString()
  planId: string;
}
