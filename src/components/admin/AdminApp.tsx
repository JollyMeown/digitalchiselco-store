import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Overview from './tabs/Overview';
import Products from './tabs/Products';
import Categories from './tabs/Categories';
import CategoryManager from './tabs/CategoryManager';
import Orders from './tabs/Orders';
import Subscribers from './tabs/Subscribers';
import Makers from './tabs/Makers';
import Media from './tabs/Media';
import Settings from './tabs/Settings';
import Links from './tabs/Links';
import Reviews from './tabs/Reviews';
import Faqs from './tabs/Faqs';
import Membership from './tabs/Membership';
import MonthlyDrops from './tabs/MonthlyDrops';
import MemberSubs from './tabs/MemberSubs';
import MemberEmails from './tabs/MemberEmails';
import Finance from './tabs/Finance';
import Traffic from './tabs/Traffic';
import Insights from './tabs/Insights';
import Automations from './tabs/Automations';
import Bundles from './tabs/Bundles';
import Creations from './tabs/Creations';
import Customized from './tabs/Customized';
import Seo from './tabs/Seo';
import Discounts from './tabs/Discounts';
import Cults from './tabs/Cults';
import PdfMaker from './tabs/PdfMaker';
import Seasonal from './tabs/Seasonal';
import DesignBoard from './tabs/DesignBoard';
import OrderSoundListener from './OrderSoundListener';
import { inputCls, btnPrimary } from './ui';

type Tab = { key: string; label: string; icon: string; Component: any };

const TABS: Tab[] = [
  { key: 'overview',    label: 'Overview',     icon: '◎', Component: Overview },
  { key: 'finance',     label: 'Finance',      icon: '💰', Component: Finance },
  { key: 'traffic',     label: 'Traffic',      icon: '📊', Component: Traffic },
  { key: 'insights',    label: 'Subscriber Insights', icon: '📈', Component: Insights },
  { key: 'automations', label: 'Automations',  icon: '🤖', Component: Automations },
  { key: 'products',    label: 'Products',     icon: '▦', Component: Products },
  { key: 'seo',         label: 'SEO Review',   icon: '✦', Component: Seo },
  { key: 'bundles',     label: 'Bundle Composer', icon: '◫', Component: Bundles },
  { key: 'pdfmaker',    label: 'PDF Maker',    icon: '⎙', Component: PdfMaker },
  { key: 'customized',  label: 'Customized',   icon: '✎', Component: Customized },
  { key: 'categories',  label: 'Categories',   icon: '☷', Component: Categories },
  { key: 'categorymgr', label: 'Category Manager', icon: '🗂', Component: CategoryManager },
  { key: 'orders',      label: 'Orders',       icon: '⊞', Component: Orders },
  { key: 'cults',       label: 'Cults3D Sales', icon: '◈', Component: Cults },
  { key: 'discounts',   label: 'Discounts',    icon: '%', Component: Discounts },
  { key: 'creations',   label: 'Carved by you', icon: '✦', Component: Creations },
  { key: 'seasonal',    label: 'Seasonal',     icon: '❄', Component: Seasonal },
  { key: 'designboard', label: 'Design Board', icon: '💡', Component: DesignBoard },
  { key: 'membership',  label: 'Membership',   icon: '◆', Component: Membership },
  { key: 'monthly',     label: 'Monthly Drops', icon: '🗓', Component: MonthlyDrops },
  { key: 'membersubs',  label: 'Subscriptions', icon: '♺', Component: MemberSubs },
  { key: 'memberemails', label: 'Member Emails', icon: '✈', Component: MemberEmails },
  { key: 'reviews',     label: 'Reviews',      icon: '★', Component: Reviews },
  { key: 'faqs',        label: 'FAQs',         icon: '?', Component: Faqs },
  { key: 'subscribers', label: 'Subscribers',  icon: '✉', Component: Subscribers },
  { key: 'makers',      label: 'Makers',       icon: '🛠', Component: Makers },
  { key: 'media',       label: 'Media & Hero', icon: '◰', Component: Media },
  { key: 'settings',    label: 'Settings',     icon: '⚙', Component: Settings },
  { key: 'links',       label: 'Download Links', icon: '↗', Component: Links },
];

