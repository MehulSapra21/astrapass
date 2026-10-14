import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Attempt to fetch from the users table we just created
    const { data, error } = await supabase.from('users').select('*').limit(1);
    
    if (error) {
      return NextResponse.json({ success: false, message: 'Database connection failed', error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: '✅ Supabase connection is successful!',
      data 
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}