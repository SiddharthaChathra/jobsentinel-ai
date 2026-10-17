'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { JobsQuery, PostingType } from '@/lib/types/jobs';

// Re-export the canonical type so consumers can import from one place.
export type { JobsQuery } from '@/lib/types/jobs';

export function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const getQuery = useCallback((): JobsQuery => {
    const q = searchParams.get('q') ?? undefined;
    const roleFamily = searchParams.getAll('roleFamily');
    const category = searchParams.getAll('category');
    const companyId = searchParams.get('companyId') ?? undefined;
    const location = searchParams.get('location') ?? undefined;
    const remote = searchParams.get('remote') === 'true' ? true : undefined;
    const fresherOnly = searchParams.has('fresherOnly')
      ? searchParams.get('fresherOnly') === 'true'
      : undefined;
    const experienceLevel = searchParams.getAll('experienceLevel');
    const rawPostingType = searchParams.getAll('postingType');
    const postingType = rawPostingType
      .flatMap((p) => p.split(','))
      .map((p) => p.trim())
      .filter(Boolean) as PostingType[];
    const minScore = searchParams.get('minScore')
      ? Number(searchParams.get('minScore'))
      : undefined;
    const priority = searchParams.getAll('priority');
    const validationStatus = searchParams.getAll('validationStatus');
    const status = searchParams.get('status') ?? undefined;
    const postedAfter = searchParams.get('postedAfter') ?? undefined;
    const sourceId = searchParams.get('sourceId') ?? undefined;
    const salaryMin = searchParams.get('salaryMin')
      ? Number(searchParams.get('salaryMin'))
      : undefined;
    const rawUndisclosed = searchParams.get('includeUndisclosedSalary');
    // Checked by default; send false only when unchecked and salaryMin is set (R6, D111).
    const includeUndisclosedSalary =
      rawUndisclosed === 'false' && salaryMin !== undefined ? false : undefined;
    const saved = searchParams.get('saved') === 'true' ? true : undefined;
    const sort = searchParams.get('sort') ?? undefined;
    const cursor = searchParams.get('cursor') ?? undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

    return {
      ...(q ? { q } : {}),
      ...(roleFamily.length > 0 ? { roleFamily } : {}),
      ...(category.length > 0 ? { category } : {}),
      ...(companyId ? { companyId } : {}),
      ...(location ? { location } : {}),
      ...(remote !== undefined ? { remote } : {}),
      ...(fresherOnly !== undefined ? { fresherOnly } : {}),
      ...(experienceLevel.length > 0 ? { experienceLevel } : {}),
      ...(postingType.length > 0 ? { postingType } : {}),
      ...(minScore !== undefined ? { minScore } : {}),
      ...(priority.length > 0 ? { priority } : {}),
      ...(validationStatus.length > 0 ? { validationStatus } : {}),
      ...(status ? { status } : {}),
      ...(postedAfter ? { postedAfter } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(salaryMin !== undefined ? { salaryMin } : {}),
      ...(includeUndisclosedSalary !== undefined ? { includeUndisclosedSalary } : {}),
      ...(saved !== undefined ? { saved } : {}),
      ...(sort ? { sort } : {}),
      ...(cursor ? { cursor } : {}),
      ...(limit !== undefined ? { limit } : {}),
    } as JobsQuery;
  }, [searchParams]);

  const setQuery = useCallback(
    (newQuery: Partial<JobsQuery>) => {
      const params = new URLSearchParams(searchParams.toString());

      Object.entries(newQuery).forEach(([key, value]) => {
        if (
          value === undefined ||
          value === null ||
          value === '' ||
          (key === 'includeUndisclosedSalary' && value === true)
        ) {
          params.delete(key);
        } else if (Array.isArray(value)) {
          params.delete(key);
          if (key === 'postingType') {
            if (value.length > 0) {
              params.set(key, value.join(','));
            }
          } else {
            value.forEach((v) => params.append(key, String(v)));
          }
        } else {
          params.set(key, String(value));
        }
      });

      // includeUndisclosedSalary is only relevant with salaryMin; drop if salaryMin is gone
      if (!params.has('salaryMin')) {
        params.delete('includeUndisclosedSalary');
      }

      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const updateFilter = useCallback(
    (key: keyof JobsQuery, value: unknown) => {
      setQuery({ [key]: value } as Partial<JobsQuery>);
    },
    [setQuery],
  );

  return {
    query: getQuery(),
    setQuery,
    updateFilter,
  };
}
