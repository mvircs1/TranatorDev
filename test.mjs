import assert from 'node:assert/strict';

const calls = [];
const answer = (text) => new Response(text, { status: 200 });
let scenario = 'success';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
};
globalThis.window = {
  location: new URL('https://tauri.local/'),
  fetch: async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (String(input).startsWith('https://translate.yandex.net/')) {
      if (scenario === 'cors') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ text: ['Olá, tudo bem?'] }), { status: 200, headers: {'content-type':'application/json'} });
    }
    if (input === '/api/translate/google') return answer('Olá, via Google');
    return answer('Não interceptada');
  },
};

const { _test } = await import('../index.js');
const post = (chunks, lang='pt-BR') => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chunks, lang }) });

// 1. A requisição exata usa Yandex, não backend quebrado.
let res = await window.fetch('/api/translate/yandex', post(['Hello, how are you?']));
assert.equal(res.status, 200);
assert.equal(await res.text(), 'Olá, tudo bem?');
assert.equal(calls[0].input.startsWith('https://translate.yandex.net/'), true);
assert.equal(new URLSearchParams(calls[0].init.body).get('lang'), 'pt-BR');

// 2. PT genérico do seletor também pede português brasileiro.
res = await window.fetch('/api/translate/yandex', post(['Hello again'], 'pt'));
assert.equal(res.status, 200);
assert.equal(new URLSearchParams(calls.at(-1).init.body).get('lang'), 'pt-BR');

// 3. Tradução das entradas para inglês continua com en.
res = await window.fetch('/api/translate/yandex', post(['Olá'], 'en'));
assert.equal(res.status, 200);
assert.equal(new URLSearchParams(calls.at(-1).init.body).get('lang'), 'en');

// 4. Opcionalmente, o usuário pode solicitar pt genérico novamente.
_test.settings.brazilianPortuguese = false;
res = await window.fetch('/api/translate/yandex', post(['Hello'], 'pt-BR'));
assert.equal(res.status, 200);
assert.equal(new URLSearchParams(calls.at(-1).init.body).get('lang'), 'pt');
_test.settings.brazilianPortuguese = true;

// 5. Outras rotas permanecem intactas.
res = await window.fetch('/api/translate/google', post(['Hello']));
assert.equal(await res.text(), 'Olá, via Google');
assert.equal(calls.at(-1).input, '/api/translate/google');

// 6. Quando Yandex falha, não finge que houve uma tradução.
scenario = 'cors';
res = await window.fetch('/api/translate/yandex', post(['Hello']));
assert.equal(res.status, 502);
assert.match(await res.text(), /CORS\/rede/);

// 7. Quando fallback explicitamente ativado, utiliza Google.
_test.settings.fallbackGoogle = true;
_test.settings.notifyFallback = false;
res = await window.fetch('/api/translate/yandex', post(['Hello']));
assert.equal(res.status, 200);
assert.equal(await res.text(), 'Olá, via Google');
assert.equal(calls.at(-1).input, '/api/translate/google');

// 8. Quando desativado, envia requisição original, sem trocar o provedor.
_test.settings.enabled = false;
res = await window.fetch('/api/translate/yandex', post(['Hello']));
assert.equal(await res.text(), 'Não interceptada');
assert.equal(calls.at(-1).input, '/api/translate/yandex');

// 9. Reconhece origem diferente (nunca intercepta servidor remoto).
_test.settings.enabled = true;
res = await window.fetch('https://example.org/api/translate/yandex', post(['Hello']));
assert.equal(await res.text(), 'Não interceptada');
assert.equal(calls.at(-1).input, 'https://example.org/api/translate/yandex');

// 10. Formato de entradas inválido não dispara request a outro host.
_test.settings.fallbackGoogle = false;
const countBefore = calls.length;
res = await window.fetch('/api/translate/yandex', {method:'POST',body:JSON.stringify({ chunks: [42], lang:'pt' })});
assert.equal(res.status, 502);
assert.equal(calls.length, countBefore);

console.log('10 testes locais concluídos com sucesso.');
