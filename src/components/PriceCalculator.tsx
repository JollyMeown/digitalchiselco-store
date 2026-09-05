// Relief-carving price calculator, embedded in the "selling" guide.
//
// Implements the article's formula exactly: (materials + machine time + your
// time) x multiplier, rounded UP to a deliberate-looking number. The extra
// readouts (what you keep after the platform fee, what your hands-on hour
// really earned) are the two numbers first-time sellers never work out and
// most need to see. Pure client-side, nothing is sent anywhere.
import { useMemo, useState } from 'react';

type Preset = { name: string; board: number; extras: number; mh: number; hh: number };
const PRESETS: Preset[] = [
  { name: 'Small heart panel, 200 mm, cherry', board: 8, extras: 2, mh: 1, hh: 1 },
  { name: 'Wildlife panel, 400 mm, cherry', board: 30, extras: 5, mh: 4, hh: 2.5 },
  { name: 'Same panel in walnut', board: 55, extras: 5, mh: 4, hh: 2.5 },
  { name: 'Serving tray, 450 mm, maple', board: 34, extras: 6, mh: 5, hh: 2 },
  { name: 'Large landscape, 600 mm, walnut', board: 88, extras: 7, mh: 8, hh: 4 },
];
const ROUNDS = [5, 10, 25] as const;
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

function Field({ label, hint, value, onChange, step = 1, min = 0, prefix, suffix }:
  { label: string; hint?: string; value: number; onChange: (n: number) => void; step?: number; min?: number; prefix?: string; suffix?: string }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-[#412402]">{label}</span>
      {hint && <span className="block text-[11px] text-[#6b5a47] leading-snug mb-1">{hint}</span>}
      <span className="flex items-center rounded-md border border-[#854F0B]/30 bg-white focus-within:border-[#854F0B] focus-within:ring-2 focus-within:ring-[#854F0B]/20 overflow-hidden">
        {prefix && <span className="pl-2.5 text-[13px] text-[#6b5a47]">{prefix}</span>}
        <input type="number" inputMode="decimal" min={min} step={step} value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
          className="w-full px-2 py-1.5 text-[15px] tabular-nums text-[#2b2118] bg-transparent outline-none" />
        {suffix && <span className="pr-2.5 text-[12px] text-[#6b5a47] whitespace-nowrap">{suffix}</span>}
      </span>
    </label>
  );
}