export default function AdminApp() {
  const [session, setSession] = useState<any>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<string>(() => (typeof window !== 'undefined' && window.location.hash.slice(1)) || 'overview');
  const [collapsed, setCollapsed] = useState(false);
  // Custom sidebar order (drag-to-reorder, saved per browser).
  const ORDER_KEY = 'dcc_admin_tab_order';
  const [order, setOrder] = useState<string[]>([]);
  const dragKey = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) setOrder(saved);
    } catch {}
  }, []);
  // Ordered tabs = saved order first (valid keys only), then any new tabs appended.
  const orderedTabs = (() => {
    if (!order.length) return TABS;
    const byKey = new Map(TABS.map((t) => [t.key, t]));
    const seen = new Set<string>();
    const out: Tab[] = [];
    for (const k of order) { const t = byKey.get(k); if (t && !seen.has(k)) { out.push(t); seen.add(k); } }
    for (const t of TABS) if (!seen.has(t.key)) out.push(t);
    return out;
  })();
  function persistOrder(next: Tab[]) {
    const keys = next.map((t) => t.key);
    setOrder(keys);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch {}
  }
  function onDrop(targetKey: string) {
    const from = dragKey.current;
    dragKey.current = null; setDragOver(null);
    if (!from || from === targetKey) return;
    const list = orderedTabs.slice();
    const fromIdx = list.findIndex((t) => t.key === from);
    const toIdx = list.findIndex((t) => t.key === targetKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    persistOrder(list);
  }
  function resetOrder() { setOrder([]); try { localStorage.removeItem(ORDER_KEY); } catch {} }

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
          {orderedTabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              draggable
              onDragStart={() => { dragKey.current = t.key; }}
              onDragOver={(e) => { e.preventDefault(); if (dragOver !== t.key) setDragOver(t.key); }}
              onDragLeave={() => { if (dragOver === t.key) setDragOver(null); }}
              onDrop={(e) => { e.preventDefault(); onDrop(t.key); }}
              onDragEnd={() => { dragKey.current = null; setDragOver(null); }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-cream transition cursor-grab active:cursor-grabbing ${tab === t.key ? 'bg-cream text-bronze-700 border-l-2 border-bronze-600' : 'text-ink-700'} ${dragOver === t.key ? 'border-t-2 border-t-bronze-500 bg-bronze-50/40' : ''}`}
              title={collapsed ? t.label : 'Drag to reorder'}>
              <span className="text-base w-5 text-center">{t.icon}</span>
              {!collapsed && <span className="flex-1 text-left">{t.label}</span>}
              {!collapsed && <span className="text-ink-700/25 select-none text-xs" aria-hidden="true">⠿</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-black/10 p-3 text-xs">
          {!collapsed && order.length > 0 && (
            <button onClick={resetOrder} className="text-ink-700/50 hover:text-bronze-600 hover:underline text-[11px] mb-2 block">↺ Reset tab order</button>
          )}
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
          <PendingModerationBanner goProducts={() => { try { sessionStorage.setItem('products_filter', 'pending'); } catch {} setTab('products'); }} />
          <Active />
        </div>
      </main>
      <OrderSoundListener />
    </div>
  );
}

// 🟠 items uploaded from OTHER shops' BRS studios await the admin's moderation —
// shown on every admin page while any are pending, refreshed each minute.
function PendingModerationBanner({ goProducts }: { goProducts: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { count } = await supabase.from('products')
          .select('id', { count: 'exact', head: true }).eq('pending_review', true);
        if (alive) setN(count || 0);
      } catch {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!n) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
      <span className="text-lg">🟠</span>
      <span className="flex-1 min-w-[220px]">
        <b>{n} new item{n === 1 ? '' : 's'}</b> uploaded from your shops await moderation — review each one, assign the right category &amp; price, then approve.
      </span>
      <button onClick={goProducts} className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
        Review now →
      </button>
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
