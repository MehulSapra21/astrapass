import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { supabase } from '@/lib/supabase';

// The Relying Party ID is your domain name
const rpID = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_RP_ID || 'astrapass.vercel.app' : 'localhost';
const rpName = 'AstraPass';

export async function POST(request: Request) {
  try {
    const { username } = await request.json();
    if (!username) return NextResponse.json({ error: 'Username required' }, { status: 400 });

    // 1. Check if user exists
    let { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    
    if (!user) {
      // 2. Try to create user and catch EXACT database error
      const { data: newUser, error } = await supabase.from('users').insert({ username }).select().single();
      
      // THIS IS THE NEW LINE: It will tell us exactly why Supabase rejected it on Vercel
      if (error) throw new Error(`Supabase blocked insert: ${error.message} (Check if your Vercel SERVICE_ROLE_KEY is correct)`);
      
      user = newUser;
    }

    const { data: userAuthenticators } = await supabase.from('authenticators').select('*').eq('user_id', user.id);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.username,
      attestationType: 'none',
      excludeCredentials: userAuthenticators?.map((auth) => ({
        id: auth.credential_id,
        type: 'public-key',
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await supabase.from('users').update({ current_challenge: options.challenge }).eq('id', user.id);

    return NextResponse.json(options);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}