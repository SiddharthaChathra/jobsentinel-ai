'use client';

import { useMemo } from 'react';
import { createApiClient, type ApiClient } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';

/** API client bound to the current Supabase session (token refreshed by supabase-js). */
export function useApi(): ApiClient {
  return useMemo(() => {
    const supabase = createClient();
    return createApiClient({
      getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    });
  }, []);
}
