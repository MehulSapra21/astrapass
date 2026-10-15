import Link from 'next/link';

export default function Dashboard() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 font-sans text-white">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-12 text-center shadow-2xl backdrop-blur-xl">
        <h1 className="mb-4 text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400 drop-shadow-md">
          Dashboard
        </h1>
        <p className="mb-10 text-sm font-medium text-slate-400 uppercase tracking-widest">
          Secure Enclave Accessed
        </p>
        
        <Link
          href="/"
          className="inline-block rounded-xl bg-slate-800 px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-slate-300 shadow-lg shadow-slate-900/50 ring-1 ring-slate-700 transition-all hover:bg-slate-700 hover:text-white hover:ring-slate-600 active:scale-95"
        >
          Sign Out / Back to Login
        </Link>
      </div>
    </main>
  );
}