import { Controller, Get, Patch, Body, Param, UseGuards, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { BusinessAuthGuard } from '../business/business-auth.guard';
import { GetBusiness } from '../business/get-business.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMAGE_MIME_TYPES, LocalStorageService } from '../resumes/local-storage.service';

@Controller()
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly localStorageService: LocalStorageService
  ) {}

  @Get('companies')
  async findAll() {
    return this.companiesService.findAllApproved();
  }

  @Get('companies/:id')
  async findOne(@Param('id') id: string) {
    return this.companiesService.findOneApproved(id);
  }

  @Get('business/company')
  @UseGuards(BusinessAuthGuard)
  async getOwnCompany(@GetBusiness() business: any) {
    return this.companiesService.findOne(business.company.id, business.id);
  }

  @Patch('business/company')
  @UseGuards(BusinessAuthGuard)
  async updateOwnCompany(
    @GetBusiness() business: any,
    @Body() updateCompanyDto: UpdateCompanyDto
  ) {
    return this.companiesService.update(business.company.id, business.id, updateCompanyDto);
  }

  @Post('business/company/logo')
  @UseGuards(BusinessAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, callback) => {
        if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException('Only PNG, JPEG, or WEBP images are allowed'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadLogo(
    @GetBusiness() business: any,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new BadRequestException('Heç bir fayl yüklənməyib');
    }
    const fileUrl = await this.localStorageService.uploadBuffer(
      file.buffer,
      file.mimetype
    );
    const updated = await this.companiesService.update(business.company.id, business.id, { logo: fileUrl });
    if (business.company.logo && business.company.logo !== fileUrl) {
      await this.localStorageService.deleteFile(business.company.logo);
    }
    return updated;
  }
}
