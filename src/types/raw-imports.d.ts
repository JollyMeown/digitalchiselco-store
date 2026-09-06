// Vite `?raw` imports (used to embed scripts/gmail_etsy_buyers.gs in the admin).
declare module '*?raw' {
  const content: string;
  export default content;
}
