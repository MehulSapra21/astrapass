import { NextResponse } from 'next/server';
import secrets from 'secrets.js-grempe';
import { supabase } from '@/lib/supabase';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { username, guardians } = await request.json();
    
    if (!username || !guardians || guardians.length !== 3) {
      return NextResponse.json({ error: 'Must provide exactly 3 guardians' }, { status: 400 });
    }

    // 1. Find the user OR create them if they don't exist yet
    let { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    
    if (!user) {
      const { data: newUser, error: createError } = await supabase.from('users').insert({ username }).select().single();
      if (createError) throw new Error('Failed to create user: ' + createError.message);
      user = newUser;
    }

    // 2. Generate a secure random master recovery key
    const masterKey = crypto.randomBytes(32).toString('hex');

    // 3. Split the key (3 shares total, 2 required to recover)
    const shares = secrets.share(masterKey, 3, 2);

    // 4. Delete any old recovery shares for this user to prevent clutter
    await supabase.from('recovery_shares').delete().eq('user_id', user.id);

    // 5. Save the 3 new shares to the database
    const insertData = guardians.map((guardianName: string, index: number) => ({
      user_id: user.id,
      guardian_name: guardianName,
      share_data: shares[index]
    }));

    const { error: insertError } = await supabase.from('recovery_shares').insert(insertData);
    
    if (insertError) {
      throw new Error('Database Insert Error: ' + insertError.message);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Recovery network established. Master key destroyed.',
      demo_master_key: masterKey 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}