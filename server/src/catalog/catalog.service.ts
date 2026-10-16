import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EquipmentType } from '../entities';
import { EQUIPMENT_SEED } from './seed';

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(@InjectRepository(EquipmentType) private readonly types: Repository<EquipmentType>) {}

  async onModuleInit() {
    // 없는 장비만 추가하고, 운영자가 바꾼 요금은 덮어쓰지 않는다.
    for (const seed of EQUIPMENT_SEED) {
      if (!(await this.types.existsBy({ code: seed.code }))) await this.types.save({ ...seed, active: true });
    }
  }

  list() {
    return this.types.find({ where: { active: true }, order: { sortOrder: 'ASC' } });
  }

  async get(code: string) {
    const t = await this.types.findOneBy({ code });
    if (!t || !t.active) throw new NotFoundException(`없는 장비 종류입니다: ${code}`);
    return t;
  }

  async updateRates(code: string, rates: Record<string, any>) {
    const t = await this.get(code);
    t.rates = rates;
    return this.types.save(t);
  }
}
