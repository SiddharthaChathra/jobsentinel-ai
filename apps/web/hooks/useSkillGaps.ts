'use client';

import { useQuery } from '@tanstack/react-query';
import type { SkillGapReport } from '@jobsentinel/types';
import { useApi } from './use-api';

export const SKILL_GAPS_KEY = ['skill-gaps'] as const;

export function useSkillGaps() {
  const api = useApi();
  return useQuery({
    queryKey: SKILL_GAPS_KEY,
    queryFn: async () => {
      const res = await api.get<SkillGapReport>('/skill-gaps');
      return res.data;
    },
  });
}
