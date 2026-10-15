import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) return NextResponse.json({ error: 'Username required' }, { status: 400 });

    const { data, error } = await supabase
      .from('users')
      .select('username, full_name, email, created_at')
      .eq('username', username)
      .single();

    if (error || !data) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}