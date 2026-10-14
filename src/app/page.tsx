export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-5xl font-bold mb-4">AstraPass</h1>
      <p className="text-xl text-gray-400">Next-Generation Passwordless Authentication</p>
      
      <div className="mt-10 p-6 bg-slate-800 rounded-xl border border-slate-700">
        <p className="text-green-400 font-mono text-sm">✅ Environment successfully initialized.</p>
      </div>
    </main>
  );
}