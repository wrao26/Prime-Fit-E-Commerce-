/**
 * config.js — PRIMEFIT Shopify Configuration
 * Replace STOREFRONT_TOKEN with your actual token from
 * Shopify Admin → Apps → Storefront API → Manage access
 */

const PRIMEFIT_CONFIG = {
  shopDomain:     'xd3jdf-dc.myshopify.com',
  storefrontToken: 'b038ef2aeeaac3573987069d95c0c119',   // ← insert token
  apiVersion:     '2025-01',

  get apiUrl() {
    return `https://${this.shopDomain}/api/${this.apiVersion}/graphql.json`;
  },

  currency: {
    symbol:   '€',
    locale:   'pt-PT',
    code:     'EUR',
  },

  cart: {
    storageKey: 'pf_cart_id',
  },
};

// Freeze so nothing can mutate config at runtime
Object.freeze(PRIMEFIT_CONFIG);
Object.freeze(PRIMEFIT_CONFIG.currency);
Object.freeze(PRIMEFIT_CONFIG.cart);
