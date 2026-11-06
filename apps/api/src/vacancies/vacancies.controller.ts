import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { VacanciesService } from './vacancies.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { BusinessAuthGuard } from '../business/business-auth.guard';
import { GetBusiness } from '../business/get-business.decorator';

@Controller()
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Get('vacancies')
  async findAllPublic(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    return this.vacanciesService.findAllPublic(Number(page), Number(limit));
  }

  @Get('vacancies/:id')
  async findOnePublic(@Param('id') id: string) {
    return this.vacanciesService.findOnePublic(id);
  }

  @Post('business/vacancies')
  @UseGuards(BusinessAuthGuard)
  async create(
    @GetBusiness() business: any,
    @Body() createVacancyDto: CreateVacancyDto
  ) {
    return this.vacanciesService.create(business, createVacancyDto);
  }

  @Get('business/vacancies')
  @UseGuards(BusinessAuthGuard)
  async findAllOwn(@GetBusiness() business: any) {
    return this.vacanciesService.findAllOwn(business.company.id);
  }

  @Get('business/vacancies/:id')
  @UseGuards(BusinessAuthGuard)
  async findOneOwn(
    @GetBusiness() business: any,
    @Param('id') id: string
  ) {
    return this.vacanciesService.findOneOwn(id, business.company.id);
  }

  @Patch('business/vacancies/:id')
  @UseGuards(BusinessAuthGuard)
  async update(
    @GetBusiness() business: any,
    @Param('id') id: string,
    @Body() updateVacancyDto: UpdateVacancyDto
  ) {
    return this.vacanciesService.update(id, business.company.id, updateVacancyDto);
  }

  @Patch('business/vacancies/:id/pause')
  @UseGuards(BusinessAuthGuard)
  async pause(
    @GetBusiness() business: any,
    @Param('id') id: string
  ) {
    return this.vacanciesService.updateStatus(id, business.company.id, 'PAUSED');
  }

  @Patch('business/vacancies/:id/reactivate')
  @UseGuards(BusinessAuthGuard)
  async reactivate(
    @GetBusiness() business: any,
    @Param('id') id: string
  ) {
    return this.vacanciesService.updateStatus(id, business.company.id, 'ACTIVE');
  }

  @Delete('business/vacancies/:id')
  @UseGuards(BusinessAuthGuard)
  async remove(
    @GetBusiness() business: any,
    @Param('id') id: string
  ) {
    return this.vacanciesService.updateStatus(id, business.company.id, 'DELETED');
  }
}
