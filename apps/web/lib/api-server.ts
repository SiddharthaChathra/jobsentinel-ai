import { createApiClient, type ApiClient } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';

/** API client for Server Components / route handlers, using the session cookie's access token. */
export async function serverApi(): Promise<ApiClient> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  return createApiClient({ getToken: async () => token });
}
