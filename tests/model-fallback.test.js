import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiService as BaseGeminiService } from '../src/services/gemini.service.js';
import { TEXT_FALLBACK_CHAIN, DOCUMENT_FALLBACK_CHAIN } from '../src/config/modelFallbacks.js';
import { withGeminiKey } from '../src/services/geminiContext.service.js';

// Exercise provider fallback without consuming the shared production budget.
class GeminiService extends BaseGeminiService {
    constructor(client, options = {}) { super(client, { ...options, budget: null }); }
}

const providerError = status => Object.assign(new Error('Private provider URL and key'), { status });

test('requested chains are kept in exact order', () => {
    assert.deepEqual(TEXT_FALLBACK_CHAIN, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    assert.deepEqual(DOCUMENT_FALLBACK_CHAIN, ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
});

test('text and PDF requests advance in order while preserving all prompt and evidence data', async () => {
    for (const documents of [false, true]) {
        const chain = documents ? DOCUMENT_FALLBACK_CHAIN : TEXT_FALLBACK_CHAIN;
        const calls = [];
        const service = new GeminiService({ models: { generateContent: async request => {
            calls.push(request);
            if (calls.length < chain.length) throw providerError([429, 503, 404, 500, 502, 504][calls.length - 1]);
            return { text: '{"verified":true}' };
        } } }, { wait: async () => assert.fail('Should switch models before waiting') });
        const pdf = { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0=' } };
        const result = documents
            ? await service.generateContentWithFiles('instructions', 'claim', [pdf])
            : await service.generateJSON('instructions', 'claim');
        assert.equal(result, '{"verified":true}');
        assert.deepEqual(calls.map(call => call.model), chain);
        for (const call of calls) {
            assert.deepEqual(call.contents, documents ? [pdf, 'claim'] : 'claim');
            assert.strictEqual(call.contents, calls[0].contents);
            assert.deepEqual(call.config, { systemInstruction: 'instructions', responseMimeType: 'application/json' });
        }
    }
});

test('bad credentials and invalid requests stop without cycling through models', async () => {
    for (const status of [400, 401, 403]) {
        let calls = 0;
        const service = new GeminiService({ models: { generateContent: async () => {
            calls++; throw providerError(status);
        } } });
        await assert.rejects(service.generateJSON('system', 'claim'), error => {
            assert.equal(error.status, status);
            assert.equal(error.code, 'GEMINI_REQUEST_FAILED');
            assert.doesNotMatch(error.message, /Private provider/);
            return true;
        });
        assert.equal(calls, 1);
    }
});

test('unavailable chains fail safely and overload retries on the final model stay bounded', async () => {
    for (const status of [404, 429, 503]) {
        const calls = [], waits = [];
        const service = new GeminiService({ models: { generateContent: async ({ model }) => {
            calls.push(model); throw providerError(status);
        } } }, { wait: async ms => waits.push(ms) });
        await assert.rejects(service.generateContentWithFiles('system', 'claim', []), error => {
            assert.equal(error.status, status);
            assert.equal(error.code, 'GEMINI_REQUEST_FAILED');
            assert.equal(error.cause, undefined);
            assert.doesNotMatch(error.message, /Private provider/);
            return true;
        });
        assert.deepEqual(calls, status === 404 ? DOCUMENT_FALLBACK_CHAIN : [...DOCUMENT_FALLBACK_CHAIN, 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite']);
        assert.deepEqual(waits, status === 404 ? [] : [1000, 2000]);
    }
});

test('key verification succeeds when only a fallback in each chain is accessible', async () => {
    const calls = [];
    const service = new GeminiService({ models: { generateContent: async ({ model }) => {
        calls.push(model);
        if (model !== 'gemini-3.1-flash-lite') throw providerError(404);
        return { text: 'OK' };
    } } });
    const result = await service.validateKey();
    assert.equal(result.valid, true);
    assert.deepEqual(result.models, ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite']);
    assert.deepEqual(calls, [...TEXT_FALLBACK_CHAIN, ...DOCUMENT_FALLBACK_CHAIN.slice(0, 3)]);
});

test('concurrent fallback chains keep request credentials isolated and restart at the primary per call', async () => {
    const service = new GeminiService();
    const seen = new Map();
    await Promise.all(['test-key-a', 'test-key-b'].map(key => withGeminiKey(key, async () => {
        for (let run = 0; run < 2; run++) assert.equal(await service.generateJSON('system', 'claim'), key);
    }, credential => ({ models: { generateContent: async ({ model }) => {
        await new Promise(resolve => setImmediate(resolve));
        const calls = seen.get(credential) || []; calls.push(model); seen.set(credential, calls);
        if (model === TEXT_FALLBACK_CHAIN[0]) throw providerError(429);
        return { text: credential };
    } } }))));
    for (const calls of seen.values()) assert.deepEqual(calls, [...TEXT_FALLBACK_CHAIN.slice(0, 2), ...TEXT_FALLBACK_CHAIN.slice(0, 2)]);
    assert.equal(seen.size, 2);
});
