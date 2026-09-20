import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../ids/id';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const categories = await this.prisma.db.category.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return { success: true, categories };
  }

  async create(tenantId: string, name: string) {
    try {
      const category = await this.prisma.db.category.create({ data: { id: newId(), tenantId, name } });
      return { success: true, category };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Category already exists');
      }
      throw err;
    }
  }

  async remove(tenantId: string, id: string) {
    const res = await this.prisma.db.category.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException('Category not found');
    return { success: true };
  }
}