export default function PriceCalculator() {
  const [board, setBoard] = useState(30);
  const [extras, setExtras] = useState(5);
  const [mh, setMh] = useState(4);
  const [mr, setMr] = useState(12);
  const [hh, setHh] = useState(2.5);
  const [hr, setHr] = useState(25);
  const [mult, setMult] = useState(2);
  const [roundTo, setRoundTo] = useState<number>(5);
  const [fee, setFee] = useState(10);

  const r = useMemo(() => {
    const materials = board + extras;
    const machine = mh * mr;
    const hands = hh * hr;
    const cost = materials + machine + hands;
    const raw = cost * mult;
    const price = Math.ceil(raw / roundTo) * roundTo;
    const kept = price * (1 - fee / 100);
    const profit = kept - cost;
    // what the hands-on hour really earned once everything else is paid
    const earned = hh > 0 ? (kept - materials - machine) / hh : 0;
    return { materials, machine, hands, cost, raw, price, kept, profit, earned };
  }, [board, extras, mh, mr, hh, hr, mult, roundTo, fee]);

  const apply = (p: Preset) => { setBoard(p.board); setExtras(p.extras); setMh(p.mh); setHh(p.hh); };
  const low = r.earned < hr;

  return (
    <section id="calculator" aria-label="Relief carving price calculator"
      className="my-10 rounded-xl border border-[#854F0B]/25 bg-[#FAF3E6] shadow-sm overflow-hidden not-prose">
      <div className="px-5 pt-5 pb-3 border-b border-[#854F0B]/15">
        <h3 className="m-0 font-serif text-[1.35rem] leading-tight text-[#412402]" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Price calculator
        </h3>
        <p className="m-0 mt-1 text-[13px] text-[#6b5a47]">The formula above, with your numbers. Change anything and the price updates. Nothing leaves your browser.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" onClick={() => apply(p)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-[#854F0B]/30 bg-white text-[#633806] hover:bg-[#854F0B] hover:text-[#FAF3E6] transition">
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_260px]">
        <div className="p-5 grid sm:grid-cols-2 gap-x-5 gap-y-4">
          <div className="sm:col-span-2 text-[11px] uppercase tracking-wide font-semibold text-[#854F0B]">Materials</div>
          <Field label="Board" hint="What the blank actually cost you" value={board} onChange={setBoard} prefix="$" />
          <Field label="Finish, hanger, packaging" hint="Per piece, honestly" value={extras} onChange={setExtras} prefix="$" step={0.5} />

          <div className="sm:col-span-2 text-[11px] uppercase tracking-wide font-semibold text-[#854F0B] mt-1">Machine time</div>
          <Field label="Spindle hours" hint="Roughing plus finishing" value={mh} onChange={setMh} step={0.5} suffix="h" />
          <Field label="Machine rate" hint="Cutters, power, wear: $10 to $15 is typical" value={mr} onChange={setMr} prefix="$" suffix="/ h" />

          <div className="sm:col-span-2 text-[11px] uppercase tracking-wide font-semibold text-[#854F0B] mt-1">Your time</div>
          <Field label="Hands-on hours" hint="Setup, sanding, finishing, photos" value={hh} onChange={setHh} step={0.25} suffix="h" />
          <Field label="Your rate" hint="$25 is a floor, not a ceiling" value={hr} onChange={setHr} prefix="$" suffix="/ h" />

          <div className="sm:col-span-2 text-[11px] uppercase tracking-wide font-semibold text-[#854F0B] mt-1">Pricing</div>
          <div>
            <span className="block text-[12px] font-semibold text-[#412402]">Multiplier</span>
            <span className="block text-[11px] text-[#6b5a47] leading-snug mb-1">Covers waste, failed boards, fees and profit</span>
            <div className="flex gap-1">
              {[1.5, 2, 2.5, 3].map((m) => (
                <button key={m} type="button" onClick={() => setMult(m)}
                  className={`flex-1 py-1.5 rounded-md text-[13px] font-semibold border transition ${mult === m ? 'bg-[#854F0B] text-[#FAF3E6] border-[#854F0B]' : 'bg-white text-[#633806] border-[#854F0B]/30 hover:border-[#854F0B]'}`}>
                  ×{m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-[12px] font-semibold text-[#412402]">Round up to</span>
            <span className="block text-[11px] text-[#6b5a47] leading-snug mb-1">$145 looks like a decision, $137 like arithmetic</span>
            <div className="flex gap-1">
              {ROUNDS.map((v) => (
                <button key={v} type="button" onClick={() => setRoundTo(v)}
                  className={`flex-1 py-1.5 rounded-md text-[13px] font-semibold border transition ${roundTo === v ? 'bg-[#854F0B] text-[#FAF3E6] border-[#854F0B]' : 'bg-white text-[#633806] border-[#854F0B]/30 hover:border-[#854F0B]'}`}>
                  ${v}
                </button>
              ))}
            </div>
          </div>
          <Field label="Platform or fair fee" hint="Marketplace commission plus payment processing; around 10% is common" value={fee} onChange={setFee} step={0.5} suffix="%" />
        </div>

        <aside className="bg-[#412402] text-[#FAF3E6] p-5 flex flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#FAC775]/80 font-semibold">Sell it for</div>
            <div className="text-[2.6rem] leading-none font-extrabold tabular-nums text-[#FAC775] mt-1">{money(r.price)}</div>
            <div className="text-[11px] text-[#FAF3E6]/60 mt-1">{money(r.cost)} cost × {mult} = {money(r.raw)}, rounded up</div>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[12.5px] m-0">
            <dt className="text-[#FAF3E6]/70">Materials</dt><dd className="m-0 text-right tabular-nums">{money(r.materials)}</dd>
            <dt className="text-[#FAF3E6]/70">Machine time</dt><dd className="m-0 text-right tabular-nums">{money(r.machine)}</dd>
            <dt className="text-[#FAF3E6]/70">Your time</dt><dd className="m-0 text-right tabular-nums">{money(r.hands)}</dd>
            <dt className="text-[#FAF3E6] font-semibold border-t border-[#FAF3E6]/20 pt-1">Cost to make</dt><dd className="m-0 text-right tabular-nums font-semibold border-t border-[#FAF3E6]/20 pt-1">{money(r.cost)}</dd>
          </dl>
          <div className="border-t border-[#FAF3E6]/20 pt-3 space-y-2">
            <div className="flex justify-between text-[12.5px]"><span className="text-[#FAF3E6]/70">You keep after {fee}% fee</span><b className="tabular-nums">{money(r.kept)}</b></div>
            <div className="flex justify-between text-[12.5px]"><span className="text-[#FAF3E6]/70">Profit above cost</span><b className={`tabular-nums ${r.profit < 0 ? 'text-red-300' : ''}`}>{money(r.profit)}</b></div>
            <div className="flex justify-between text-[12.5px]"><span className="text-[#FAF3E6]/70">Your hour really earned</span><b className={`tabular-nums ${low ? 'text-red-300' : 'text-[#FAC775]'}`}>{money(r.earned)} / h</b></div>
          </div>
          {low ? (
            <p className="m-0 text-[11.5px] leading-snug text-red-200 bg-red-900/30 rounded-md px-2.5 py-2">
              After materials, machine time and the fee, each hands-on hour pays less than your own rate. Raise the multiplier or the price, or cut the fee.
            </p>
          ) : (
            <p className="m-0 text-[11.5px] leading-snug text-[#FAF3E6]/60">
              Fees, a failed board and the odd snapped bit are already inside the multiplier. That is what keeps this a business.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
