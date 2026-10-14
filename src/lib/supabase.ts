import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// We use the service_role key to bypass Row Level Security 
// purely for backend WebAuthn API route execution.
export const supabase = createClient(supabaseUrl, supabaseKey);