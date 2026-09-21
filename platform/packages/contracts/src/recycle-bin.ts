import { z } from 'zod';
import { uuid } from './common';

// Entity types with soft-delete support on the platform. `contacts` (used by the
// legacy client tab) has no platform implementation yet.
export const recycleBinType = z.enum(['orders', 'products', 'notifications', 'contacts']);

export const recycleBinItemParam = z.object({ type: recycleBinType, id: uuid });

export type RecycleBinType = z.infer<typeof recycleBinType>;
