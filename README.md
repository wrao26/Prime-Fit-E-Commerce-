# PRIMEFIT — Headless Shopify Ecommerce

Stack: HTML + CSS + Vanilla JS  
Backend: Shopify Storefront API (GraphQL)  
Deploy: Vercel (zero config)

---

## Setup

### 1. Shopify Storefront Token

Shopify Admin → Apps → **Develop Apps** → Create app →  
**API credentials** → Storefront API → Allow access to:
- `unauthenticated_read_product_listings`
- `unauthenticated_read_collection_listings`
- `unauthenticated_write_checkouts`
- `unauthenticated_read_checkouts`

Copy the **Storefront API access token**.

### 2. Insert token in config.js

```js
storefrontToken: 'shpat_xxxxxxxxxxxxxxxxxxxx',
```

### 3. Deploy to Vercel

```bash
npx vercel --prod
```

Or drag the folder into vercel.com/new.

---

## File structure

```
primefit/
├── index.html     ← Main page (full UI)
├── style.css      ← All styles
├── config.js      ← Shopify credentials (edit this)
├── shopify.js     ← API layer (GraphQL functions)
├── script.js      ← UI rendering, cart, events
├── vercel.json    ← Vercel config
└── README.md
```

---

## Features

- Products grid loaded live from Shopify
- Collections horizontal carousel (drag-to-scroll)
- Cart drawer with add/remove and quantity
- Shopify Checkout redirect
- Pill filters (Tudo / Recuperação / Treino / Mobilidade / Acessórios)
- Static HTML fallback cards if API is unavailable
- Skeleton loading states
- Toast notifications
- Scroll-reveal animations
- Three.js dumbbell hero (GSAP animated)
- Custom cursor
- Newsletter capture
- Fully responsive

---

## API Used

Endpoint: `https://xd3jdf-dc.myshopify.com/api/2025-01/graphql.json`

Queries:
- `products(first: N)` — product grid
- `collections(first: N)` — carousel
- `collection(handle)` → `products` — filter by collection

Mutations:
- `cartCreate` — create cart
- `cartLinesAdd` — add item
- `cartLinesRemove` — remove item
- `cartLinesUpdate` — update quantity
