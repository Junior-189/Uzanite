import { Injectable } from '@nestjs/common';
import { PaymentAdapter, PaymentProviderName } from './payment-adapter.interface';
import { manualAdapter } from './manual.adapter';
import { clickpesaAdapter } from './clickpesa.adapter';
import { azampayAdapter } from './azampay.adapter';

@Injectable()
export class PaymentAdaptersService {
  private readonly adapters: Record<string, PaymentAdapter> = {
    [manualAdapter.name]: manualAdapter,
    [clickpesaAdapter.name]: clickpesaAdapter,
    [azampayAdapter.name]: azampayAdapter,
  };

  get(name: string): PaymentAdapter | null {
    return this.adapters[String(name).toLowerCase()] ?? null;
  }

  list(): Array<{ name: string; enabled: boolean }> {
    return Object.values(this.adapters).map((a) => ({ name: a.name, enabled: a.enabled() }));
  }

  names(): PaymentProviderName[] {
    return Object.keys(this.adapters) as PaymentProviderName[];
  }
}
