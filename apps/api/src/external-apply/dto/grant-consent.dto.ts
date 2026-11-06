import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, Length, Matches, ValidateNested } from 'class-validator';

class ApprovedDocumentDto {
  @IsIn(['CV', 'ID_DOCUMENT'])
  kind: 'CV' | 'ID_DOCUMENT';

  @Matches(/^[a-f0-9]{64}$/)
  sha256: string;
}

/**
 * The candidate's authority echoes exactly what they were shown: the
 * destination host, the recipient notice fingerprint/version, the fingerprint
 * of the disclosed profile values, every field key and every document hash.
 * Any mismatch with what the server would transmit now is refused.
 */
export class GrantConsentDto {
  @IsString()
  @Length(1, 255)
  destinationHost: string;

  @Matches(/^[a-f0-9]{64}$/)
  noticeHash: string;

  @IsString()
  @Length(1, 100)
  noticeVersion: string;

  @Matches(/^[a-f0-9]{64}$/)
  disclosureHash: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  approvedFields: string[];

  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ApprovedDocumentDto)
  approvedDocuments: ApprovedDocumentDto[];

  @IsString()
  @Length(20, 5000)
  motivationLetter: string;
}
