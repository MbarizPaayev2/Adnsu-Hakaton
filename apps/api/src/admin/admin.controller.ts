import { BadRequestException, Controller, Get, Patch, Post, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminSessionGuard } from './admin-session.guard';
import { GetAdminUser } from './get-admin-user.decorator';
import { AdminPermission } from './permissions';
import { RejectCompanyDto } from './dto/reject-company.dto';
import { RefundEmployerPurchaseDto } from './dto/refund-employer-purchase.dto';

@Controller('admin')
@UseGuards(AdminSessionGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('companies')
  @AdminPermission('companies.read')
  async listCompanies(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string
  ) {
    return this.adminService.listCompanies(Number(page), Number(limit), status);
  }

  @Get('companies/:id')
  @AdminPermission('companies.read')
  async getCompany(@Param('id') id: string) {
    return this.adminService.getCompany(id);
  }

  @Patch('companies/:id/approve')
  @AdminPermission('companies.moderate')
  async approveCompany(@Param('id') id: string, @GetAdminUser('id') adminUserId: string) {
    return this.adminService.approveCompany(id, adminUserId);
  }

  @Patch('companies/:id/reject')
  @AdminPermission('companies.moderate')
  async rejectCompany(
    @Param('id') id: string,
    @Body() dto: RejectCompanyDto,
    @GetAdminUser('id') adminUserId: string,
  ) {
    return this.adminService.rejectCompany(id, dto.reason, adminUserId);
  }

  @Get('users')
  @AdminPermission('users.read')
  async listUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
  ) {
    return this.adminService.listUsers(Number(page), Number(limit), search);
  }

  @Get('users/:id')
  @AdminPermission('users.read')
  async getUser(@Param('id') id: string, @GetAdminUser() admin: { id: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' }) {
    return this.adminService.getUser(id, admin.role, admin.id);
  }

  @Delete('users/:id')
  @AdminPermission('users.delete')
  async deleteUser(@Param('id') id: string, @GetAdminUser('id') adminUserId: string) {
    return this.adminService.deleteUser(id, adminUserId);
  }

  @Delete('companies/:id')
  @AdminPermission('companies.delete')
  async deleteCompany(@Param('id') id: string, @Body() body: { reason?: string }, @GetAdminUser('id') adminUserId: string) {
    return this.adminService.deleteCompany(id, adminUserId, String(body?.reason ?? '').trim().slice(0, 300) || undefined);
  }

  @Post('vacancies/:id/remove')
  @AdminPermission('vacancies.remove')
  async removeVacancy(@Param('id') id: string, @Body() body: { reason?: string }, @GetAdminUser('id') adminUserId: string) {
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('Səbəb tələb olunur');
    return this.adminService.removeVacancy(id, reason, adminUserId);
  }

  @Get('employer-vacancies/pending')
  @AdminPermission('listings.read')
  async pendingEmployerVacancies() {
    return this.adminService.listPendingEmployerVacancies();
  }

  @Patch('employer-vacancies/:id/approve')
  @AdminPermission('listings.moderate')
  async approveEmployerVacancy(@Param('id') id: string, @GetAdminUser('id') adminUserId: string) {
    return this.adminService.moderateEmployerVacancy(id, 'APPROVE', '', adminUserId);
  }

  @Patch('employer-vacancies/:id/reject')
  @AdminPermission('listings.moderate')
  async rejectEmployerVacancy(@Param('id') id: string, @Body() dto: RejectCompanyDto, @GetAdminUser('id') adminUserId: string) {
    return this.adminService.moderateEmployerVacancy(id, 'REJECT', dto.reason, adminUserId);
  }

  @Get('employer-purchases')
  @AdminPermission('companies.read')
  async employerPurchases(@Query('status') status?: string) {
    return this.adminService.listEmployerPurchases(status);
  }

  @Post('employer-purchases/:id/refund')
  @AdminPermission('payments.refund')
  async refundEmployerPurchase(@Param('id') id: string, @Body() dto: RefundEmployerPurchaseDto, @GetAdminUser('id') adminUserId: string) {
    return this.adminService.refundEmployerPurchase(id, dto.reason, !!dto.endListing, adminUserId);
  }

  @Get('vacancies')
  @AdminPermission('vacancies.read')
  async listVacancies() {
    return this.adminService.listVacancies();
  }

  @Get('audit-log')
  @AdminPermission('audit.read')
  async listAuditLog(@Query('limit') limit: string = '50') {
    return this.adminService.listAuditLog(Number(limit));
  }
}
