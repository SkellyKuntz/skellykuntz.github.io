// JSON-RPC with node rotation, batching (≤ batchMax calls per request) and
// Multicall3 for bulk eth_call when the chain has it.
(function () {
  const C = window.SKELLY_CONFIG;
  const E = window.ethers;

  class Rpc {
    constructor(urls) {
      this.urls = urls.slice();
      this.cursor = 0;
      this.dead = new Set();
      this.nextId = 1;
      this.mc = null; // null = unknown, false = absent, Interface = present
    }

    _url() {
      for (let i = 0; i < this.urls.length; i++) {
        const u = this.urls[(this.cursor + i) % this.urls.length];
        if (!this.dead.has(u)) { this.cursor = (this.cursor + i) % this.urls.length; return u; }
      }
      this.dead.clear(); // everything failed: try again from the top
      return this.urls[this.cursor];
    }

    async _post(url, payload) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    }

    // calls: [{method, params}] -> results in order; throws if a node error
    // survives rotation. Per-call RPC errors are returned as {error}.
    async batch(calls) {
      if (!calls.length) return [];
      const out = new Array(calls.length);
      const max = C.chain.batchMax || 40;
      for (let start = 0; start < calls.length; start += max) {
        const slice = calls.slice(start, start + max);
        const payload = slice.map((c) => ({ jsonrpc: '2.0', id: this.nextId++, method: c.method, params: c.params || [] }));
        let res, lastErr;
        for (let attempt = 0; attempt < this.urls.length + 1; attempt++) {
          const url = this._url();
          try {
            res = await this._post(url, payload.length === 1 ? payload[0] : payload);
            if (!Array.isArray(res)) res = [res];
            if (res.some((r) => r && r.error && /rate|limit|429|busy/i.test(r.error.message || ''))) throw new Error(res.find((r) => r.error).error.message);
            break;
          } catch (e) {
            lastErr = e; this.dead.add(url); this.cursor = (this.cursor + 1) % this.urls.length; res = null;
          }
        }
        if (!res) throw lastErr || new Error('rpc unreachable');
        const byId = new Map(res.map((r) => [r.id, r]));
        payload.forEach((p, i) => { const r = byId.get(p.id); out[start + i] = r ? (r.error ? { error: r.error } : r.result) : { error: { message: 'missing' } }; });
      }
      return out;
    }

    async one(method, params) {
      const [r] = await this.batch([{ method, params }]);
      if (r && r.error) throw new Error(r.error.message || 'rpc error');
      return r;
    }

    async block() {
      const b = await this.one('eth_getBlockByNumber', ['latest', false]);
      return { number: Number(b.number), timestamp: Number(b.timestamp) };
    }

    async probeMulticall() {
      if (this.mc !== null) return this.mc;
      try {
        const r = await this.one('eth_call', [{ to: C.chain.multicall3, data: '0x3408e470' }, 'latest']); // getChainId()
        this.mc = Number(BigInt(r)) === C.chain.id ? new E.Interface([
          'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
        ]) : false;
      } catch (e) { this.mc = false; }
      return this.mc;
    }

    // reads: [{to, iface, fn, args}] -> decoded results (null where the call failed)
    async reads(reads) {
      if (!reads.length) return [];
      const enc = reads.map((r) => ({ to: r.to, data: r.iface.encodeFunctionData(r.fn, r.args || []) }));
      const raw = new Array(reads.length).fill(null);
      const mc = await this.probeMulticall();
      if (mc) {
        const chunk = C.chain.multicallChunk || 250;
        const calls = [];
        for (let s = 0; s < enc.length; s += chunk) {
          const part = enc.slice(s, s + chunk).map((c) => ({ target: c.to, allowFailure: true, callData: c.data }));
          calls.push({ method: 'eth_call', params: [{ to: C.chain.multicall3, data: mc.encodeFunctionData('aggregate3', [part]) }, 'latest'] });
        }
        const res = await this.batch(calls);
        res.forEach((r, ci) => {
          if (!r || r.error) return;
          const [rows] = mc.decodeFunctionResult('aggregate3', r);
          rows.forEach((row, i) => { if (row.success && row.returnData !== '0x') raw[ci * chunk + i] = row.returnData; });
        });
      } else {
        const res = await this.batch(enc.map((c) => ({ method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] })));
        res.forEach((r, i) => { if (r && !r.error && r !== '0x') raw[i] = r; });
      }
      return raw.map((hex, i) => {
        if (!hex) return null;
        try { const d = reads[i].iface.decodeFunctionResult(reads[i].fn, hex); return d.length === 1 ? d[0] : d; } catch (e) { return null; }
      });
    }

    // Event scan over a block range, shrinking the range on failure.
    async logs(address, topics, fromBlock, toBlock) {
      let from = fromBlock;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await this.one('eth_getLogs', [{ address, topics, fromBlock: '0x' + from.toString(16), toBlock: '0x' + toBlock.toString(16) }]);
        } catch (e) { from = toBlock - Math.floor((toBlock - from) / 3); }
      }
      return null;
    }
  }

  window.SkellyRpc = Rpc;
})();
