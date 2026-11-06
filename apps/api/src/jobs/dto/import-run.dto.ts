import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { CollectionOutcome } from '../collection-outcome';

const count = () => [IsInt(), Min(0), Max(1_000_000)];
const field = <T>(...decorators: PropertyDecorator[]) => (target: object, key: string) => decorators.forEach((d) => d(target, key));

/** What a public-source collector observed in one run (see PublicJobCollector). No job content. */
export class ImportRunReportDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{0,30}$/) source: string;
  @IsISO8601() startedAt: string;
  // Only a listing traversed to its verified end may close postings.
  @IsBoolean() complete: boolean;
  @IsOptional() @IsIn(['COMPLETE_CENSUS', 'BOUNDED_PROGRESS', 'UPSTREAM_FAILURE', 'INVALID_DETAIL', 'NO_OPENINGS']) outcome?: CollectionOutcome;
  @field(...count()) pages: number;
  @field(...count()) discovered: number;
  @field(...count()) fetched: number;
  @field(...count()) accepted: number;
  @field(...count()) created: number;
  @field(...count()) updated: number;
  @field(...count()) unchanged: number;
  @field(...count()) reopened: number;
  @field(...count()) expired: number;
  @field(...count()) skipped: number;
  @field(...count()) failed: number;
  @IsOptional() @IsString() @MaxLength(300) error?: string;
  /** The run started mid-listing (a resumed or deep segment). Such a run can never close postings, whatever the collector says about completeness. */
  @IsOptional() @IsBoolean() segment?: boolean;
}
