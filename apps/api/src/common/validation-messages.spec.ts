import { IsEmail, IsOptional, IsString, MinLength, Equals, ValidateNested, validateSync } from 'class-validator';
import { Type } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { validationException } from './validation-messages';

class Child { @IsEmail() email!: string }
class Dto {
  @IsString() @MinLength(2) organization!: string;
  @IsEmail() email!: string;
  @Equals(true, { message: 'Əlaqə üçün razılıq lazımdır' }) consent!: boolean;
  @IsOptional() @ValidateNested() @Type(() => Child) child?: Child;
}

describe('validationException', () => {
  it('turns class-validator defaults into Azerbaijani, keeps authored messages, never names internal fields', () => {
    const errors = validateSync(plainToInstance(Dto, { organization: 'X', email: 'bad', consent: false, child: { email: 'also-bad' } }));
    const body = validationException(errors).getResponse() as { message: string[] };
    expect(body.message).toEqual(['Mətn çox qısadır.', 'E-poçt ünvanı düzgün deyil.', 'Əlaqə üçün razılıq lazımdır']);
    expect(JSON.stringify(body)).not.toMatch(/organization|must be/);
  });
});
