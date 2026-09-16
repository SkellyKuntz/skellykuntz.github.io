// Injected-wallet layer (EIP-1193 only). Connect, ensure the chain, send one
// call, or send many through EIP-5792 wallet_sendCalls when the wallet has it.
// In mock mode a fake wallet answers everything.
(function () {
  const C = window.SKELLY_CONFIG;
  const E = window.ethers;
  const SK = window.SK;

  class Wallet {
    constructor() { this.address = null; this.provider = null; this.signer = null; this.onChange = () => {}; }
    get injected() { return window.ethereum || null; }

    async connect() {
      if (C.mock) { this.address = '0x5Ke11Ec0FFEE0000000000000000000000000B0e'; this.onChange(); return this.address; }
      const eth = this.injected;
      if (!eth) throw new Error('No wallet found in this browser. Install one (MetaMask, Rabby, etc.) and reload.');
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      this.address = E.getAddress(accounts[0]);
      this.provider = new E.BrowserProvider(eth);
      eth.on?.('accountsChanged', (acc) => { this.address = acc[0] ? E.getAddress(acc[0]) : null; this.signer = null; this.onChange(); });
      eth.on?.('chainChanged', () => { this.signer = null; this.onChange(); });
      this.onChange();
      return this.address;
    }

    async ensureChain() {
      if (C.mock) return true;
      const eth = this.injected;
      const cur = await eth.request({ method: 'eth_chainId' });
      if (Number(cur) === C.chain.id) return true;
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: C.chain.hex }] });
      } catch (e) {
        if (e && (e.code === 4902 || /unrecognized|not added|4902/i.test(e.message || ''))) {
          await eth.request({ method: 'wallet_addEthereumChain', params: [{
            chainId: C.chain.hex, chainName: C.chain.name, nativeCurrency: C.chain.currency, rpcUrls: C.chain.rpcs, blockExplorerUrls: [C.chain.explorer],
          }] });
        } else throw e;
      }
      const after = await eth.request({ method: 'eth_chainId' });
      if (Number(after) !== C.chain.id) throw new Error(`Wallet is not on ${C.chain.name}.`);
      this.signer = null;
      return true;
    }

    async getSigner() {
      await this.ensureChain();
      if (!this.signer) this.signer = await this.provider.getSigner();
      return this.signer;
    }

    // One transaction. call = {to, iface, fn, args, label}
    async send(call, report) {
      if (C.mock) { await new Promise((r) => setTimeout(r, 700)); return { hash: '0x' + 'ab'.repeat(32), mock: true }; }
      const signer = await this.getSigner();
      const data = call.iface.encodeFunctionData(call.fn, call.args || []);
      let tx;
      try { tx = await signer.sendTransaction({ to: call.to, data }); }
      catch (e) { throw new Error(this.explain(e, call.iface)); }
      report?.('sent', tx.hash);
      const rc = await tx.wait();
      if (!rc || rc.status !== 1) throw new Error('Transaction reverted.');
      return { hash: tx.hash };
    }

    async supports5792() {
      if (C.mock) return true;
      const eth = this.injected;
      if (!eth || !this.address) return false;
      try {
        const caps = await eth.request({ method: 'wallet_getCapabilities', params: [this.address, [C.chain.hex]] });
        const c = caps && (caps[C.chain.hex] || caps[String(C.chain.id)]);
        return !!c; // any capability answer for this chain means sendCalls is understood
      } catch (e) { return false; }
    }

    // Many calls. Uses wallet_sendCalls when supported, else one tx after
    // another. report(step, info) narrates progress.
    async sendMany(calls, report) {
      if (C.mock) { for (let i = 0; i < calls.length; i++) { await new Promise((r) => setTimeout(r, 400)); report?.('done', i); } return { mock: true, batched: true }; }
      await this.ensureChain();
      const eth = this.injected;
      if (await this.supports5792()) {
        try {
          const payload = {
            version: '2.0.0', chainId: C.chain.hex, from: this.address, atomicRequired: false,
            calls: calls.map((c) => ({ to: c.to, data: c.iface.encodeFunctionData(c.fn, c.args || []) })),
          };
          const res = await eth.request({ method: 'wallet_sendCalls', params: [payload] });
          const id = typeof res === 'string' ? res : res.id;
          report?.('batched', id);
          for (let i = 0; i < 180; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            let st; try { st = await eth.request({ method: 'wallet_getCallsStatus', params: [id] }); } catch (e) { continue; }
            const code = st && (st.status ?? st.state);
            // EIP-5792 v2 status codes: 100 pending, 200 landed, 400 failed
            // off-chain, 500 reverted on chain, 600 partly reverted (only
            // possible with atomicRequired: false).
            if (code === 200) { calls.forEach((_, i) => report?.('done', i)); return { batched: true, id, receipts: st.receipts }; }
            if (code === 600) throw new Error('Some steps in the batch failed. Refresh and try the rest again.');
            if (typeof code === 'number' && code >= 400) throw new Error('The wallet reported the batch failed.');
            if (code === 'FAILED') throw new Error('The wallet reported the batch failed.');
          }
          throw new Error('Timed out waiting for the batch.');
        } catch (e) {
          if (/4100|4200|not supported|unsupported|does not support/i.test(e.message || '')) { /* fall through to sequential */ }
          else if (/reject|denied|cancel/i.test(e.message || '')) throw new Error('Rejected in the wallet.');
          else throw e;
        }
      }
      for (let i = 0; i < calls.length; i++) {
        report?.('now', i);
        await this.send(calls[i]);
        report?.('done', i);
      }
      return { batched: false };
    }

    explain(e, iface) {
      const data = revertData(e);
      if (data && iface) {
        try { const p = iface.parseError(data); if (p) return PLAIN[p.name] || `Contract refused: ${p.name}`; } catch (_) { /* not ours */ }
      }
      const m = e?.shortMessage || e?.message || String(e);
      if (/reject|denied|cancel/i.test(m)) return 'Rejected in the wallet.';
      if (/insufficient funds/i.test(m)) return 'Not enough ETH for gas.';
      if (/NotBound/.test(m)) return PLAIN.NotBound;
      return m.length > 160 ? m.slice(0, 160) + '…' : m;
    }
  }

  // Custom errors the contracts raise, in plain words. Anything else shows
  // its name.
  const PLAIN = {
    NotBound: "$SKELLY hasn't launched yet. Wake up opens when it does.",
    NotHolder: 'That Skelly is not in this wallet.',
    AlreadyRaised: 'That Skelly is already awake.',
    NotRaised: 'Wake it up first.',
    BadRank: 'Pick a level above the one it has.',
    BadAbsorb: 'Pick 2 or 3 of your own Skellies, 3 bodies at most, no repeats.',
    WalletsOnly: 'Use a plain wallet, not a smart-contract one.',
    NothingToUnearth: 'Nothing inside to take out.',
    BadOffering: 'That payout pick is not on the menu.',
    Forbidden: 'This wallet is not allowed to do that.',
  };

  // Wallets and ethers nest the revert bytes in different places
  // (e.data, e.info.error.data, e.error.data.data, e.data.originalError.data,
  // ...). Walk a few levels for the first thing that looks like ABI-encoded
  // revert data.
  function revertData(e, depth = 0) {
    if (e == null || depth > 5) return null;
    if (typeof e === 'string') return /^0x[0-9a-fA-F]{8}([0-9a-fA-F]{2})*$/.test(e) ? e : null;
    if (typeof e !== 'object') return null;
    for (const k of ['data', 'error', 'info', 'originalError', 'cause', 'revert']) {
      const found = revertData(e[k], depth + 1);
      if (found) return found;
    }
    return null;
  }

  window.SkellyWallet = Wallet;
})();
