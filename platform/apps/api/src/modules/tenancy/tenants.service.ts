import { Injectable, NotFoundException } from '@nestjs/common';
import { UpsertPaymentMethodInput, UpdateTenantInput } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../ids/id';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(tenantId: string) {
    const tenant = await this.prisma.db.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: { settings: true, paymentMethods: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return { success: true, tenant };
  }

  async update(tenantId: string, input: UpdateTenantInput) {
    const tenant = await this.prisma.db.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const updated = await this.prisma.db.tenant.update({
      where: { id: tenantId },
      data: {
        name: input.name ?? undefined,
        phone: input.phone ?? undefined,
        currency: input.currency ?? undefined,
        timezone: input.timezone ?? undefined,
      },
    });

    if (input.theme) {
      await this.prisma.db.tenantSettings.upsert({
        where: { tenantId },
        update: { theme: input.theme },
        create: { tenantId, theme: input.theme },
      });
    }
    return { success: true, tenant: updated };
  }

  async listPaymentMethods(tenantId: string) {
    const methods = await this.prisma.db.tenantPaymentMethod.findMany({ where: { tenantId } });
    return { success: true, paymentMethods: methods };
  }

  async upsertPaymentMethod(tenantId: string, input: UpsertPaymentMethodInput) {
    const method = await this.prisma.db.tenantPaymentMethod.upsert({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
      update: { number: input.number, accountName: input.accountName || null, active: input.active },
      create: {
        id: newId(),
        tenantId,
        provider: input.provider,
        number: input.number,
        accountName: input.accountName || null,
        active: input.active,
      },
    });
    return { success: true, paymentMethod: method };
  }
}
