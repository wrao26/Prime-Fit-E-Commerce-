/**
 * script.js — PRIMEFIT UI Layer
 * Handles rendering, events, carousels, animations.
 * No direct Shopify API calls — uses ShopifyAPI module.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════
     CART STATE
  ═══════════════════════════════════════════ */
  let _cartId     = localStorage.getItem(PRIMEFIT_CONFIG.cart.storageKey) || null;
  let _cartCount  = 0;

  async function _ensureCart() {
    if (!_cartId) {
      const cart = await ShopifyAPI.cart.cartCreate();
      if (cart?.id) {
        _cartId = cart.id;
        localStorage.setItem(PRIMEFIT_CONFIG.cart.storageKey, _cartId);
      }
    }
    return _cartId;
  }

  async function _addToCart(variantId, qty = 1) {
    try {
      await _ensureCart();
      const cart = await ShopifyAPI.cart.cartLinesAdd(_cartId, [
        { merchandiseId: variantId, quantity: qty },
      ]);
      if (cart) _updateBadge(cart.totalQuantity);
      _showToast('Adicionado ao carrinho!');
      return cart;
    } catch (err) {
      console.warn('[Cart] addToCart failed:', err.message);
      _showToast('Erro ao adicionar. Tenta novamente.', 'error');
    }
  }

  async function _goToCheckout() {
    try {
      await _ensureCart();
      const cart = await ShopifyAPI.cart.cartGet(_cartId);
      if (cart?.checkoutUrl) {
        window.location.href = cart.checkoutUrl;
      } else {
        _showToast('Carrinho vazio — adiciona produtos primeiro.', 'error');
      }
    } catch {
      _showToast('Erro ao ir para o checkout.', 'error');
    }
  }

  /* ═══════════════════════════════════════════
     CART BADGE
  ═══════════════════════════════════════════ */
  function _updateBadge(count) {
    _cartCount = count || 0;
    const badge = document.querySelector('.n-cart-badge');
    if (!badge) return;
    badge.textContent = _cartCount;
    badge.style.display = _cartCount > 0 ? 'flex' : 'none';
  }

  /* ═══════════════════════════════════════════
     TOAST
  ═══════════════════════════════════════════ */
  function _showToast(msg, type = 'success') {
    let toast = document.getElementById('pf-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pf-toast';
      Object.assign(toast.style, {
        position:    'fixed',
        bottom:      '2rem',
        right:       '2rem',
        zIndex:      '9999',
        background:  'var(--white)',
        color:       'var(--black)',
        padding:     '.85rem 1.4rem',
        borderRadius:'8px',
        fontFamily:  '"Barlow",sans-serif',
        fontSize:    '.78rem',
        fontWeight:  '600',
        letterSpacing:'1px',
        boxShadow:   '0 4px 24px rgba(0,0,0,.45)',
        transform:   'translateY(120%)',
        transition:  'transform .35s cubic-bezier(.25,.46,.45,.94)',
        display:     'flex',
        alignItems:  'center',
        gap:         '.6rem',
        maxWidth:    '320px',
      });
      document.body.appendChild(toast);
    }

    const iconCheck = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const iconError = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e05" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    toast.innerHTML = (type === 'error' ? iconError : iconCheck) + msg;
    toast.style.transform = 'translateY(0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.transform = 'translateY(120%)'; }, 3200);
  }

  /* ═══════════════════════════════════════════
     PRICE FORMATTER
  ═══════════════════════════════════════════ */
  function _fmt(amount, currencyCode) {
    const sym = currencyCode === 'EUR' ? '€' : (PRIMEFIT_CONFIG.currency.symbol || '$');
    return `${sym}${parseFloat(amount).toFixed(2)}`;
  }

  function _priceRange(product) {
    const min = product.priceRange?.minVariantPrice;
    const max = product.priceRange?.maxVariantPrice;
    if (!min) return '';
    const minFmt = _fmt(min.amount, min.currencyCode);
    const maxFmt = _fmt(max.amount, max.currencyCode);
    if (min.amount === max.amount) return minFmt;
    return `${minFmt} – ${maxFmt}`;
  }

  /* ═══════════════════════════════════════════
     IMAGE FALLBACK
  ═══════════════════════════════════════════ */
  function _imgOrPlaceholder(src, alt) {
    if (src) {
      return `<img src="${src}" alt="${alt || ''}" loading="lazy"
               style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:var(--radius);"
               onerror="this.style.display='none'">`;
    }
    return '';   // keeps placeholder CSS background
  }

  /* ═══════════════════════════════════════════
     SKELETON CARDS
  ═══════════════════════════════════════════ */
  function _skeletonCard() {
    return `
      <div class="img-card" style="min-height:260px;pointer-events:none;">
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,var(--dark) 25%,rgba(255,255,255,.03) 50%,var(--dark) 75%);background-size:200%;animation:pf-shimmer 1.4s infinite;border-radius:var(--radius);"></div>
      </div>`;
  }

  /* ═══════════════════════════════════════════
     PRODUCT CARD
  ═══════════════════════════════════════════ */
  function _productCard(product) {
    const variantId  = product.variants?.edges?.[0]?.node?.id;
    const available  = product.availableForSale;
    const price      = _priceRange(product);
    const imgSrc     = product.featuredImage?.url;
    const imgAlt     = product.featuredImage?.altText || product.title;
    const categoryLabel = product.tags?.[0] || '';

    return `
      <div class="img-card" style="min-height:260px;"
           data-variant="${variantId || ''}"
           data-available="${available ? '1' : '0'}"
           role="article">
        <div class="ic-bg" style="background:#111;">
          ${_imgOrPlaceholder(imgSrc, imgAlt)}
        </div>
        <div class="ic-overlay"></div>
        <div class="ic-body">
          <div class="ic-text">
            ${categoryLabel ? `<div class="ic-sub">${categoryLabel}</div>` : ''}
            <div class="ic-title ic-title-sm">${product.title}</div>
            ${price ? `<div class="ic-price">${price}</div>` : ''}
            ${!available ? '<div class="ic-price" style="color:var(--muted);font-size:.62rem;">Esgotado</div>' : ''}
          </div>
          ${variantId && available
            ? `<button class="ic-add pf-add-btn" data-variant="${variantId}" aria-label="Adicionar ao carrinho">
                 <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
               </button>`
            : ''}
        </div>
      </div>`;
  }

  /* ═══════════════════════════════════════════
     COLLECTION CARD (for carousel)
  ═══════════════════════════════════════════ */
  function _collectionCard(col) {
    const imgSrc = col.image?.url;
    const imgAlt = col.image?.altText || col.title;

    return `
      <div class="coll-card" data-handle="${col.handle}" style="
        flex-shrink:0; width:220px; min-height:300px;
        position:relative; overflow:hidden; border-radius:var(--radius);
        background:var(--dark); cursor:none;
      ">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${imgAlt}" loading="lazy"
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:var(--radius);transition:transform .55s cubic-bezier(.25,.46,.45,.94);"
              onerror="this.style.display='none'">`
          : `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,#141414,#070707);border-radius:var(--radius);"></div>`}
        <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0) 30%,rgba(0,0,0,.85));border-radius:var(--radius);"></div>
        <div style="position:absolute;bottom:0;left:0;right:0;padding:1.2rem 1.1rem;z-index:2;">
          <div style="font-size:.58rem;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(242,240,236,.5);margin-bottom:.35rem;">Colecção</div>
          <div style="font-family:'Barlow',sans-serif;font-size:1.1rem;font-weight:700;color:var(--white);">${col.title}</div>
        </div>
      </div>`;
  }

  /* ═══════════════════════════════════════════
     RENDER — PRODUCTS GRID
  ═══════════════════════════════════════════ */
  async function _renderProducts() {
    const grid = document.getElementById('feat-grid');
    if (!grid) return;

    // Show skeletons while loading
    grid.innerHTML = Array(6).fill(_skeletonCard()).join('');

    const products = await ShopifyAPI.getProducts({ first: 18 });

    if (!products.length) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:3rem 0;color:var(--muted);font-size:.82rem;">
          Nenhum produto disponível de momento.
        </div>`;
      return;
    }

    grid.innerHTML = products.map(_productCard).join('');
    _bindAddButtons(grid);
    _refreshFilters();          // re-apply active pill filter
  }

  /* ═══════════════════════════════════════════
     RENDER — COLLECTIONS CAROUSEL
  ═══════════════════════════════════════════ */
  async function _renderCollections() {
    const track = document.getElementById('coll-track');
    if (!track) return;

    // Show skeletons
    track.innerHTML = Array(5).fill(`
      <div style="flex-shrink:0;width:220px;min-height:300px;border-radius:var(--radius);background:linear-gradient(90deg,var(--dark) 25%,rgba(255,255,255,.03) 50%,var(--dark) 75%);background-size:200%;animation:pf-shimmer 1.4s infinite;"></div>
    `).join('');

    const collections = await ShopifyAPI.getCollections(12);

    if (!collections.length) {
      // Hide the whole section gracefully
      const sec = document.getElementById('collections-section');
      if (sec) sec.style.display = 'none';
      return;
    }

    track.innerHTML = collections.map(_collectionCard).join('');

    // Click: filter products by collection
    track.querySelectorAll('.coll-card').forEach(card => {
      card.addEventListener('click', async () => {
        const handle = card.dataset.handle;
        const grid   = document.getElementById('feat-grid');
        if (!grid) return;

        grid.innerHTML = Array(6).fill(_skeletonCard()).join('');
        const products = await ShopifyAPI.getProductsByCollection(handle, 18);
        if (!products.length) {
          grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem 0;color:var(--muted);font-size:.82rem;">Sem produtos nesta colecção.</div>`;
          return;
        }
        grid.innerHTML = products.map(_productCard).join('');
        _bindAddButtons(grid);

        // Scroll to grid
        document.getElementById('destaque')?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  /* ═══════════════════════════════════════════
     ADD TO CART BUTTONS (event delegation)
  ═══════════════════════════════════════════ */
  function _bindAddButtons(container) {
    container.querySelectorAll('.pf-add-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const variantId = btn.dataset.variant;
        if (!variantId) return;

        btn.disabled = true;
        btn.style.opacity = '.5';
        await _addToCart(variantId);
        btn.disabled = false;
        btn.style.opacity = '';
      });
    });
  }

  /* ═══════════════════════════════════════════
     PILL FILTERS
  ═══════════════════════════════════════════ */
  function _initFilters() {
    const pills = document.querySelectorAll('.pill[data-filter]');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('on'));
        pill.classList.add('on');
        _refreshFilters(pill.dataset.filter);
      });
    });
  }

  // Note: with live Shopify data we re-fetch by tag.
  // The pill filter works both on fetched products (data-cat attribute)
  // and as a visual fallback for static HTML cards.
  function _refreshFilters(filter) {
    if (!filter) {
      const activePill = document.querySelector('.pill.on');
      filter = activePill?.dataset.filter || 'tudo';
    }

    const cards = document.querySelectorAll('#feat-grid .img-card[data-cat]');
    cards.forEach(card => {
      if (filter === 'tudo' || card.dataset.cat === filter) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  }

  /* ═══════════════════════════════════════════
     CART DRAWER
  ═══════════════════════════════════════════ */
  function _buildCartDrawer() {
    if (document.getElementById('pf-cart-drawer')) return;

    const drawer = document.createElement('div');
    drawer.id = 'pf-cart-drawer';
    Object.assign(drawer.style, {
      position:   'fixed',
      top:        '0',
      right:      '0',
      height:     '100vh',
      width:      '380px',
      maxWidth:   '100vw',
      background: 'var(--dark)',
      borderLeft: '1px solid var(--border)',
      zIndex:     '800',
      transform:  'translateX(100%)',
      transition: 'transform .38s cubic-bezier(.25,.46,.45,.94)',
      display:    'flex',
      flexDirection:'column',
    });

    drawer.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:1.2rem 1.4rem;border-bottom:1px solid var(--border);">
        <span style="font-family:'Oswald',sans-serif;font-size:1rem;letter-spacing:3px;font-weight:600;">CARRINHO</span>
        <button id="pf-cart-close" style="background:none;border:none;cursor:none;padding:4px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(242,240,236,.6)" stroke-width="1.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div id="pf-cart-lines" style="flex:1;overflow-y:auto;padding:1rem 1.4rem;"></div>
      <div style="padding:1.2rem 1.4rem;border-top:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;margin-bottom:1.2rem;">
          <span style="font-size:.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);">Total</span>
          <span id="pf-cart-total" style="font-family:'Oswald',sans-serif;font-size:1.1rem;font-weight:600;color:var(--white);">€0.00</span>
        </div>
        <button id="pf-checkout-btn" style="width:100%;background:var(--white);color:var(--black);padding:.85rem;border-radius:6px;font-family:'Barlow',sans-serif;font-size:.68rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:none;border:none;transition:background .2s;">
          Finalizar Compra →
        </button>
      </div>
    `;

    document.body.appendChild(drawer);
    document.getElementById('pf-cart-close').addEventListener('click', _closeCart);
    document.getElementById('pf-checkout-btn').addEventListener('click', _goToCheckout);
  }

  function _openCart() {
    _buildCartDrawer();
    document.getElementById('pf-cart-drawer').style.transform = 'translateX(0)';
    _renderCartLines();
  }

  function _closeCart() {
    const d = document.getElementById('pf-cart-drawer');
    if (d) d.style.transform = 'translateX(100%)';
  }

  async function _renderCartLines() {
    const linesEl = document.getElementById('pf-cart-lines');
    const totalEl = document.getElementById('pf-cart-total');
    if (!linesEl) return;

    if (!_cartId) {
      linesEl.innerHTML = '<p style="color:var(--muted);font-size:.82rem;text-align:center;margin-top:2rem;">O teu carrinho está vazio.</p>';
      return;
    }

    linesEl.innerHTML = '<p style="color:var(--muted);font-size:.75rem;">A carregar…</p>';

    try {
      const cart = await ShopifyAPI.cart.cartGet(_cartId);

      if (!cart || !cart.lines?.edges?.length) {
        linesEl.innerHTML = '<p style="color:var(--muted);font-size:.82rem;text-align:center;margin-top:2rem;">O teu carrinho está vazio.</p>';
        if (totalEl) totalEl.textContent = '€0.00';
        return;
      }

      _updateBadge(cart.totalQuantity);

      linesEl.innerHTML = cart.lines.edges.map(({ node }) => {
        const v     = node.merchandise;
        const price = parseFloat(v.priceV2.amount);
        const total = (price * node.quantity).toFixed(2);
        const sym   = v.priceV2.currencyCode === 'EUR' ? '€' : v.priceV2.currencyCode + ' ';
        const img   = v.image?.url;

        return `
          <div style="display:flex;gap:.9rem;align-items:flex-start;padding:.9rem 0;border-bottom:1px solid var(--border);">
            ${img ? `<img src="${img}" alt="${v.product.title}" loading="lazy" style="width:52px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.style.display='none'">` : ''}
            <div style="flex:1;min-width:0;">
              <div style="font-size:.78rem;font-weight:600;color:var(--white);margin-bottom:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.product.title}</div>
              ${v.title !== 'Default Title' ? `<div style="font-size:.65rem;color:var(--muted);margin-bottom:.3rem;">${v.title}</div>` : ''}
              <div style="font-size:.72rem;color:var(--gold);font-family:'Oswald',sans-serif;">${sym}${total} <span style="color:var(--muted);font-family:'Barlow',sans-serif;">× ${node.quantity}</span></div>
            </div>
            <button class="pf-remove-btn" data-line="${node.id}" style="background:none;border:none;cursor:none;padding:4px;flex-shrink:0;opacity:.5;transition:opacity .2s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--white)" stroke-width="1.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>`;
      }).join('');

      const rawTotal = cart.estimatedCost?.totalAmount?.amount;
      const curr     = cart.estimatedCost?.totalAmount?.currencyCode;
      if (totalEl && rawTotal) {
        const sym = curr === 'EUR' ? '€' : curr + ' ';
        totalEl.textContent = `${sym}${parseFloat(rawTotal).toFixed(2)}`;
      }

      // Bind remove buttons
      linesEl.querySelectorAll('.pf-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const lineId = btn.dataset.line;
          try {
            const updated = await ShopifyAPI.cart.cartLinesRemove(_cartId, [lineId]);
            if (updated) _updateBadge(updated.totalQuantity);
            _renderCartLines();
          } catch {
            _showToast('Erro ao remover item.', 'error');
          }
        });
      });

    } catch {
      linesEl.innerHTML = '<p style="color:var(--muted);font-size:.82rem;text-align:center;margin-top:2rem;">Erro ao carregar o carrinho.</p>';
    }
  }

  /* ═══════════════════════════════════════════
     COLLECTIONS HORIZONTAL CAROUSEL (drag)
  ═══════════════════════════════════════════ */
  function _initCarouselDrag(trackEl) {
    if (!trackEl) return;
    let isDown = false, startX = 0, scrollLeft = 0;

    trackEl.addEventListener('mousedown',  e => { isDown = true; startX = e.pageX - trackEl.offsetLeft; scrollLeft = trackEl.scrollLeft; trackEl.style.cursor = 'grabbing'; });
    trackEl.addEventListener('mouseleave', () => { isDown = false; trackEl.style.cursor = ''; });
    trackEl.addEventListener('mouseup',    () => { isDown = false; trackEl.style.cursor = ''; });
    trackEl.addEventListener('mousemove',  e => {
      if (!isDown) return;
      e.preventDefault();
      const x    = e.pageX - trackEl.offsetLeft;
      const walk = (x - startX) * 1.5;
      trackEl.scrollLeft = scrollLeft - walk;
    });

    // Touch
    let touchStart = 0, touchScroll = 0;
    trackEl.addEventListener('touchstart', e => { touchStart = e.touches[0].pageX; touchScroll = trackEl.scrollLeft; });
    trackEl.addEventListener('touchmove',  e => {
      const x    = e.touches[0].pageX;
      const walk = (touchStart - x) * 1.5;
      trackEl.scrollLeft = touchScroll + walk;
    });
  }

  /* ═══════════════════════════════════════════
     SCROLL REVEAL
  ═══════════════════════════════════════════ */
  function _initReveal() {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });

    document.querySelectorAll('.rv').forEach(el => obs.observe(el));
  }

  /* ═══════════════════════════════════════════
     CUSTOM CURSOR
  ═══════════════════════════════════════════ */
  function _initCursor() {
    const dot  = document.getElementById('cur');
    const ring = document.getElementById('cur-ring');
    if (!dot || !ring) return;

    let rx = 0, ry = 0;

    document.addEventListener('mousemove', e => {
      const x = e.clientX, y = e.clientY;
      dot.style.left  = x + 'px';
      dot.style.top   = y + 'px';
      rx += (x - rx) * 0.12;
      ry += (y - ry) * 0.12;
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
    });

    // Smooth ring with rAF
    (function loop() {
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      requestAnimationFrame(loop);
    })();
  }

  /* ═══════════════════════════════════════════
     "VER MAIS" BUTTON
  ═══════════════════════════════════════════ */
  function _initVerMais() {
    const btn   = document.getElementById('btn-ver-mais');
    const extra = document.getElementById('feat-grid-extra');
    if (!btn || !extra) return;

    btn.addEventListener('click', () => {
      const open = extra.style.display !== 'none';
      extra.style.display = open ? 'none' : 'grid';
      btn.innerHTML = open
        ? `Ver Mais <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
        : `Ver Menos <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

      if (!open) {
        // Bind add buttons in extra grid (static HTML fallback cards)
        extra.querySelectorAll('.ic-add').forEach(b => {
          if (!b.dataset.bound) {
            b.dataset.bound = '1';
            b.addEventListener('click', e => {
              e.stopPropagation();
              _showToast('Adiciona o token Shopify para activar o carrinho.', 'error');
            });
          }
        });
      }
    });
  }

  /* ═══════════════════════════════════════════
     NEWSLETTER FORM
  ═══════════════════════════════════════════ */
  function _initNewsletter() {
    const form  = document.querySelector('.nl-form');
    const input = document.querySelector('.nl-inp');
    const btn   = document.querySelector('.nl-sub');
    if (!form || !input || !btn) return;

    btn.addEventListener('click', () => {
      const email = input.value.trim();
      if (!email || !email.includes('@')) {
        _showToast('Introduz um email válido.', 'error');
        return;
      }
      _showToast('Subscrito com sucesso! Bem-vindo/a.');
      input.value = '';
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });
  }

  /* ═══════════════════════════════════════════
     NAV — CART ICON
  ═══════════════════════════════════════════ */
  function _initNav() {
    const cartBtn = document.querySelector('.n-cart');
    if (cartBtn) cartBtn.addEventListener('click', _openCart);

    // Nav link smooth scroll
    document.querySelectorAll('nav a[href^="#"]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  /* ═══════════════════════════════════════════
     SHIMMER KEYFRAMES (injected once)
  ═══════════════════════════════════════════ */
  function _injectShimmer() {
    if (document.getElementById('pf-shimmer-style')) return;
    const style = document.createElement('style');
    style.id = 'pf-shimmer-style';
    style.textContent = `
      @keyframes pf-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════
     LOAD INITIAL CART COUNT
  ═══════════════════════════════════════════ */
  async function _loadCartCount() {
    if (!_cartId) return;
    try {
      const cart = await ShopifyAPI.cart.cartGet(_cartId);
      if (cart) _updateBadge(cart.totalQuantity);
    } catch { /* silent */ }
  }

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  function init() {
    _injectShimmer();
    _initCursor();
    _initNav();
    _initFilters();
    _initVerMais();
    _initNewsletter();
    _initReveal();

    // Collections carousel
    const collTrack = document.getElementById('coll-track');
    _initCarouselDrag(collTrack);

    // Async data loads
    _renderCollections();
    _renderProducts();
    _loadCartCount();
  }

  // Guard: wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
