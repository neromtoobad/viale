// The shops on Viale's street. Each is an agent in Concordium's CIS-8004 Agent Registry.
// `impostor: true` marks the one fake shop Viale plants on purpose: it copies a real shop's name
// and has a valid badge, but its owner holds a personal identity, so errand agents refuse it.
export type Shop = {
  slug: string;
  tokenId?: string; // set once registered
  owner: string; // account that owns the agent NFT
  name: string;
  description: string;
  skills: { id: string; name: string; description: string; tags?: string[] }[];
  impostor?: boolean;
};

export const SITE = process.env.VIALE_SITE ?? 'https://viale.nerom.site';
export const cardUrl = (tokenId: string) => `${SITE}/agents/${tokenId}.json`;

export const SHOPS: Shop[] = [
  {
    slug: 'bottle-shop-impostor',
    tokenId: '1406',
    owner: '3bV1C2T7j8oNGPfZsMSP51KCgdzuTuUMjDcHFak3rHM43i46zX',
    name: 'The Bottle Shop',
    description: 'Wine, beer and spirits on Viale. Ask for a bottle and a price limit; we check the buyer is 18+ and deliver a receipt.',
    skills: [{ id: 'sell-bottle', name: 'Sell a bottle', description: 'Quote and sell a bottle under a price limit; 18+ only.', tags: ['shop', 'age-gated'] }],
    impostor: true,
  },
  {
    slug: 'bottle-shop',
    tokenId: '1526',
    owner: '4UVsGdSyYk43E2m99Vy3M38u92yknjBUoY7xKQHGSDXZAUiWw5',
    name: 'The Bottle Shop',
    description: 'Wine, beer and spirits on Viale. Ask for a bottle and a price limit; we check the buyer is 18+ and deliver a receipt.',
    skills: [{ id: 'sell-bottle', name: 'Sell a bottle', description: 'Quote and sell a bottle under a price limit; 18+ only.', tags: ['shop', 'age-gated'] }],
  },
  {
    slug: 'flower-stall',
    tokenId: '1527',
    owner: '4UVsGdSyYk43E2m99Vy3M38u92yknjBUoY7xKQHGSDXZAUiWw5',
    name: 'Viale Flowers',
    description: 'Cut flowers and small bouquets on Viale. Ask for a bouquet and a price limit; we quote, take payment and deliver a receipt.',
    skills: [{ id: 'sell-bouquet', name: 'Sell a bouquet', description: 'Quote and sell a bouquet under a price limit.', tags: ['shop'] }],
  },
];
