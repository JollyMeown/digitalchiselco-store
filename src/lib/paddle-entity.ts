// Who the buyer is actually contracting with.
//
// Paddle is our Merchant of Record, which means Paddle is the SELLER of every
// transaction for tax and consumer-protection purposes, not merely a gateway.
// Which Paddle company that is depends on where the buyer is: a US buyer's
// contract is with a New York company, a Canadian buyer's with a Toronto one,
// and everyone else's with the English company. Naming them, with registration
// numbers and a link, is real verifiable trust rather than borrowed trust.
//
// Verified 2026-09-03 against Paddle's own buyer terms and the UK Companies
// House record for 08172165. Re-check before changing any legal page.

export const PADDLE_URL = 'https://www.paddle.com';
export const PADDLE_BUYER_TERMS = 'https://www.paddle.com/legal/checkout-buyer-terms';

export type PaddleEntity = { where: string; name: string; country: string; detail: string; address: string };

export const PADDLE_ENTITIES: PaddleEntity[] = [
  {
    where: 'United States',
    name: 'Paddle.com Inc.',
    country: 'USA',
    detail: 'incorporated in the United States',
    address: '3811 Ditmars Blvd #1071, Astoria, New York, NY 11105-1803, USA',
  },
  {
    where: 'Canada',
    name: 'Paddle.com (Canada) Ltd.',
    country: 'Canada',
    detail: 'incorporated in Canada',
    address: '22 Adelaide Street West, Suite 3400, Toronto, Ontario, M5H 4E3, Canada',
  },
  {
    where: 'Everywhere else',
    name: 'Paddle.com Market Limited',
    country: 'United Kingdom',
    detail: 'registered in England and Wales, company number 08172165',
    address: '30 Old Bailey, London, EC4M 7AU, United Kingdom',
  },
];

/** The worldwide default entity (used wherever one name has to be given). */
export const PADDLE_MAIN = PADDLE_ENTITIES[2];

/** "Paddle.com Market Limited (United Kingdom), Paddle.com Inc. (USA) …" */
export const paddleSummary = () =>
  PADDLE_ENTITIES.map((e) => `${e.name} (${e.country})`).join(', ');
