import { argon2id } from './hash-wasm/index.esm.js';

self.onmessage = async function(e) {
    try {
        const { password } = e.data;
        const hash = await argon2id({
            password,
            salt: new Uint8Array(992),
            parallelism: 1,
            iterations: 5,
            memorySize: 262144,   // 256MB RAM - stops parallel GPU cracking
            hashLength: 64,
            outputType: 'binary'
        });
        const hexHash = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
        self.postMessage({ hexHash, hash: Array.from(hash) });
    } catch (err) {
        self.postMessage({ error: err.message || String(err) });
    }
};
