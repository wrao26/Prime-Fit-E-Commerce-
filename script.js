/**
 * PRIMEFIT — script.js
 * Modular JS: UI, Shopify Cart API, dynamic products, 3D barbell.
 * No globals leak — everything in IIFE modules.
 * Execution order guaranteed by DOMContentLoaded.
 */

/* ═══════════════════════════════════════════════
   1. CONFIG
═══════════════════════════════════════════════ */
const SHOP = Object.freeze({
  domain  : 'primefitpt.store',
  token   : 'b038ef2aeeaac3573987069d95c0c119',
  ver     : '2024-04',
  cartKey : 'pf_cart_v3',
  FIRST   : 6,    // products shown initially
  PER_PAGE: 3,    // loaded per "Ver Mais" click
});

const GQL_URL = `https://${SHOP.domain}/api/${SHOP.ver}/graphql.json`;


/* ═══════════════════════════════════════════════
   2. GRAPHQL CLIENT
═══════════════════════════════════════════════ */
async function shopGql(query, vars = {}) {
  const res = await fetch(GQL_URL, {
    method : 'POST',
    headers: {
      'Content-Type'                      : 'application/json',
      'X-Shopify-Storefront-Access-Token' : SHOP.token,
    },
    body: JSON.stringify({ query, variables: vars }),
  });

  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${res.statusText}`);

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error('Shopify GQL: ' + json.errors.map(e => e.message).join(' | '));
  }

  return json.data;
}


/* ═══════════════════════════════════════════════
   3. CART MODULE
   Encapsulated state + all mutations.
   Public API exposed at bottom via window.Cart.
═══════════════════════════════════════════════ */
const Cart = (() => {
  /* ── State ── */
  const state = { id: null, checkoutUrl: null, qty: 0, _promise: null };

  /* ── Cart Fragment (reused across all mutations) ── */
  const CART_FRAGMENT = /* graphql */`
    fragment CartFields on Cart {
      id
      checkoutUrl
      totalQuantity
      lines(first: 100) {
        edges {
          node {
            id
            quantity
            merchandise {
              ... on ProductVariant {
                id
                title
                availableForSale
                price { amount currencyCode }
                image { url }
                product { title handle }
              }
            }
            cost { totalAmount { amount currencyCode } }
          }
        }
      }
      cost {
        totalAmount    { amount currencyCode }
        subtotalAmount { amount currencyCode }
      }
    }
  `;

  /* ── Internal: apply cart response to state ── */
  function _apply(cart) {
    state.id          = cart.id;
    state.checkoutUrl = cart.checkoutUrl;
    state.qty         = cart.totalQuantity ?? 0;
    localStorage.setItem(SHOP.cartKey, cart.id);
    UI.updateBadge(state.qty);
  }

  /* ── Ensure cart exists (deduplicated promise) ── */
  async function ensure() {
    if (state._promise) return state._promise;

    state._promise = (async () => {
      const saved = localStorage.getItem(SHOP.cartKey);

      if (saved) {
        try {
          const data = await shopGql(
            `${CART_FRAGMENT} query($id: ID!) { cart(id: $id) { ...CartFields } }`,
            { id: saved }
          );
          if (data.cart) { _apply(data.cart); return data.cart; }
        } catch (_) { /* cart expired or network error */ }
        localStorage.removeItem(SHOP.cartKey);
      }

      // Create brand-new cart
      const data = await shopGql(
        `${CART_FRAGMENT} mutation { cartCreate { cart { ...CartFields } userErrors { message } } }`
      );
      const errors = data.cartCreate?.userErrors;
      if (errors?.length) throw new Error(errors.map(e => e.message).join(', '));

      const cart = data.cartCreate?.cart;
      if (!cart) throw new Error('cartCreate returned no cart');
      _apply(cart);
      return cart;

    })().finally(() => { state._promise = null; });

    return state._promise;
  }

  /* ── Add lines ── */
  async function add(variantId, quantity = 1) {
    const c = await ensure();
    const data = await shopGql(`
      ${CART_FRAGMENT}
      mutation($cid: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cid, lines: $lines) {
          cart { ...CartFields }
          userErrors { field message }
        }
      }`, { cid: c.id, lines: [{ merchandiseId: variantId, quantity }] });

    const errors = data.cartLinesAdd?.userErrors;
    if (errors?.length) throw new Error(errors.map(e => e.message).join(', '));

    const updated = data.cartLinesAdd?.cart;
    if (updated) _apply(updated);
    return updated;
  }

  /* ── Update line quantity ── */
  async function update(lineId, quantity) {
    if (!state.id) return;
    if (quantity < 1) return remove(lineId);

    const data = await shopGql(`
      ${CART_FRAGMENT}
      mutation($cid: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cid, lines: $lines) {
          cart { ...CartFields }
          userErrors { field message }
        }
      }`, { cid: state.id, lines: [{ id: lineId, quantity }] });

    const errors = data.cartLinesUpdate?.userErrors;
    if (errors?.length) throw new Error(errors.map(e => e.message).join(', '));

    const updated = data.cartLinesUpdate?.cart;
    if (updated) _apply(updated);
    return updated;
  }

  /* ── Remove line ── */
  async function remove(lineId) {
    if (!state.id) return;

    const data = await shopGql(`
      ${CART_FRAGMENT}
      mutation($cid: ID!, $ids: [ID!]!) {
        cartLinesRemove(cartId: $cid, lineIds: $ids) {
          cart { ...CartFields }
          userErrors { field message }
        }
      }`, { cid: state.id, ids: [lineId] });

    const errors = data.cartLinesRemove?.userErrors;
    if (errors?.length) throw new Error(errors.map(e => e.message).join(', '));

    const updated = data.cartLinesRemove?.cart;
    if (updated) _apply(updated);
    return updated;
  }

  /* ── Refresh from API ── */
  async function refresh() {
    if (!state.id) return ensure();
    const data = await shopGql(
      `${CART_FRAGMENT} query($id: ID!) { cart(id: $id) { ...CartFields } }`,
      { id: state.id }
    );
    if (data.cart) { _apply(data.cart); return data.cart; }
    // Cart gone — create new
    localStorage.removeItem(SHOP.cartKey);
    state.id = null;
    return ensure();
  }

  /* ── Redirect to Shopify checkout ── */
  async function checkout() {
    const c = await ensure();
    if (c?.checkoutUrl) window.location.href = c.checkoutUrl;
  }

  /* ── Get current state ── */
  function getState() { return { ...state }; }

  return { ensure, add, update, remove, refresh, checkout, getState };
})();


/* ═══════════════════════════════════════════════
   4. PRODUCTS MODULE
   Fetches from Shopify and renders cards.
═══════════════════════════════════════════════ */
const Products = (() => {
  let _all      = [];
  let _visible  = SHOP.FIRST;
  let _filter   = 'tudo';

  /* ── Tag → CSS category map ── */
  const TAG_MAP = {
    treino:'treino', musculação:'treino', musculacao:'treino', força:'treino', forca:'treino', cardio:'treino',
    recuperacao:'recuperacao', recuperação:'recuperacao', massagem:'recuperacao', crioterapia:'recuperacao', sauna:'recuperacao',
    mobilidade:'mobilidade', postura:'mobilidade', agilidade:'mobilidade',
    acessorios:'acessorios', acessórios:'acessorios', nutrição:'acessorios', nutricao:'acessorios',
    hidratação:'acessorios', hidratacao:'acessorios', organização:'acessorios', organizacao:'acessorios',
  };

  function _tagToCat(tags = []) {
    for (const t of tags) {
      const key = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (TAG_MAP[key]) return TAG_MAP[key];
    }
    return 'tudo';
  }

  function _priceStr(range) {
    const min = parseFloat(range.minVariantPrice.amount);
    const max = parseFloat(range.maxVariantPrice.amount);
    const sym = range.minVariantPrice.currencyCode === 'EUR' ? '€' : range.minVariantPrice.currencyCode + '\u00a0';
    return min === max ? `${sym}${min.toFixed(2)}` : `${sym}${min.toFixed(2)} – ${sym}${max.toFixed(2)}`;
  }

  /* ── Build a single product card element ── */
  function _buildCard(product) {
    const v0      = product.variants.edges[0]?.node;
    const cat     = _tagToCat(product.tags);
    const inStock = product.variants.edges.some(e => e.node.availableForSale);
    const imgUrl  = product.featuredImage?.url ?? '';
    const price   = _priceStr(product.priceRange);
    const allVars = product.variants.edges.map(e => e.node);
    const isNew   = product.tags.some(t => ['novo','new','novidade'].includes(t.toLowerCase()));

    const card = document.createElement('div');
    card.className     = 'img-card';
    card.style.minHeight = '260px';
    card.dataset.cat    = cat;

    card.innerHTML = `
      ${!inStock ? '<div class="pf-oos">Esgotado</div>' : ''}
      ${isNew    ? '<div class="pf-badge">Novo</div>'   : ''}
      <div class="ic-bg" style="${imgUrl
        ? `background-image:url('${imgUrl}');background-size:cover;background-position:center;`
        : 'background:radial-gradient(ellipse at 50% 55%,#181818,#070707);'
      }"></div>
      <div class="ic-overlay"></div>
      <div class="ic-body">
        <div class="ic-text">
          <div class="ic-sub">${product.productType || cat}</div>
          <div class="ic-title ic-title-sm">${product.title}</div>
          <div class="ic-price ic-price-range">${price}</div>
          ${allVars.length > 1 ? `
            <div class="pf-variants">
              ${allVars.slice(0, 4).map(v => `<span class="pf-v-dot">${v.title}</span>`).join('')}
              ${allVars.length > 4 ? `<span class="pf-v-dot">+${allVars.length - 4}</span>` : ''}
            </div>` : ''}
        </div>
        <button
          class="ic-add pf-add-btn"
          data-variant="${v0?.id ?? ''}"
          data-title="${product.title.replace(/"/g, '&quot;')}"
          data-oos="${!inStock}"
          ${!inStock ? 'style="opacity:.35;pointer-events:none;" disabled' : ''}
          aria-label="Adicionar ${product.title} ao carrinho">
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>`;

    /* ── Wire add-to-cart ── */
    if (inStock && v0?.id) {
      const btn = card.querySelector('.pf-add-btn');
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--black)" stroke-width="2.8" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        btn.style.background = 'var(--gold)';
        btn.disabled = true;

        try {
          await Cart.add(v0.id, 1);
          UI.toast(`${product.title} — adicionado ao carrinho`);
          // Refresh drawer if it's open
          const dr = document.getElementById('pf-drawer');
          if (dr && dr.style.transform === 'translateX(0px)') Drawer.render();
        } catch (err) {
          console.error('[PrimeFit addToCart]', err);
          UI.toast('Erro ao adicionar ao carrinho', 'err');
        } finally {
          setTimeout(() => {
            btn.innerHTML = original;
            btn.style.background = '';
            btn.disabled = false;
          }, 1200);
        }
      });
    }

    return card;
  }

  /* ── Stagger animate grid items ── */
  function _animateIn(grid) {
    const cards = grid.querySelectorAll('.img-card');
    cards.forEach((c, i) => {
      c.style.opacity   = '0';
      c.style.transform = 'translateY(14px)';
      c.style.transition = 'opacity .35s ease, transform .35s ease';
      setTimeout(() => {
        c.style.opacity   = '1';
        c.style.transform = 'translateY(0)';
      }, i * 60);
    });
  }

  /* ── Fetch all products from Shopify ── */
  async function load() {
    const wrap = document.getElementById('pf-products-wrap');
    if (!wrap) return;

    try {
      const data = await shopGql(`
        query {
          products(first: 50, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                handle
                title
                productType
                tags
                featuredImage { url altText }
                priceRange {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
                variants(first: 10) {
                  edges {
                    node {
                      id
                      title
                      availableForSale
                      price { amount currencyCode }
                      image { url }
                    }
                  }
                }
              }
            }
          }
        }
      `);

      _all = data?.products?.edges?.map(e => e.node) ?? [];

      if (!_all.length) {
        wrap.innerHTML = `<div style="text-align:center;padding:4rem 0;color:var(--muted);font-size:.85rem;">
          Nenhum produto disponível de momento.
        </div>`;
        return;
      }

      render();

    } catch (err) {
      console.error('[PrimeFit Products]', err);
      wrap.innerHTML = `<div style="text-align:center;padding:4rem 0;color:var(--muted);font-size:.82rem;">
        Não foi possível carregar os produtos.<br>
        <small style="opacity:.5;">${err.message}</small>
      </div>`;
    }
  }

  /* ── Render visible products (respecting filter + visible count) ── */
  function render() {
    const wrap        = document.getElementById('pf-products-wrap');
    const verMaisWrap = document.getElementById('pf-ver-mais-wrap');
    const verMaisBtn  = document.getElementById('btn-ver-mais');
    if (!wrap) return;

    const filtered = _filter === 'tudo'
      ? _all
      : _all.filter(p => _tagToCat(p.tags) === _filter);

    const visible = filtered.slice(0, _visible);
    const hasMore = filtered.length > _visible;

    wrap.innerHTML = '';

    if (!visible.length) {
      wrap.innerHTML = `<div style="text-align:center;padding:3rem 0;color:var(--muted);font-size:.82rem;letter-spacing:1px;">
        Sem produtos nesta categoria.
      </div>`;
      if (verMaisWrap) verMaisWrap.style.display = 'none';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'feat-grid';
    grid.id        = 'feat-grid-dynamic';
    visible.forEach(p => grid.appendChild(_buildCard(p)));
    wrap.appendChild(grid);
    _animateIn(grid);

    if (verMaisWrap) {
      verMaisWrap.style.display = hasMore ? 'block' : 'none';
      if (verMaisBtn) {
        verMaisBtn.onclick = () => {
          _visible += SHOP.PER_PAGE;
          render();
        };
      }
    }
  }

  /* ── Set active filter ── */
  function setFilter(f) {
    _filter  = f;
    _visible = SHOP.FIRST;
    render();
  }

  return { load, render, setFilter };
})();


/* ═══════════════════════════════════════════════
   5. DRAWER MODULE
   Cart drawer: build, open, close, render lines.
═══════════════════════════════════════════════ */
const Drawer = (() => {
  function _fmt(amount, currency) {
    const sym = currency === 'EUR' ? '€' : currency + '\u00a0';
    return sym + parseFloat(amount).toFixed(2);
  }

  /* ── Build DOM (called once) ── */
  function build() {
    if (document.getElementById('pf-drawer')) return;

    /* Overlay */
    const overlay = document.createElement('div');
    overlay.id = 'pf-overlay';
    Object.assign(overlay.style, {
      position:'fixed', inset:'0',
      background:'rgba(0,0,0,.6)',
      zIndex:'799', opacity:'0',
      transition:'opacity .35s ease',
      display:'none',
    });
    overlay.addEventListener('click', close);

    /* Drawer panel */
    const dr = document.createElement('div');
    dr.id = 'pf-drawer';
    dr.setAttribute('role', 'dialog');
    dr.setAttribute('aria-label', 'Carrinho de compras');
    Object.assign(dr.style, {
      position:'fixed', top:'0', right:'0',
      height:'100dvh', width:'420px', maxWidth:'100vw',
      background:'var(--dark)',
      borderLeft:'1px solid var(--border)',
      zIndex:'800',
      transform:'translateX(100%)',
      transition:'transform .38s cubic-bezier(.25,.46,.45,.94)',
      display:'flex', flexDirection:'column',
    });

    dr.innerHTML = `
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:1.2rem 1.5rem;border-bottom:1px solid var(--border);flex-shrink:0;">
        <span style="font-family:'Oswald',sans-serif;font-size:1rem;letter-spacing:4px;font-weight:700;">CARRINHO</span>
        <button id="pf-dr-close" aria-label="Fechar carrinho"
          style="background:none;border:none;cursor:pointer;padding:6px;display:flex;align-items:center;
                 border-radius:6px;transition:background .2s;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="rgba(242,240,236,.5)" stroke-width="1.8" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Body (lines) -->
      <div id="pf-dr-body" style="flex:1;overflow-y:auto;padding:0 1.5rem;"></div>

      <!-- Footer -->
      <div id="pf-dr-foot" style="flex-shrink:0;padding:1.3rem 1.5rem;
                                   border-top:1px solid var(--border);display:none;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.5rem;">
          <span style="font-size:.64rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);">Subtotal</span>
          <span id="pf-dr-sub" style="font-family:'Oswald',sans-serif;font-size:.95rem;font-weight:600;">—</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.3rem;">
          <span style="font-size:.64rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);">Total</span>
          <span id="pf-dr-tot" style="font-family:'Oswald',sans-serif;font-size:1.4rem;font-weight:700;color:var(--white);">—</span>
        </div>
        <p style="font-size:.6rem;color:var(--muted);margin-bottom:1.2rem;line-height:1.6;">
          Portes e impostos calculados no checkout.
        </p>
        <button id="pf-checkout"
          style="width:100%;background:var(--white);color:#000;padding:.9rem;border-radius:7px;
                 border:none;font-family:'Barlow',sans-serif;font-size:.72rem;font-weight:700;
                 letter-spacing:2.5px;text-transform:uppercase;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;gap:.6rem;transition:opacity .2s;">
          Finalizar Compra
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
        <button id="pf-continue"
          style="width:100%;background:none;border:none;color:rgba(242,240,236,.3);
                 font-family:'Barlow',sans-serif;font-size:.62rem;font-weight:600;
                 letter-spacing:2px;text-transform:uppercase;cursor:pointer;
                 padding:.6rem;margin-top:.4rem;transition:color .2s;">
          Continuar a comprar
        </button>
      </div>`;

    document.body.append(overlay, dr);

    /* Wire header buttons */
    document.getElementById('pf-dr-close').addEventListener('click', close);
    document.getElementById('pf-continue').addEventListener('click', close);
    document.getElementById('pf-checkout').addEventListener('click', async function () {
      this.textContent = 'A redirecionar…';
      this.disabled = true;
      try { await Cart.checkout(); }
      catch (e) { this.textContent = 'Erro — tente de novo'; this.disabled = false; }
    });

    /* Close on Escape */
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  /* ── Open ── */
  function open() {
    build();
    const dr = document.getElementById('pf-drawer');
    const ov = document.getElementById('pf-overlay');
    ov.style.display = 'block';
    requestAnimationFrame(() => {
      ov.style.opacity    = '1';
      dr.style.transform  = 'translateX(0)';
    });
    render();
  }

  /* ── Close ── */
  function close() {
    const dr = document.getElementById('pf-drawer');
    const ov = document.getElementById('pf-overlay');
    if (!dr) return;
    dr.style.transform = 'translateX(100%)';
    ov.style.opacity   = '0';
    setTimeout(() => { ov.style.display = 'none'; }, 380);
  }

  /* ── Render cart lines ── */
  async function render() {
    const body = document.getElementById('pf-dr-body');
    const foot = document.getElementById('pf-dr-foot');
    if (!body) return;

    body.innerHTML = `<div style="padding:3rem 0;text-align:center;"><div class="pf-spinner"></div></div>`;

    try {
      const cart  = await Cart.refresh();
      const lines = cart?.lines?.edges ?? [];

      if (!lines.length) {
        body.innerHTML = `
          <div style="padding:4rem 0;text-align:center;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                 stroke="rgba(242,240,236,.12)" stroke-width="1.2" stroke-linecap="round"
                 style="margin:0 auto 1rem;display:block;">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <p style="color:var(--muted);font-size:.82rem;letter-spacing:1px;">O teu carrinho está vazio.</p>
          </div>`;
        if (foot) foot.style.display = 'none';
        return;
      }

      body.innerHTML = '';
      lines.forEach(({ node }) => {
        const v        = node.merchandise;
        const lineAmt  = _fmt(node.cost.totalAmount.amount, node.cost.totalAmount.currencyCode);
        const unitAmt  = _fmt(v.price.amount, v.price.currencyCode);
        const varLabel = v.title && v.title !== 'Default Title' ? v.title : '';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:1rem;padding:1.1rem 0;border-bottom:1px solid var(--border);align-items:flex-start;';
        row.innerHTML = `
          ${v.image?.url
            ? `<img src="${v.image.url}" alt="${v.product.title}"
                    style="width:64px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0;background:var(--black);">`
            : `<div style="width:64px;height:64px;border-radius:8px;background:rgba(255,255,255,.04);
                           border:1px solid var(--border);flex-shrink:0;"></div>`}
          <div style="flex:1;min-width:0;">
            <div style="font-size:.8rem;font-weight:600;color:var(--white);margin-bottom:.2rem;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v.product.title}</div>
            ${varLabel ? `<div style="font-size:.66rem;color:var(--muted);margin-bottom:.4rem;">${varLabel}</div>` : ''}
            <div style="font-size:.68rem;color:var(--muted);">${unitAmt} / un.</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.5rem;flex-shrink:0;">
            <span style="font-family:'Oswald',sans-serif;font-size:.95rem;font-weight:600;color:var(--gold);">${lineAmt}</span>
            <div style="display:flex;align-items:center;gap:.4rem;">
              <button data-act="dec" data-id="${node.id}" data-qty="${node.quantity}"
                style="width:26px;height:26px;border:1px solid var(--border);background:none;
                       border-radius:5px;color:var(--white);cursor:pointer;
                       display:flex;align-items:center;justify-content:center;font-size:.9rem;">−</button>
              <span style="font-size:.8rem;font-weight:600;min-width:16px;text-align:center;">${node.quantity}</span>
              <button data-act="inc" data-id="${node.id}" data-qty="${node.quantity}"
                style="width:26px;height:26px;border:1px solid var(--border);background:none;
                       border-radius:5px;color:var(--white);cursor:pointer;
                       display:flex;align-items:center;justify-content:center;font-size:.9rem;">+</button>
            </div>
            <button data-act="rm" data-id="${node.id}"
              style="font-size:.58rem;color:rgba(242,240,236,.25);background:none;border:none;
                     cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Remover</button>
          </div>`;

        /* Wire qty/remove buttons */
        row.querySelectorAll('[data-act]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const { act, id, qty } = btn.dataset;
            btn.disabled = true;
            try {
              if (act === 'inc') await Cart.update(id, +qty + 1);
              if (act === 'dec') await Cart.update(id, +qty - 1);
              if (act === 'rm')  await Cart.remove(id);
              await render();
            } catch (e) {
              UI.toast('Erro ao actualizar o carrinho', 'err');
              btn.disabled = false;
            }
          });
        });

        body.appendChild(row);
      });

      /* Totals */
      const sub = document.getElementById('pf-dr-sub');
      const tot = document.getElementById('pf-dr-tot');
      if (sub) sub.textContent = _fmt(cart.cost.subtotalAmount.amount, cart.cost.subtotalAmount.currencyCode);
      if (tot) tot.textContent = _fmt(cart.cost.totalAmount.amount,    cart.cost.totalAmount.currencyCode);
      if (foot) foot.style.display = 'block';

    } catch (err) {
      console.error('[PrimeFit Drawer]', err);
      body.innerHTML = `<p style="color:var(--muted);font-size:.8rem;text-align:center;padding:2rem;">
        Erro ao carregar o carrinho.
      </p>`;
    }
  }

  return { build, open, close, render };
})();


/* ═══════════════════════════════════════════════
   6. UI UTILITIES
═══════════════════════════════════════════════ */
const UI = (() => {
  /* ── Badge ── */
  function updateBadge(n) {
    const b = document.querySelector('.n-cart-badge');
    if (!b) return;
    b.textContent    = n;
    b.style.display  = n > 0 ? 'flex' : 'none';
  }

  /* ── Toast notification ── */
  let _toastTimer;
  function toast(msg, type = 'ok') {
    let el = document.getElementById('pf-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pf-toast';
      Object.assign(el.style, {
        position    : 'fixed',
        bottom      : '2rem',
        left        : '50%',
        transform   : 'translateX(-50%) translateY(140%)',
        zIndex      : '9999',
        background  : 'var(--white)',
        color       : 'var(--black)',
        padding     : '.8rem 1.5rem',
        borderRadius: '8px',
        fontFamily  : '"Barlow",sans-serif',
        fontSize    : '.78rem',
        fontWeight  : '600',
        letterSpacing: '1px',
        boxShadow   : '0 4px 30px rgba(0,0,0,.55)',
        display     : 'flex',
        alignItems  : 'center',
        gap         : '.6rem',
        whiteSpace  : 'nowrap',
        pointerEvents: 'none',
        transition  : 'transform .3s cubic-bezier(.25,.46,.45,.94)',
      });
      document.body.appendChild(el);
    }
    const okIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2.8" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const errIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e55" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    el.innerHTML  = (type === 'ok' ? okIcon : errIcon) + msg;
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.transform = 'translateX(-50%) translateY(140%)'; }, 3000);
  }

  /* ── Custom cursor ── */
  function initCursor() {
    const cur  = document.getElementById('cur');
    const ring = document.getElementById('cur-ring');
    if (!cur || !ring) return;
    let rx = 0, ry = 0, mx = 0, my = 0;
    document.addEventListener('mousemove', e => {
      mx = e.clientX; my = e.clientY;
      cur.style.left = mx + 'px';
      cur.style.top  = my + 'px';
    });
    (function loop() {
      rx += (mx - rx) * .11;
      ry += (my - ry) * .11;
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      requestAnimationFrame(loop);
    })();
  }

  /* ── Scroll reveal ── */
  function initReveal() {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); }),
      { threshold: 0.06 }
    );
    document.querySelectorAll('.rv').forEach(el => obs.observe(el));
  }

  /* ── Pill filters ── */
  function initPills() {
    document.querySelectorAll('.pill').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
        this.classList.add('on');
        Products.setFilter(this.dataset.filter);
      });
    });
  }

  return { updateBadge, toast, initCursor, initReveal, initPills };
})();


/* ═══════════════════════════════════════════════
   7. 3D BARBELL (Three.js + GSAP)
   Runs only if #db-canvas exists.
═══════════════════════════════════════════════ */
function initBarbell() {
  const canvas = document.getElementById('db-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const W = canvas.parentElement.offsetWidth  || 480;
  const H = canvas.parentElement.offsetHeight || 480;

  /* ── Renderer ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.toneMapping          = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure  = 1.25;
  renderer.outputEncoding       = THREE.sRGBEncoding;

  /* ── Scene & Camera ── */
  const scene  = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 100);
  camera.position.set(0, 0.5, 6.2);

  /* ── Environment Map ── */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const ES = 128;
  const ed = new Uint8Array(ES * ES * 4);
  for (let i = 0; i < ES; i++) for (let j = 0; j < ES; j++) {
    const k = (i * ES + j) * 4, t = i / ES;
    ed[k]   = Math.floor(18 + t * 50);
    ed[k+1] = Math.floor(16 + t * 32);
    ed[k+2] = Math.floor(20 + t * 18);
    ed[k+3] = 255;
  }
  const eTex = new THREE.DataTexture(ed, ES, ES, THREE.RGBAFormat);
  eTex.mapping = THREE.EquirectangularReflectionMapping;
  eTex.needsUpdate = true;
  scene.environment = pmrem.fromEquirectangular(eTex).texture;
  eTex.dispose(); pmrem.dispose();

  /* ── Materials ── */
  const SEG = 48;
  const mBar        = new THREE.MeshStandardMaterial({ color: 0x303030, metalness: 0.96, roughness: 0.18, envMapIntensity: 2.0 });
  const mKnurl      = new THREE.MeshStandardMaterial({ color: 0x252525, metalness: 0.88, roughness: 0.55, envMapIntensity: 1.2 });
  const mPlate      = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.97, roughness: 0.12, envMapIntensity: 2.4 });
  const mPlateInner = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.90, roughness: 0.38, envMapIntensity: 1.5 });
  const mCollar     = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.92, roughness: 0.20, envMapIntensity: 1.8 });
  const mGold       = new THREE.MeshStandardMaterial({ color: 0xC8861A, metalness: 0.95, roughness: 0.22, envMapIntensity: 2.0 });
  const mGroove     = new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 0.7,  roughness: 0.6  });

  /* ── Dumbbell Group ── */
  const db = new THREE.Group();
  scene.add(db);

  function cyl(rT, rB, h, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, SEG, 1), mat);
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    m.castShadow  = true;
    db.add(m);
    return m;
  }

  function disc(xPos, outerR, innerR, thickness, mat, flip = false) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: true,
      bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, steps: 1,
    });
    geo.rotateX(Math.PI / 2);
    if (flip) geo.rotateY(Math.PI);
    geo.translate(xPos, 0, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    db.add(mesh);
    return mesh;
  }

  /* ── Build ── */
  cyl(0.082, 0.082, 3.8, mBar);
  for (let xi = -0.76; xi <= 0.76; xi += 0.22) cyl(0.090, 0.090, 0.10, mKnurl, xi);
  [-1.4, -1.18, 1.18, 1.4].forEach(xi => cyl(0.090, 0.090, 0.10, mKnurl, xi));
  cyl(0.110, 0.082, 0.18, mBar, -1.74);
  cyl(0.082, 0.110, 0.18, mBar,  1.74);
  cyl(0.155, 0.155, 0.22, mCollar, -1.96);
  cyl(0.155, 0.155, 0.22, mCollar,  1.96);
  cyl(0.165, 0.165, 0.04, mCollar, -2.08);
  cyl(0.165, 0.165, 0.04, mCollar,  2.08);
  cyl(0.180, 0.155, 0.06, mCollar, -1.86);
  cyl(0.155, 0.180, 0.06, mCollar,  1.86);
  cyl(0.167, 0.167, 0.03, mGold,   -1.97);
  cyl(0.167, 0.167, 0.03, mGold,    1.97);
  disc(-2.18, 0.32, 0.095, 0.20, mPlateInner);
  disc( 1.98, 0.32, 0.095, 0.20, mPlateInner, true);
  cyl(0.320, 0.320, 0.01, mGroove, -2.18);
  cyl(0.320, 0.320, 0.01, mGroove,  2.18);
  disc(-2.56, 0.62, 0.092, 0.36, mPlate);
  disc( 2.20, 0.62, 0.092, 0.36, mPlate, true);
  [0.38, 0.50].forEach(r => {
    cyl(r, r, 0.008, mGroove, -2.88);
    cyl(r, r, 0.008, mGroove,  2.55);
  });
  cyl(0.14, 0.14, 0.015, mGold, -2.88);
  cyl(0.14, 0.14, 0.015, mGold,  2.55);
  cyl(0.095, 0.095, 0.22, mCollar, -3.08);
  cyl(0.095, 0.095, 0.22, mCollar,  3.08);
  cyl(0.200, 0.095, 0.06, mCollar, -3.20);
  cyl(0.095, 0.200, 0.06, mCollar,  3.20);
  cyl(0.100, 0.100, 0.06, mKnurl, -2.98);
  cyl(0.100, 0.100, 0.06, mKnurl,  2.98);

  /* ── Shadow ── */
  const shadowGeo   = new THREE.PlaneGeometry(8, 4);
  const shadowMat   = new THREE.ShadowMaterial({ opacity: 0.60 });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x    = -Math.PI / 2;
  shadowPlane.position.y    = -1.15;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  /* ── Particles ── */
  const PC   = 100;
  const pPos = new Float32Array(PC * 3);
  for (let i = 0; i < PC; i++) {
    pPos[i*3]   = (Math.random() - .5) * 12;
    pPos[i*3+1] = (Math.random() - .5) * 9;
    pPos[i*3+2] = (Math.random() - .5) * 7 - 2;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.022, transparent: true, opacity: 0.14, sizeAttenuation: true, depthWrite: false,
  })));

  /* ── Lights ── */
  const key = new THREE.SpotLight(0xfff8f0, 4.5);
  key.position.set(5, 7, 5);
  key.angle = Math.PI / 6; key.penumbra = 0.55; key.decay = 1.6;
  key.castShadow = true;
  key.shadow.mapSize.width = key.shadow.mapSize.height = 2048;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 25;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0x9ab8f8, 0.55);
  fill.position.set(-6, 2, 2);
  scene.add(fill);

  const rim = new THREE.SpotLight(0xffffff, 2.8);
  rim.position.set(-2, 4, -6);
  rim.angle = Math.PI / 5; rim.penumbra = 0.75; rim.decay = 2.0;
  scene.add(rim, rim.target);

  const gold = new THREE.PointLight(0xC8861A, 0.8, 5.0);
  gold.position.set(0, -1.2, 2.0);
  scene.add(gold);

  scene.add(new THREE.AmbientLight(0x111111, 0.55));

  /* ── Mouse ── */
  let mx = 0, my = 0, crx = 0, cry = 0;
  document.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    mx = (e.clientX - (r.left + r.width / 2))  / (r.width  / 2);
    my = (e.clientY - (r.top  + r.height / 2)) / (r.height / 2);
  });

  /* ── GSAP animation objects ── */
  const spin = { y: 0 };
  const flt  = { y: 0 };
  if (typeof gsap !== 'undefined') {
    gsap.to(spin, { y: Math.PI * 2, duration: 12, repeat: -1, ease: 'none' });
    gsap.to(flt,  { y: 0.20, duration: 2.8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    db.scale.set(0, 0, 0);
    gsap.to(db.scale, { x: 1, y: 1, z: 1, duration: 1.6, ease: 'elastic.out(1,0.65)', delay: 0.5 });
    gsap.from(spin,   { y: -Math.PI * .8, duration: 1.6, ease: 'power3.out', delay: 0.5 });
  }

  /* ── Resize ── */
  function resize() {
    const pw = canvas.parentElement.offsetWidth  || 480;
    const ph = canvas.parentElement.offsetHeight || 480;
    renderer.setSize(pw, ph);
    camera.aspect = pw / ph;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /* ── Render loop ── */
  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    const t = clock.getElapsedTime();

    crx += (my * .20 - crx) * .06;
    cry += (mx * .16 - cry) * .06;

    db.rotation.y = spin.y + cry;
    db.rotation.x = Math.sin(t * .22) * .055 + crx;
    db.rotation.z = Math.sin(t * .15) * .018;
    db.position.y = flt.y;

    const pa = pGeo.attributes.position.array;
    for (let i = 0; i < PC; i++) {
      pa[i*3+1] += 0.0006;
      if (pa[i*3+1] > 4.5) pa[i*3+1] = -4.5;
    }
    pGeo.attributes.position.needsUpdate = true;

    key.position.x = 5 + Math.sin(t * .28) * .7;
    key.position.z = 5 + Math.cos(t * .22) * .5;

    const ss = 1 - flt.y * .25;
    shadowPlane.scale.set(ss, ss, 1);
    shadowMat.opacity = 0.60 - flt.y * .15;
    gold.intensity    = 0.8  + Math.sin(t * 1.1) * .2;

    renderer.render(scene, camera);
  })();
}


/* ═══════════════════════════════════════════════
   8. BOOT — guaranteed after DOM ready
═══════════════════════════════════════════════ */
async function boot() {
  /* UI basics — no async deps */
  UI.initCursor();
  UI.initReveal();
  UI.initPills();

  /* Build drawer shell immediately (no API call needed) */
  Drawer.build();

  /* Wire cart icon */
  document.querySelector('.n-cart')?.addEventListener('click', Drawer.open);

  /* Restore badge from stored cart (fast path, no render) */
  const savedId = localStorage.getItem(SHOP.cartKey);
  if (savedId) {
    try {
      const data = await shopGql(
        `query($id:ID!){ cart(id:$id){ totalQuantity } }`,
        { id: savedId }
      );
      if (data.cart) UI.updateBadge(data.cart.totalQuantity);
    } catch (_) { /* ignore — cart will be refreshed when opened */ }
  }

  /* Pre-warm cart (creates gid if none exists, fire-and-forget) */
  Cart.ensure().catch(e => console.warn('[PrimeFit] Cart pre-warm failed:', e.message));

  /* Load & render products */
  await Products.load();

  /* Init 3D barbell (Three.js must already be loaded) */
  initBarbell();
}

/* ── Entry point ── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* ── Public API (useful for console debugging / extensions) ── */
window.PrimeFit = { Cart, Products, Drawer, UI };
