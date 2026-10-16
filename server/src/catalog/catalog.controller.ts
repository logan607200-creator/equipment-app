import { Controller, Get } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('equipment-types')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.list();
  }
}
