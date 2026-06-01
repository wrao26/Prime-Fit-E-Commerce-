/**
 * shopify.js — PRIMEFIT Storefront API Layer
 * Handles all GraphQL communication with Shopify.
 * No UI logic here — only data fetching & cart mutations.
 */

const ShopifyAPI = (() => {
  'use strict';

  /* ─────────────────────────────────────────
     CORE FETCH
  ───────────────────────────────────────── */
  async function gql(query, variables = {}) {
    try {
      const res = await fetch(PRIMEFIT_CONFIG.apiUrl, {
        method:  'POST',
        headers: {
          'Content-Type':                        'application/json',
          'X-Shopify-Storefront-Access-Token':   PRIMEFIT_CONFIG.storefrontToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        throw new Error(`Shopify HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();

      if (json.errors && json.errors.length) {
        const msg = json.errors.map(e => e.message).join(' | ');
        throw new Error(`Shopify GraphQL: ${msg}`);
      }

      return json.data || {};
    } catch (err) {
      console.warn('[ShopifyAPI] Request failed:', err.message);
      throw err;           // let callers decide how to handle
    }
  }

  /* ─────────────────────────────────────────
     PRODUCTS
  ───────────────────────────────────────── */
  async function getProducts({ first = 24, query = '', collectionHandle = '' } = {}) {
    try {
      // If filtering by collection, use a different query
      if (collectionHandle) {
        return await getProductsByCollection(collectionHandle, first);
      }

      const data = await gql(`
        query GetProducts($first: Int!, $query: String) {
          products(first: $first, query: $query, sortKey: BEST_SELLING) {
            edges {
              node {
                id
                title
                handle
                description
                availableForSale
                tags
                featuredImage {
                  url
                  altText
                }
                priceRange {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      title
                      availableForSale
                      priceV2 { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      `, { first, query: query || null });

      return data?.products?.edges?.map(e => e.node) ?? [];
    } catch {
      return [];   // graceful empty fallback — UI never breaks
    }
  }

  async function getProductsByCollection(handle, first = 24) {
    try {
      const data = await gql(`
        query GetCollectionProducts($handle: String!, $first: Int!) {
          collection(handle: $handle) {
            title
            products(first: $first) {
              edges {
                node {
                  id
                  title
                  handle
                  description
                  availableForSale
                  tags
                  featuredImage { url altText }
                  priceRange {
                    minVariantPrice { amount currencyCode }
                    maxVariantPrice { amount currencyCode }
                  }
                  variants(first: 1) {
                    edges {
                      node {
                        id
                        title
                        availableForSale
                        priceV2 { amount currencyCode }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, { handle, first });

      return data?.collection?.products?.edges?.map(e => e.node) ?? [];
    } catch {
      return [];
    }
  }

  async function getProductById(id) {
    try {
      const data = await gql(`
        query GetProduct($id: ID!) {
          product(id: $id) {
            id title handle description availableForSale tags
            featuredImage { url altText }
            images(first: 6) { edges { node { url altText } } }
            priceRange {
              minVariantPrice { amount currencyCode }
              maxVariantPrice { amount currencyCode }
            }
            variants(first: 20) {
              edges {
                node {
                  id title availableForSale
                  priceV2 { amount currencyCode }
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      `, { id });

      return data?.product ?? null;
    } catch {
      return null;
    }
  }

  /* ─────────────────────────────────────────
     COLLECTIONS
  ───────────────────────────────────────── */
  async function getCollections(first = 12) {
    try {
      const data = await gql(`
        query GetCollections($first: Int!) {
          collections(first: $first) {
            edges {
              node {
                id
                title
                handle
                description
                image { url altText }
                products(first: 1) {
                  edges { node { id } }
                }
              }
            }
          }
        }
      `, { first });

      return data?.collections?.edges?.map(e => e.node) ?? [];
    } catch {
      return [];
    }
  }

  /* ─────────────────────────────────────────
     CART
  ───────────────────────────────────────── */
  async function cartCreate() {
    const data = await gql(`
      mutation CartCreate {
        cartCreate {
          cart { id checkoutUrl totalQuantity }
          userErrors { field message }
        }
      }
    `);
    return data?.cartCreate?.cart ?? null;
  }

  async function cartGet(cartId) {
    try {
      const data = await gql(`
        query CartGet($id: ID!) {
          cart(id: $id) {
            id checkoutUrl totalQuantity
            lines(first: 50) {
              edges {
                node {
                  id quantity
                  merchandise {
                    ... on ProductVariant {
                      id title
                      priceV2 { amount currencyCode }
                      image { url altText }
                      product { title handle }
                    }
                  }
                }
              }
            }
            estimatedCost {
              totalAmount { amount currencyCode }
            }
          }
        }
      `, { id: cartId });

      return data?.cart ?? null;
    } catch {
      return null;
    }
  }

  async function cartLinesAdd(cartId, lines) {
    const data = await gql(`
      mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) {
          cart { id checkoutUrl totalQuantity }
          userErrors { field message }
        }
      }
    `, { cartId, lines });
    return data?.cartLinesAdd?.cart ?? null;
  }

  async function cartLinesRemove(cartId, lineIds) {
    const data = await gql(`
      mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
          cart { id totalQuantity }
          userErrors { field message }
        }
      }
    `, { cartId, lineIds });
    return data?.cartLinesRemove?.cart ?? null;
  }

  async function cartLinesUpdate(cartId, lines) {
    const data = await gql(`
      mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart { id totalQuantity }
          userErrors { field message }
        }
      }
    `, { cartId, lines });
    return data?.cartLinesUpdate?.cart ?? null;
  }

  /* ─────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────── */
  return {
    getProducts,
    getProductsByCollection,
    getProductById,
    getCollections,
    cart: { cartCreate, cartGet, cartLinesAdd, cartLinesRemove, cartLinesUpdate },
  };
})();
