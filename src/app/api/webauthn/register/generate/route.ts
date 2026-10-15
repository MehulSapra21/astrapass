import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { supabase } from '@/lib/supabase';

const rpID = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_RP_ID || 'astrapass.vercel.app' : 'localhost';
const rpName = 'AstraPass';

export async function POST(request: Request) {
  try {
    const { username, fullName, email, voiceprint } = await request.json();
    
    if (!username || !fullName || !email || !voiceprint) {
      return NextResponse.json({ error: 'Username, Name, Email, and Voiceprint are required.' }, { status: 400 });
    }

    let { data: existingUser } = await supabase.from('users').select('*').eq('username', username).single();
    if (existingUser) return NextResponse.json({ error: 'Username is already taken.' }, { status: 400 });

    const { data: newUser, error } = await supabase.from('users').insert({ 
      username, full_name: fullName, email, voiceprint 
    }).select().single();
      
    if (error) throw new Error(`Supabase Error: ${error.message}`);
    
    const options = await generateRegistrationOptions({
      rpName, rpID,
      userID: new TextEncoder().encode(newUser.id),
      userName: newUser.username,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    await supabase.from('users').update({ current_challenge: options.challenge }).eq('id', newUser.id);
    return NextResponse.json(options);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}