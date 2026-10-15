'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const router = useRouter();
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Retrieve the username saved during login
    const savedUser = localStorage.getItem('astrapass_user');
    
    if (!savedUser) {
      router.push('/');
      return;
    }

    // Fetch the user's details from our new API
    fetch(`/api/user?username=${savedUser}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setUserData(data);
        setLoading(false);
      });
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('astrapass_user');
    router.push('/');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 font-sans text-white selection:bg-blue-500/30">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/80 p-10 shadow-2xl backdrop-blur-xl transition-all">
        
        <div className="mb-8 flex items-center justify-between border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400">
              Dashboard
            </h1>
            <p className="text-xs font-medium text-emerald-500/80 uppercase tracking-widest mt-1">
              Secure Enclave Accessed
            </p>
          </div>
          <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-emerald-500 to-blue-500 p-1 shadow-lg shadow-emerald-500/20">
            <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-900 font-bold text-lg">
              {userData?.full_name ? userData.full_name.charAt(0).toUpperCase() : '👤'}
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="py-12 text-center text-slate-500 animate-pulse">Decrypting Identity Profile...</div>
        ) : userData ? (
          <div className="space-y-6 mb-10">
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 shadow-inner">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Subject Identifier (Username)</p>
              <p className="font-mono text-sm text-blue-300">{userData.username}</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 shadow-inner">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Full Legal Name</p>
                <p className="text-sm font-medium text-white">{userData.full_name || 'N/A'}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 shadow-inner">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Clearance Date</p>
                <p className="text-sm font-medium text-white">
                  {new Date(userData.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 shadow-inner">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Encrypted Comms (Email)</p>
              <p className="text-sm font-medium text-emerald-300">{userData.email || 'N/A'}</p>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-red-400">Profile data corrupted or missing.</div>
        )}

        <button
          onClick={handleLogout}
          className="w-full rounded-xl bg-slate-800 px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-slate-300 shadow-lg shadow-slate-900/50 ring-1 ring-slate-700 transition-all hover:bg-slate-700 hover:text-white hover:ring-slate-600 active:scale-95"
        >
          Close Session / Log Out
        </button>
      </div>
    </main>
  );
}