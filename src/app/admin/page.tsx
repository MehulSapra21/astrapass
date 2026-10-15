import { supabase } from '@/lib/supabase';

export const revalidate = 0;

export default async function AdminDashboard() {
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  const { data: authenticators, error: authError } = await supabase
    .from('authenticators')
    .select('*');

  if (usersError || authError) {
    return <div className="text-red-500 p-8">Failed to load admin data.</div>;
  }

  return (
    <main className="min-h-screen bg-slate-900 p-8 text-slate-200">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">AstraPass Security Command Center</h1>
          <a href="/" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors">
            Back to Login
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
            <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">Total Users</h3>
            <p className="text-4xl font-bold text-blue-400">{users?.length || 0}</p>
          </div>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
            <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">Registered Passkeys</h3>
            <p className="text-4xl font-bold text-emerald-400">{authenticators?.length || 0}</p>
          </div>
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
            <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">System Status</h3>
            <p className="text-xl font-bold text-purple-400 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-purple-500 animate-pulse"></span>
              FIDO2 Enforced
            </p>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-xl font-bold text-white">Identity Directory</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/50 text-slate-400">
                <tr>
                  <th className="px-6 py-4 font-semibold">User ID</th>
                  <th className="px-6 py-4 font-semibold">Username</th>
                  <th className="px-6 py-4 font-semibold">Registered Devices (Passkeys)</th>
                  <th className="px-6 py-4 font-semibold">Joined</th>
                  <th className="px-6 py-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {users?.map((user) => {
                  const userDevices = authenticators?.filter(a => a.user_id === user.id) || [];
                  return (
                    <tr key={user.id} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">{user.id.split('-')[0]}...</td>
                      <td className="px-6 py-4 font-medium text-white">{user.username}</td>
                      <td className="px-6 py-4">
                        {userDevices.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {userDevices.map((device, idx) => (
                              <span key={idx} className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-800/50">
                                {device.device_type === 'singleDevice' ? '💻 Local Device' : '📱 Cross-Platform'} (Uses: {device.counter})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 text-xs italic">No hardware keys</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-xs">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="px-3 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-800/50 rounded transition-colors text-xs font-medium">
                          Revoke Credentials
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}