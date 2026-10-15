import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { supabase } from '@/lib/supabase';

const rpID = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_RP_ID || 'astrapass.vercel.app' : 'localhost';
const rpName = 'AstraPass';

export async function POST(request: Request) {
  try {
    const { username, fullName, email } = await request.json();
    
    if (!username) return NextResponse.json({ error: 'Username is required' }, { status: 400 });

    // 1. Check if username is already taken
    let { data: existingUser } = await supabase.from('users').select('*').eq('username', username).single();
    
    if (existingUser) {
      return NextResponse.json({ error: 'Username is already taken. Please choose another.' }, { status: 400 });
    }

    // 2. Validate new details
    if (!fullName || !email) {
      return NextResponse.json({ error: 'Full Name and Email are required for new accounts.' }, { status: 400 });
    }

    // 3. Create the new user with details
    const { data: newUser, error } = await supabase.from('users').insert({ 
      username, 
      full_name: fullName, 
      email 
    }).select().single();
      
    if (error) throw new Error(`Supabase Error: ${error.message}`);
    
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(newUser.id),
      userName: newUser.username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await supabase.from('users').update({ current_challenge: options.challenge }).eq('id', newUser.id);

    return NextResponse.json(options);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}