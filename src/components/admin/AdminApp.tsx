import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Overview from './tabs/Overview';
import Products from './tabs/Products';
import Categories from './tabs/Categories';
import Orders from './tabs/Orders';
import Subscribers from './tabs/Subscribers';
import Media from './tabs/Media';
import Settings from './tabs/Settings';
import Links from './tabs/Links';
import Reviews from './tabs/Reviews';
import Faqs from './tabs/Faqs';
import Membership from './tabs/Membership';
import Bundles from './tabs/Bundles';
import Creations from './tabs/Creations';
import Discounts from './tabs/Discounts';
import { inputCls, btnPrimary } from './ui';

type Tab = { key: string; label: string; icon: string; Component: any };

const TABS: Tab[] = [
  { key: 'overview',    label: 'Overview',     icon: '◎', Component: Overview },
  { key: 'products',    label: 'Products',     icon: '▦', Component: Products },
  { key: 'bundles',     label: 'Bundle Composer', icon: '◫', Component: Bundles },
  { key: 'categories',  label: 'Categories',   icon: '☷', Component: Categories },
  { key: 'orders',      label: 'Orders',       icon: '⊞', Component: Orders },
  { key: 'discounts',   label: 'Discounts',    icon: '%', Component: Discounts },
  { key: 'creations',   label: 'Carved by you', icon: '✦', Component: Creations },
  { key: 'membership',  label: 'Membership',   icon: '◆', Component: Membership },
  { key: 'reviews',     label: 'Reviews',      icon: '★', Component: Reviews },
  { key: 'faqs',        label: 'FAQs',         icon: '?', Component: Faqs },
  { key: 'subscribers', label: 'Subscribers',  icon: '✉', Component: Subscribers },
  { key: 'media',       label: 'Media & Hero', icon: '◰', Component: Media },
  { key: 'settings',    label: 'Settings',     icon: '⚙', Component: Settings },
  { key: 'links',       label: 'Download Links', icon: '↗', Component: Links },
];

export default function AdminApp() {
  const [session, setSession] = useState<any>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<string>(() => (typeof window !== 'undefined' && window.location.hash.slice(1)) || 'overview');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) check(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s); if (s) check(s.user.id); else setIsAdmin(false);
    });
    const onHash = () => { const h = window.location.hash.slice(1); if (h) setTab(h); };
    window.addEventListener('hashchange', onHash);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash); };
  }, []);

  useEffect(() => { if (typeof window !== 'undefined') window.location.hash = tab; }, [tab]);

  async function check(uid: string) {
    const { data } = await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
    setIsAdmin(!!data?.is_admin);
  }

  if (session === undefined) return <div className="p-16 text-center text-ink-700/60">Loading…</div>;
  if (!session) return <Login />;
  if (!isAdmin) return (
    <div className="p-16 text-center text-ink-700/70">
      Not authorized for admin.{' '}
      <button onClick={() => supabase.auth.signOut()} className="text-bronze-600 underline">Sign out</button>
    </div>
  );

  const Active = TABS.find((t) => t.key === tab)?.Component || Overview;

  return (
    <div className="min-h-screen flex bg-cream/40">
      <aside className={`${collapsed ? 'w-14' : 'w-56'} transition-all flex-shrink-0 bg-white border-r border-black/10 flex flex-col`}>
        <div className="px-3 py-3 border-b border-black/10 flex items-center gap-2">
          <button onClick={() => setCollapsed(!collapsed)} className="text-bronze-700 text-lg w-8 h-8 hover:bg-cream rounded">☰</button>
          {!collapsed && <span className="font-serif text-bronze-700 text-sm">Admin</span>}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-cream transition ${tab === t.key ? 'bg-cream text-bronze-700 border-l-2 border-bronze-600' : 'text-ink-700'}`}
              title={t.label}>
              <span className="text-base w-5 text-center">{t.icon}</span>
              {!collapsed && <span>{t.label}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-black/10 p-3 text-xs">
          {!collapsed && <div className="text-ink-700/60 mb-2 truncate">{session.user.email}</div>}
          <button onClick={() => supabase.auth.signOut()} className="text-bronze-600 hover:underline text-xs">{collapsed ? '↪' : 'Sign out'}</button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto">
        <div className="px-6 py-5 max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-5">
            <h1 className="font-serif text-2xl text-ink-800">{TABS.find((t) => t.key === tab)?.label}</h1>
            <a href="/" className="text-sm text-bronze-600 hover:underline">View storefront ↗</a>
          </div>
          <Active />
        </div>
      </main>
    </div>
  );
}

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
    <div className="min-h-screen flex items-center justify-center bg-cream/50">
      <form onSubmit={submit} className="bg-white max-w-sm w-full mx-4 p-6 rounded-lg shadow-sm border border-black/10">
        <h1 className="font-serif text-xl text-bronze-700 mb-1">Admin sign in</h1>
        <p className="text-xs text-ink-700/60 mb-5">DigitalChiselCo dashboard</p>
        <label className="text-xs block mb-2">Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + ' mt-1'} />
        </label>
        <label className="text-xs block mb-3">Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={inputCls + ' mt-1'} />
        </label>
        {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
        <button disabled={busy} className={btnPrimary + ' w-full justify-center'}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
