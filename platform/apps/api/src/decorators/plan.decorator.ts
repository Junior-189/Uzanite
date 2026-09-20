import { SetMetadata } from '@nestjs/common';

export const PLAN_FEATURE_KEY = 'planFeature';
export const PLAN_LIMIT_KEY = 'planLimit';

export const RequirePlanFeature = (feature: string) => SetMetadata(PLAN_FEATURE_KEY, feature);
export const EnforceLimit = (metric: string) => SetMetadata(PLAN_LIMIT_KEY, metric);
