// Membership questions, one per scenario the engine is tested for
// (scripts/membership/scenarios.ts). Shown on /faq (Membership tab) and on
// /membership. If the engine's behaviour changes, change the answer with it.
// House rules: no em dashes, no prices that could drift (link to the plans).
export type QA = { group: string; q: string; a: string };

export const MEMBER_FAQ: QA[] = [
  { group: 'How it works', q: 'What is the membership, exactly?',
    a: 'One payment for a fixed term of 3, 6 or 12 months. Each month of the term you receive a pack of new bas-relief STL designs by email, and every pack also appears in your account. Nothing renews by itself and you are never charged again unless you choose to.' },
  { group: 'How it works', q: 'When does my first pack arrive?',
    a: 'The moment your payment goes through, if that month\'s pack is ready, which it normally is. If a month is still being finished you receive a welcome email straight away and the pack email follows the moment it is live, usually within a day. You are never skipped.' },
  { group: 'How it works', q: 'When do the following packs arrive?',
    a: 'On the same day of each month as your start date. A member who joined on the 12th gets each new pack on the 12th. If a pack was delayed, it goes out automatically the day it is ready, and every month you are owed is delivered, never lost.' },
  { group: 'How it works', q: 'What is in a pack?',
    a: 'Eight designs chosen so that no two are from the same theme: wildlife, faith, farmhouse, coastal, gothic and so on, never a design you have already had from us in a pack. Each pack comes with a branded PDF whose buttons download every file, plus a cover picture and the list of designs in the email and in your account.' },

  { group: 'Your packs and downloads', q: 'Where do I find my packs later?',
    a: 'In your account. Every pack of every term you have ever held stays there, with its download buttons, for as long as the site exists. Expired members keep everything they received.' },
  { group: 'Your packs and downloads', q: 'The pack email never arrived, or I deleted it.',
    a: 'Open your account and press "email me this pack" under that month. A fresh copy is sent within a minute. To stop abuse it works once every 12 hours per pack; the download buttons in your account work at any time.' },
  { group: 'Your packs and downloads', q: 'Can I use the designs commercially?',
    a: 'Yes. Every design in every pack carries the same commercial licence as a single purchase: carve, print or engrave it and sell the finished pieces. Sharing or reselling the files themselves is the only thing the licence does not allow.' },
  { group: 'Your packs and downloads', q: 'Can I see what a pack contains?',
    a: 'Every pack email and every pack card in your account shows the cover and the designs inside, with a picture and title for each. Packs are prepared ahead of time, so a month is never thrown together on the day.' },

  { group: 'Renewing, upgrading and coming back', q: 'Will you remind me before my term ends?',
    a: 'Yes, twice: ten days before the last day and again three days before, each with a renew button. There is no automatic charge, so if you do nothing the term simply ends and your packs stay yours.' },
  { group: 'Renewing, upgrading and coming back', q: 'If I renew early, do I lose the months I already paid for?',
    a: 'No. A renewal bought while your term is still running starts on the day the current term ends, so the two never overlap and the monthly packs carry on without a gap. Your reminders stop as soon as you have renewed.' },
  { group: 'Renewing, upgrading and coming back', q: 'Can I upgrade to a longer plan, or to Premium, part-way through?',
    a: 'Yes, and it starts at once. Buy the longer plan and it begins the same day; the unused months of your current term are added to the end of the new one, so nothing you paid for is lost. Premium benefits apply from that day.' },
  { group: 'Renewing, upgrading and coming back', q: 'My membership ended a while ago. What happens if I join again?',
    a: 'A fresh term starts the day you buy, with its first pack sent immediately. Everything from your earlier term is still in your account alongside the new packs.' },
  { group: 'Renewing, upgrading and coming back', q: 'Can I pause my membership?',
    a: 'Write to us and we can pause it, for example while you are away. No packs are sent while paused, and when it resumes you receive every pack you were owed in one go.' },
  { group: 'Renewing, upgrading and coming back', q: 'I was a member on Etsy. Does that carry over?',
    a: 'Yes. Tell us the email you used and we add your term here with its original start date and the packs you already received, so you get only the months still owed and nothing twice. Your packs then live in your account like everyone else\'s.' },

  { group: 'Premium', q: 'What does the 12-month Premium plan add?',
    a: 'Two extra designs every month in a separate bonus bundle, on top of the standard eight, plus the lowest monthly price of any plan and a 10% member discount on every single design in the catalogue while your term runs. Bonus bundles ship with every pack from October 2026 onwards; a Premium member whose first pack is an earlier month gets that pack\'s standard designs and the bonus starts with the next one.' },
  { group: 'Premium', q: 'I am on a standard plan. Can I get the bonus designs?',
    a: 'Upgrade to Premium from your account or the membership page. Your upgrade starts immediately, your remaining standard months are carried over, and the next pack email includes the bonus bundle.' },

  { group: 'Help and refunds', q: 'Can I get a refund on a membership?',
    a: 'Within 14 days of purchase, yes, for any reason, and the same conditions as any digital purchase apply: once refunded, the licence ends and you agree to delete what you downloaded. Email jolly@digitalchiselco.com with the email you used at checkout.' },
  { group: 'Help and refunds', q: 'A download button says the link did not work.',
    a: 'The buttons are personal links tied to your membership, so a forwarded link will not open for someone else, and a pack that has not unlocked yet will not open early. Open your account, where every unlocked pack has a working button, or reply to the email and we will sort it.' },
  { group: 'Help and refunds', q: 'Who do I contact?',
    a: 'Reply to any membership email, or write to jolly@digitalchiselco.com. A real person reads every message and can re-send packs, adjust dates, or pause a term.' },
];
