// my.html: wallet, my Skellies, and every write behind an explicit dialog.
(function () {
  const C = window.SKELLY_CONFIG;
  const E = window.ethers;
  const SK = window.SK;
  const { IF } = window.SkellyChain;
  SK.chrome('/my/');

  const chain = window.SkellyChain.make();
  const wallet = new window.SkellyWallet();
  const $ = (id) => document.getElementById(id);
  const ADDR = C.contracts;

  let consts = null, offerings = [], mine = null, selected = new Set();
  // True while marrow() is the zero address: the mint is open, $SKELLY has
  // not launched, and raise / ascend / absorb revert NotBound.
  const unbound = () => !!consts && consts.marrowBound === false;
  const LAUNCH_NOTE = 'Wake up opens when $SKELLY launches.';

  // SkellyKuntz.powerOf, mirrored: rank power + absorbed power, then +20% for
  // two souls or +30% for three, then the relic bonus. Integer bps math like
  // the contract (the soul percentages are literals in the contract too).
  const previewPower = (rankIdx, absorbed, souls, relic) => {
    let p = consts.RANK_POWER[Math.max(0, rankIdx)] + (absorbed || 0);
    if (souls === 2) p = Math.floor((p * 12000) / 10000);
    else if (souls === 3) p = Math.floor((p * 13000) / 10000);
    if (relic) p = Math.floor((p * Number(consts.RELIC_BONUS_BPS)) / 10000);
    return p;
  };
  const mintLink = $('empty-mint');
  if (SK.linkOk(C.links.mint)) mintLink.href = C.links.mint; else mintLink.replaceWith('Mint one on OpenSea (link goes live at launch)');

  // ------------------------------------------------------------ connect
  // Nothing deployed yet: connecting a wallet could only ever show an empty
  // page, so say why instead of inviting it.
  if (!C.mock && !SK.configured('skellies')) {
    const b = $('btn-connect');
    b.disabled = true;
    b.textContent = 'Not launched yet';
    const note = SK.el('p', { class: 'note' },
      'SkellyKuntz has not been deployed yet. Once the mint is live this page shows your Skellies, what each one has earned and everything you can do with it.');
    b.parentNode.insertBefore(note, b.nextSibling);
  }

  $('btn-connect').addEventListener('click', async () => {
    try { await wallet.connect(); await load(); } catch (e) { SK.toast(wallet.explain(e), 'bad'); }
  });
  $('btn-disconnect').addEventListener('click', () => { wallet.address = null; mine = null; selected.clear(); paint(); });
  $('btn-refresh').addEventListener('click', load);
  wallet.onChange = () => { if (wallet.address) load(); else paint(); };

  async function load() {
    if (!wallet.address) return paint();
    $('addr').textContent = wallet.address;
    $('connect').classList.add('hidden'); $('connected').classList.remove('hidden');
    $('s-count').textContent = '…';
    try {
      // Re-read while the token is unbound so a Refresh after launch flips the page.
      if (!consts || consts.marrowBound !== true) consts = await chain.constants();
      if (!offerings.length) offerings = await chain.offerings();
      mine = await chain.mine(wallet.address);
      SK.netStatus(true);
    } catch (e) { SK.netStatus(false); SK.toast('Could not read the chain right now: ' + (e.message || e), 'bad'); mine = { ids: [], skellies: [], marrow: null }; }
    selected = new Set([...selected].filter((id) => mine.ids.includes(id)));
    paint();
  }

  // ------------------------------------------------------------ paint
  function paint() {
    const on = !!wallet.address;
    $('connect').classList.toggle('hidden', on); $('connected').classList.toggle('hidden', !on);
    $('stats').classList.toggle('hidden', !on || !mine);
    $('bulk').classList.toggle('hidden', !on || !mine || !mine.skellies.length);
    $('empty').classList.toggle('hidden', !on || !mine || mine.skellies.length > 0);
    $('launch-note').classList.toggle('hidden', !on || !mine || !unbound());
    const list = $('skellies'); list.innerHTML = '';
    if (!on || !mine) return;
    const m = mine.marrow;
    $('s-count').textContent = SK.int(mine.skellies.length);
    $('s-bal').textContent = m && m.balance != null ? `${SK.tokens(m.balance)} ${sym()}` : SK.dash;
    $('s-allow').textContent = m && m.allowance != null ? `${SK.tokens(m.allowance)} ${sym()}` : SK.dash;
    const owedAll = mine.skellies.reduce((a, s) => (s.owedEth == null ? a : (a == null ? 0n : a) + s.owedEth), null);
    $('s-owed').textContent = owedAll == null ? SK.dash : `${SK.eth(owedAll, 5)} ETH`;
    for (const s of mine.skellies) list.append(skellyCard(s));
    SK.lazy(list);
    updateBulk();
  }

  const rankName = (r) => (r < 0 ? 'never woken' : r === 0 ? 'Awake' : `Level ${r}`);
  function skellyCard(s) {
    const card = SK.artCard(s.form ?? 0, { lazy: true, label: !s.form ? 'SHROUDED' : (s.relic ? 'RELIC' : `form ${s.form}`) });
    const cb = SK.el('input', { type: 'checkbox', class: 'sel', title: 'select to merge', 'aria-label': `select Skelly #${s.id}` });
    cb.checked = selected.has(s.id);
    cb.addEventListener('change', () => { if (cb.checked) selected.add(s.id); else selected.delete(s.id); updateBulk(); });
    card.prepend(cb);
    const badges = [
      s.raised === true ? SK.el('span', { class: 'badge raised' }, 'awake') : s.raised === false ? SK.el('span', { class: 'badge rest' }, s.bonesBurned && s.bonesBurned > 0n ? 'asleep' : 'never woken') : null,
      s.relic ? SK.el('span', { class: 'badge relic' }, 'relic ×1.5') : null,
      s.souls > 1 ? SK.el('span', { class: 'badge souls' }, `${s.souls} souls`) : null,
    ];
    const holdRows = s.holdings.map((h) => SK.el('tr', null, SK.el('td', null, h.symbol), SK.el('td', { class: 'num' }, SK.units(h.amount, h.decimals, h.decimals === 6 ? 2 : 4)),
      SK.el('td', { class: 'right' }, SK.el('button', { class: 'btn xs', onclick: () => doUnearthOne(s, h) }, 'Take out'))));
    const owedRows = s.owedSlots.map((h) => SK.el('tr', null, SK.el('td', null, `${h.symbol} (waiting)`), SK.el('td', { class: 'num' }, SK.units(h.amount, h.decimals, 4)),
      SK.el('td', { class: 'right' }, SK.el('button', { class: 'btn xs', onclick: () => doUnearthOwed(s, h) }, 'Take'))));
    const portion = s.portion && s.portion.count ? s.portion.idx.map((i, k) => `${(offerings[i] || { symbol: `#${i}` }).symbol} ${s.portion.bps[k] / 100}%`).join(' · ') : 'USDG (default)';
    const off = unbound();
    const canAscend = !off && s.bonesBurned != null && s.bonesBurned > 0n && s.rank < 4;
    return SK.el('article', { class: 'panel sk', dataset: { id: s.id } },
      card,
      SK.el('div', null,
        SK.el('div', { class: 'title' }, SK.el('h3', null, `Skelly #${s.id}`), badges),
        SK.el('dl', { class: 'kv' },
          SK.el('dt', null, 'Level'), SK.el('dd', null, rankName(s.rank)),
          SK.el('dt', null, 'Share points'), SK.el('dd', null, s.raised ? SK.power(s.power) : (s.power ? `${SK.power(s.power)} once awake` : SK.dash)),
          SK.el('dt', null, '$SKELLY burned so far'), SK.el('dd', null, s.bonesBurned == null ? SK.dash : SK.tokens(s.bonesBurned)),
          SK.el('dt', null, 'ETH waiting'), SK.el('dd', null, s.owedEth == null ? SK.dash : `${SK.eth(s.owedEth, 5)} ETH`),
          SK.el('dt', { class: 'full' }, 'Paid in'), SK.el('dd', { class: 'wrap' }, portion))),
      SK.el('div', { class: 'actions' },
        s.raised === false ? SK.el('button', { class: 'btn xs acid', disabled: off, title: off ? LAUNCH_NOTE : null, onclick: () => doRaise(s) }, 'Wake up') : null,
        SK.el('button', { class: 'btn xs lemon', disabled: !canAscend, title: off ? LAUNCH_NOTE : null, onclick: () => doAscend(s) }, s.rank >= 4 ? 'Max level' : 'Level up'),
        SK.el('button', { class: 'btn xs sky', onclick: () => doPortion(s) }, 'Payout pick'),
        SK.el('button', { class: 'btn xs', disabled: !s.holdings.length, onclick: () => doUnearth(s) }, 'Take out all')),
      (holdRows.length || owedRows.length) ? SK.el('div', { class: 'hold' }, SK.el('table', null, SK.el('thead', null, SK.el('tr', null, SK.el('th', null, 'Holding'), SK.el('th', { class: 'num' }, 'Amount'), SK.el('th', null, ''))), SK.el('tbody', null, holdRows, owedRows)))
        : SK.el('div', { class: 'hold dim small' }, 'Nothing inside this Skelly yet.'));
  }
  function updateBulk() {
    const n = selected.size;
    const off = unbound();
    $('btn-absorb').disabled = off || n < 2 || n > 3;
    $('btn-absorb').title = off ? LAUNCH_NOTE : '';
    $('sel-note').textContent = off ? `Merge opens when $SKELLY launches.` : n ? `${n} selected. The one that stays: #${[...selected][0]}.` : 'Tick 2 or 3 Skellies to merge. The first one you tick is the one that stays.';
    $('btn-unearth-all').disabled = !mine || !mine.skellies.some((s) => s.holdings.length);
  }

  // ------------------------------------------------------------ dialog + run
  const line = (k, v, burn) => SK.el('div', { class: 'line' + (burn ? ' burn' : '') }, SK.el('span', null, k), SK.el('b', null, v));
  const sym = () => '$' + (mine && mine.marrow && mine.marrow.symbol ? mine.marrow.symbol.replace(/^\$/, '') : 'SKELLY');

  // Runs a list of steps [{label, call}] with a progress modal. `burn` is the
  // exact marrow amount the action pulls, so the approval step can be added.
  async function run(title, lines, steps, burn) {
    if (!wallet.address) return;
    const need = burn && burn > 0n;
    // Every burn goes through marrow.transferFrom inside the collection; with
    // no token bound the contract reverts NotBound, so stop here in plain words.
    if (need && (unbound() || !mine.marrow || !mine.marrow.address)) return SK.toast(unbound() ? LAUNCH_NOTE : 'Could not read the $SKELLY token. Refresh and try again.', 'bad');
    let approveMode = 'exact';
    const body = SK.el('div', null, SK.el('div', { class: 'lines' }, lines));
    if (need) {
      const m = mine.marrow;
      if (m && m.balance != null && m.balance < burn) { body.append(SK.el('p', { class: 'note' }, `Your balance is ${SK.tokens(m.balance)} ${sym()}: not enough for this burn.`)); }
      if (!m || m.allowance == null || m.allowance < burn) {
        body.append(SK.el('p', { class: 'note' }, `The collection needs approval to pull ${SK.tokens(burn)} ${sym()} from you and send it to the dead address.`));
        const sel = SK.el('select', null, SK.el('option', { value: 'exact' }, `Approve exactly ${SK.tokens(burn)} ${sym()} (you'll sign an approval again next time)`), SK.el('option', { value: 'ten' }, `Approve ${SK.tokens(burn * 10n)} ${sym()} (skip that step next time)`));
        sel.addEventListener('change', () => (approveMode = sel.value));
        body.append(SK.el('label', null, 'Approval', sel));
      }
    }
    body.append(SK.el('p', { class: 'note' }, 'Burns are forever. Nothing here can be undone or refunded.'));
    const ok = await SK.modal({ title, body, ok: 'Sign', danger: need });
    if (!ok) return;
    const all = [];
    if (need && (!mine.marrow || mine.marrow.allowance == null || mine.marrow.allowance < burn)) {
      const amount = approveMode === 'ten' ? burn * 10n : burn;
      all.push({ label: `Approve ${SK.tokens(amount)} ${sym()}`, call: { to: mine.marrow.address, iface: IF.erc20, fn: 'approve', args: [ADDR.skellies, amount] }, mock: ['approve', { amount }] });
    }
    all.push(...steps);
    await progress(title, all);
  }

  async function progress(title, steps, batch = false) {
    const ol = SK.el('ol', null, steps.map((s) => SK.el('li', null, s.label)));
    const body = SK.el('div', { class: 'progress' }, SK.el('p', null, batch ? 'Sending as one batch if your wallet allows it, otherwise one at a time.' : 'Sign each step in your wallet.'), ol);
    const p = SK.modal({ title, body, ok: null, cancel: 'Hide' });
    const items = ol.children;
    const mark = (i, cls, extra) => { items[i].className = cls; if (extra) items[i].append(' ', extra); };
    try {
      if (batch) {
        const res = await wallet.sendMany(steps.map((s) => s.call), (ev, i) => { if (ev === 'now') mark(i, 'now'); if (ev === 'done') mark(i, 'done'); if (ev === 'batched') for (let k = 0; k < items.length; k++) mark(k, 'now'); });
        if (C.mock) steps.forEach((s) => s.mock && chain.apply(...s.mock));
        for (let i = 0; i < items.length; i++) mark(i, 'done');
        SK.toast(res.batched ? 'Batch landed.' : 'All steps landed.', 'good');
      } else {
        for (let i = 0; i < steps.length; i++) {
          mark(i, 'now');
          const r = await wallet.send(steps[i].call, (ev, h) => { if (ev === 'sent') mark(i, 'now', SK.el('a', { href: SK.explorerTx(h), target: '_blank', rel: 'noopener' }, 'tx')); });
          if (C.mock && steps[i].mock) chain.apply(...steps[i].mock);
          mark(i, 'done', r.mock ? '(mock)' : null);
        }
        SK.toast('Done.', 'good');
      }
    } catch (e) {
      const i = [...items].findIndex((li) => li.className === 'now');
      if (i >= 0) mark(i, 'fail', `— ${e.message}`);
      SK.toast(e.message, 'bad', 6000);
    }
    SK.closeModal(); await p;
    await load();
  }

  // ------------------------------------------------------------ actions
  function doRaise(s) {
    if (!consts) return SK.toast('Constants not loaded.', 'bad');
    const burn = consts.RAISE_BURN;
    // A rested Skelly keeps its rank: powerOf already says what it earns
    // once awake. A never-woken one is seeded at rank 0 by the raise.
    const power = s.bonesBurned > 0n && s.power ? s.power : previewPower(s.rank, s.absorbedPower, s.souls, s.relic);
    run(`Wake up Skelly #${s.id}`, [
      line('Burn', `${SK.tokens(burn)} ${sym()}`, true),
      line('Starts earning', 'from the next hour'),
      line('Share points once awake', SK.power(power)),
    ], [{ label: `raise(#${s.id})`, call: { to: ADDR.skellies, iface: IF.skellies, fn: 'raise', args: [s.id] }, mock: ['raise', { id: s.id }] }], burn);
  }

  async function doAscend(s) {
    if (!consts) return SK.toast('Constants not loaded.', 'bad');
    const cur = s.bonesBurned || 0n;
    let pick = null;
    const body = SK.el('div', { class: 'rankpick' });
    const powerAt = (r) => previewPower(r, s.absorbedPower, s.souls, s.relic);
    const btns = [];
    for (let r = 1; r <= 4; r++) {
      const cost = consts.RANK_BURN[r] - cur;
      const b = SK.el('button', { disabled: cost <= 0n },
        SK.el('span', { class: 'r' }, `Level ${r}`), SK.el('span', { class: 'c' }, cost <= 0n ? 'reached' : `burn ${SK.tokens(cost)} ${sym()}`),
        SK.el('span', { class: 'small' }, `share points ${SK.power(powerAt(r))}`), SK.el('span', { class: 'c small' }, cost <= 0n ? '' : `${SK.power(powerAt(r) - (s.power || powerAt(Math.max(0, s.rank))))} more than now`));
      b.addEventListener('click', () => { pick = r; btns.forEach((x) => x.classList.remove('on')); b.classList.add('on'); });
      btns.push(b); body.append(b);
    }
    const ok = await SK.modal({ title: `Level up Skelly #${s.id}`, body: SK.el('div', null, SK.el('p', { class: 'note' }, `Right now: ${rankName(s.rank)}, ${SK.tokens(cur)} ${sym()} burned so far. You only pay the difference to the level you pick.`), body), ok: 'Next' });
    if (!ok || !pick) return;
    const cost = consts.RANK_BURN[pick] - cur;
    run(`Level up #${s.id} to level ${pick}`, [
      line('Burn', `${SK.tokens(cost)} ${sym()}`, true),
      line('Total burned after', `${SK.tokens(consts.RANK_BURN[pick])} ${sym()}`),
      line('Share points', `${SK.power(s.raised ? s.power : powerAt(Math.max(0, s.rank)))} → ${SK.power(powerAt(pick))}${s.raised ? '' : ' (once awake)'}`),
    ], [{ label: `ascend(#${s.id}, ${pick})`, call: { to: ADDR.skellies, iface: IF.skellies, fn: 'ascend', args: [s.id, pick] }, mock: ['ascend', { id: s.id, rank: pick }] }], cost);
  }

  $('btn-absorb').addEventListener('click', () => {
    if (!consts) return SK.toast('Constants not loaded.', 'bad');
    const ids = [...selected];
    const sk = ids.map((id) => mine.skellies.find((x) => x.id === id));
    const survivor = sk[0];
    const totalSouls = sk.reduce((a, x) => a + (x.souls || 1), 0);
    if (totalSouls > 3) return SK.toast(`Those add up to ${totalSouls} bodies. The most a Skelly can hold is 3.`, 'bad');
    let cost = consts.ABSORB_BURN_TWO;
    if (totalSouls === 3) cost += consts.ABSORB_BURN_THREE;
    if (survivor.souls === 2 && totalSouls === 3) cost = consts.ABSORB_BURN_THREE;
    const base = (x) => (x.bonesBurned && x.bonesBurned > 0n ? consts.RANK_POWER[Math.max(0, x.rank)] + (x.absorbedPower || 0) : 0);
    const gained = sk.slice(1).reduce((a, x) => a + base(x), 0);
    // powerOf(survivor) after: rank power + (absorbed + gained), soul bonus
    // for the new total, then the survivor's relic bonus. A never-woken
    // survivor reads 0 until raised; the preview shows what a raise gives.
    const after = previewPower(survivor.rank, (survivor.absorbedPower || 0) + gained, totalSouls, survivor.relic);
    run(`Merge into Skelly #${survivor.id}`, [
      line('Burn', `${SK.tokens(cost)} ${sym()}`, true),
      line('Gone forever', sk.slice(1).map((x) => `#${x.id}${x.relic ? ' (its relic bonus is lost)' : ''}`).join(', ')),
      line('Bodies after', `${totalSouls} (+${totalSouls === 2 ? 20 : 30}% bonus)`),
      line('Share points of the one that stays', `${survivor.raised ? SK.power(survivor.power) : SK.dash} → ${SK.power(after)}${survivor.raised ? '' : ' (once awake)'}`),
      line('Everything inside them', 'moves to the one that stays'),
    ], [{ label: `absorb([${ids.join(', ')}])`, call: { to: ADDR.skellies, iface: IF.skellies, fn: 'absorb', args: [ids] }, mock: ['absorb', { ids, cost }] }], cost);
    selected.clear();
  });

  async function doPortion(s) {
    if (!offerings.length) return SK.toast('The payout menu could not be loaded.', 'bad');
    const rows = [];
    const cur = s.portion && s.portion.count ? s.portion : { idx: [offerings.length - 1], bps: [10000], count: 1 };
    const body = SK.el('div', null, SK.el('p', { class: 'note' }, 'Pick up to three. The percentages must add up to 100. This only changes what future hours buy for this Skelly.'));
    const wrap = SK.el('div');
    const addRow = (idx = 0, pct = 0) => {
      const sel = SK.el('select', null, offerings.map((o) => SK.el('option', { value: o.idx, selected: o.idx === idx }, `${o.symbol}${o.isStock ? '' : ' (stable)'}`)));
      const num = SK.el('input', { type: 'number', min: 0, max: 100, step: 0.01, value: pct });
      const row = SK.el('div', { class: 'row' }, sel, num, SK.el('button', { class: 'btn xs ghost', onclick: () => { rows.splice(rows.indexOf(row), 1); row.remove(); } }, '×'));
      row._sel = sel; row._num = num; rows.push(row); wrap.append(row);
    };
    cur.idx.forEach((i, k) => addRow(i, cur.bps[k] / 100));
    body.append(wrap, SK.el('button', { class: 'btn xs', onclick: () => { if (rows.length < 3) addRow(offerings[0].idx, 0); } }, '+ add another'));
    const ok = await SK.modal({ title: `Payout pick for Skelly #${s.id}`, body, ok: 'Next' });
    if (!ok) return;
    const idx = rows.map((r) => Number(r._sel.value));
    const bps = rows.map((r) => Math.round(Number(r._num.value) * 100));
    if (!idx.length || idx.length > 3) return SK.toast('Pick one to three things.', 'bad');
    if (new Set(idx).size !== idx.length) return SK.toast('Each one only once.', 'bad');
    if (bps.reduce((a, b) => a + b, 0) !== 10000) return SK.toast('The percentages must add up to exactly 100.', 'bad');
    run(`Payout pick for #${s.id}`, idx.map((i, k) => line((offerings.find((o) => o.idx === i) || {}).symbol || `#${i}`, `${bps[k] / 100}%`)),
      [{ label: `Crypt.setPortion(#${s.id})`, call: { to: ADDR.crypt, iface: IF.crypt, fn: 'setPortion', args: [s.id, idx, bps] }, mock: ['portion', { id: s.id, idx, bps }] }], 0n);
  }

  function doUnearth(s) {
    run(`Take everything out of #${s.id}`, s.holdings.map((h) => line(h.symbol, SK.units(h.amount, h.decimals, h.decimals === 6 ? 2 : 4))),
      [{ label: `Ossuary.unearth(#${s.id})`, call: { to: ADDR.ossuary, iface: IF.ossuary, fn: 'unearth', args: [s.id] }, mock: ['unearth', { id: s.id }] }], 0n);
  }
  function doUnearthOne(s, h) {
    run(`Take ${h.symbol} out of #${s.id}`, [line(h.symbol, SK.units(h.amount, h.decimals, h.decimals === 6 ? 2 : 4))],
      [{ label: `Ossuary.unearthOne(#${s.id}, ${h.idx})`, call: { to: ADDR.ossuary, iface: IF.ossuary, fn: 'unearthOne', args: [s.id, h.idx] }, mock: ['unearth', { id: s.id }] }], 0n);
  }
  function doUnearthOwed(s, h) {
    run(`Take waiting ${h.symbol} out of #${s.id}`, [line(h.symbol, SK.units(h.amount, h.decimals, 4))],
      [{ label: `Crypt.unearthOwed(#${s.id}, ${h.idx})`, call: { to: ADDR.crypt, iface: IF.crypt, fn: 'unearthOwed', args: [s.id, h.idx] }, mock: ['unearthOwed', { id: s.id, idx: h.idx }] }], 0n);
  }

  $('btn-unearth-all').addEventListener('click', async () => {
    const with_ = mine.skellies.filter((s) => s.holdings.length);
    if (!with_.length) return;
    const lines = with_.map((s) => line(`#${s.id}`, s.holdings.map((h) => `${SK.units(h.amount, h.decimals, h.decimals === 6 ? 2 : 4)} ${h.symbol}`).join(' · ')));
    const ok = await SK.modal({ title: `Take out from ${with_.length} Skellies`, body: SK.el('div', null, SK.el('div', { class: 'lines' }, lines), SK.el('p', { class: 'note' }, 'One signature for all of them if your wallet supports batching. Otherwise one at a time, in order.')), ok: 'Sign' });
    if (!ok) return;
    const steps = with_.map((s) => ({ label: `Ossuary.unearth(#${s.id})`, call: { to: ADDR.ossuary, iface: IF.ossuary, fn: 'unearth', args: [s.id] }, mock: ['unearth', { id: s.id }] }));
    await progress('Take out all', steps, true);
  });

  paint();
})();
