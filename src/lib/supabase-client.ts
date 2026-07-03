import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import type { Database } from './database.types';

// Getypeerde client: supabase.from('riders') geeft nu typed rows.
// Types her-genereren na een migratie: supabase gen types typescript --linked > src/lib/database.types.ts
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

// Handige row-types voor annotaties in views/api, bv. Row<'riders'>, Row<'general_classification'>
type PublicSchema = Database['public'];
export type Row<T extends keyof PublicSchema['Tables'] | keyof PublicSchema['Views']> =
  T extends keyof PublicSchema['Tables']
    ? PublicSchema['Tables'][T]['Row']
    : T extends keyof PublicSchema['Views']
      ? PublicSchema['Views'][T]['Row']
      : never;
