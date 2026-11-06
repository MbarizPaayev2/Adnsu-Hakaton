import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ObservedCompaniesService } from './observed-companies.service';

/** Public (no session): observed companies are named by public postings and carry nothing private. */
@Controller('public/companies')
export class ObservedCompaniesController {
  constructor(private readonly companies: ObservedCompaniesService) {}

  @Get()
  list(@Query() query: { q?: string; page?: string; limit?: string; sort?: string }) { return this.companies.list(query); }

  @Get(':id/logo')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header('X-Content-Type-Options', 'nosniff')
  logo(@Param('id') id: string) { return this.companies.logo(id); }

  @Get(':id')
  detail(@Param('id') id: string, @Query() query: { page?: string; limit?: string }) { return this.companies.detail(id, query); }
}
