import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const C: Record<string, string> = {
  certain: '#1d9e75', verified: '#1d9e75', likely: '#ba7517',
  review: '#e24b4a', bundle_manual: '#e24b4a', broken: '#e24b4a',
};

export default function AdminApp() {
  const [session, setSession] = useState<any>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState('settings');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) check(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s); if (s) check(s.user.id); else setIsAdmin(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function check(uid: string) {
    const { data } = await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
    setIsAdmin(!!data?.is_admin);
  }

  if (session === undefined) return <P>Loading…</P>;
  if (!session) return <Login />;
  if (!isAdmin) return <P>Not authorized for admin. <a onClick={() => supabase.auth.signOut()} style={{ color: '#854F0B', cursor: 'pointer' }}>Sign out</a></P>;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24 }}>Admin Dashboard</h1>
        <span style={{ fontSize: 13 }}>{session.user.email} · <a onClick={() => supabase.auth.signOut()} style={{ color: '#854F0B', cursor: 'pointer' }}>Sign out</a></span>
      </div>
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #0002', marginBottom: 16 }}>
        {['settings', 'links'].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            borderBottom: tab === t ? '2px solid #854F0B' : '2px solid transparent',
            color: tab === t ? '#412402' : '#666', fontWeight: tab === t ? 600 : 400,
          }}>{t === 'settings' ? 'Settings & Stats' : 'Download Links'}</button>
        ))}
      </div>
      {tab === 'settings' ? <Settings /> : <Links />}
    </div>
  );
}

const P = ({ children }: any) => <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>{children}</div>;

function Login() {
  const [email, setEmail] = useState('jolly@digitalchiselco.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: any) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  }
  return (
    <form onSubmit={submit} style={{ maxWidth: 360, margin: '60px auto', padding: 24, border: '1px solid #0002', borderRadius: 12 }}>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, marginBottom: 16 }}>Admin sign in</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inp} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" style={inp} />
      {err && <p style={{ color: '#c00', fontSize: 13, margin: '8px 0' }}>{err}</p>}
      <button disabled={busy} style={btn}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function Settings() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { supabase.from('site_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setS(data)); }, []);
  if (!s) return <P>Loading settings…</P>;
  const fields: [string, string][] = [
    ['donation_total', 'Donation total ($)'], ['rating', 'Star rating'], ['reviews_count', 'Number of reviews'],
    ['sales_count', 'Number of sales'], ['products_count', 'Number of products'], ['admirers_count', 'Admirers'],
    ['experience_years', 'Years of experience'],
  ];
  async function save() {
    setMsg('Saving…');
    const { error } = await supabase.from('site_settings').update(s).eq('id', 1);
    setMsg(error ? 'Error: ' + error.message : '✓ Saved — live on the site.');
  }
  return (
    <div>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>These power the homepage stats and the charity counter.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        {fields.map(([k, label]) => (
          <label key={k} style={{ fontSize: 13 }}>{label}
            <input value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} style={inp} />
          </label>
        ))}
      </div>
      <button onClick={save} style={{ ...btn, width: 'auto', padding: '10px 24px', marginTop: 16 }}>Save changes</button>
      {msg && <span style={{ marginLeft: 12, fontSize: 13, color: msg.startsWith('✓') ? '#1d9e75' : '#666' }}>{msg}</span>}
    </div>
  );
}

function Links() {
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('needs'); // needs | all
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    let q = supabase.from('products').select('id,title,slug,link_status,link_verified,product_downloads(download_link)').order('link_status').limit(200);
    if (filter === 'needs') q = q.in('link_status', ['review', 'bundle_manual', 'likely']);
    const { data } = await q;
    setRows(data ?? []); setLoading(false);
  }
  useEffect(() => { load(); }, [filter]);
  async function mark(id: string, status: string) {
    await supabase.from('products').update({ link_status: status, link_verified: status === 'verified' }).eq('id', id);
    setRows((r) => r.map((x) => (x.id === id ? { ...x, link_status: status, link_verified: status === 'verified' } : x)));
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#666' }}>Filter:</span>
        {['needs', 'all'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...chip, background: filter === f ? '#854F0B' : '#fff', color: filter === f ? '#fff' : '#412402' }}>
            {f === 'needs' ? 'Needs review (red/yellow)' : 'All'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#999' }}>{rows.length} shown</span>
      </div>
      {loading ? <P>Loading…</P> : (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', color: '#888' }}><th style={th}></th><th style={th}>Product</th><th style={th}>Link</th><th style={th}>Status</th><th style={th}>Action</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const link = r.product_downloads?.[0]?.download_link;
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #0001' }}>
                  <td style={td}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: C[r.link_status] || '#999' }} /></td>
                  <td style={td}><a href={`/product/${r.slug}`} target="_blank" style={{ color: '#412402' }}>{r.title.slice(0, 50)}</a></td>
                  <td style={td}>{link ? <a href={link} target="_blank" style={{ color: '#854F0B' }}>open ↗</a> : <span style={{ color: '#c00' }}>none</span>}</td>
                  <td style={td}>{r.link_status}{r.link_verified ? ' ✓' : ''}</td>
                  <td style={td}>
                    <button onClick={() => mark(r.id, 'verified')} style={{ ...chip, borderColor: '#1d9e75', color: '#1d9e75' }}>✓ Works</button>
                    <button onClick={() => mark(r.id, 'broken')} style={{ ...chip, borderColor: '#e24b4a', color: '#e24b4a', marginLeft: 4 }}>✕ Broken</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const inp: any = { display: 'block', width: '100%', padding: '8px 10px', margin: '4px 0 10px', border: '1px solid #0003', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' };
const btn: any = { width: '100%', padding: 10, background: '#854F0B', color: '#FAEEDA', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
const chip: any = { padding: '4px 10px', border: '1px solid #0003', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 };
const th: any = { padding: '6px 8px', fontWeight: 500 };
const td: any = { padding: '6px 8px', verticalAlign: 'middle' };
