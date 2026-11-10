/*
 * TT Yandex Bridge v0.1.2
 * Interface-only extension. No Rust / Node.js server plugins.
 *
 * Intercepts ONLY POST /api/translate/yandex requests made by SillyTavern's
 * built-in Chat Translation feature. Attempts a direct browser request to
 * Yandex's unofficial endpoint; optionally uses the EXISTING Google route if
 * direct access fails. The Google fallback is OFF by default.
 *
 * WARNING: The Yandex endpoint is unofficial and may prohibit cross-origin
 * requests. A frontend extension cannot bypass the Android WebView's CORS.
 */

const KEY = 'tt-yandex-bridge-settings-v1';
const DEFAULTS = Object.freeze({ enabled: true, fallbackGoogle: false, notifyFallback: true, brazilianPortuguese: true, classicBatch: true });
const YANDEX_URL = 'https://translate.yandex.net/api/v1/tr.json/translate';
const EXTENSION_TAG = '[TT Yandex Bridge]';

function loadSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
        return {
            enabled: raw.enabled !== false,
            fallbackGoogle: raw.fallbackGoogle === true,
            notifyFallback: raw.notifyFallback !== false,
            brazilianPortuguese: raw.brazilianPortuguese !== false,
            classicBatch: raw.classicBatch !== false,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

const settings = loadSettings();
let statusInfo = 'Pronto. Selecione Yandex em Chat Translation.';
let hasIntercepted = false;
let originalFetch;

function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); }
    catch (error) { console.warn(EXTENSION_TAG, 'Não foi possível salvar configurações:', error); }
}

function status(message, level = 'info') {
    statusInfo = message;
    console[level]?.(EXTENSION_TAG, message);
    const node = document.getElementById('ttyb_status');
    if (node) {
        node.textContent = message;
        node.dataset.level = level;
    }
}

function alertUser(message, type = 'warning') {
    const toast = window.toastr;
    if (toast && typeof toast[type] === 'function') {
        toast[type](message, 'TT Yandex Bridge');
    } else {
        console.warn(EXTENSION_TAG, message);
    }
}

function normalizeLang(lang) {
    const code = String(lang || '').trim();
    if (!code) throw new Error('Idioma de destino não informado.');
    const lower = code.toLowerCase();
    // The original extension mapped pt-BR -> pt, losing the Brazilian locale.
    // Preserve/force Brazilian Portuguese for output while leaving e.g. en alone.
    if (lower === 'pt' || lower === 'pt-br' || lower === 'pt_br') {
        return settings.brazilianPortuguese ? 'pt-BR' : 'pt';
    }
    // Yandex generic Portuguese may be used when European Portuguese was chosen.
    if (lower === 'pt-pt' || lower === 'pt_pt') return 'pt';
    if (lower === 'zh-cn' || lower === 'zh-tw') return 'zh';
    return code;
}

function makeId() {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
    const random = new Uint8Array(16);
    crypto.getRandomValues(random);
    return Array.from(random, x => x.toString(16).padStart(2, '0')).join('');
}

function extractPath(input) {
    try {
        const url = input instanceof Request ? input.url : String(input);
        const parsed = new URL(url, window.location?.href || 'https://localhost/');
        // Never hijack requests to a different origin.
        if (parsed.origin !== window.location.origin) return '';
        return parsed.pathname.replace(/\/+$/, '');
    } catch { return ''; }
}

async function decodeBody(input, init) {
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof body !== 'string') throw new Error('Corpo da requisição inválido.');
    let payload;
    try { payload = JSON.parse(body); }
    catch { throw new Error('O corpo enviado pelo Chat Translation não é JSON válido.'); }
    if (!Array.isArray(payload.chunks) || !payload.chunks.every(x => typeof x === 'string') || payload.chunks.length > 200) {
        throw new Error('Lista de trechos do Chat Translation inválida.');
    }
    if (payload.chunks.some(x => x.length > 5000)) {
        throw new Error('Cada trecho deve ter no máximo 5.000 caracteres.');
    }
    const lang = normalizeLang(payload.lang);
    return { chunks: payload.chunks, lang };
}

// Deliberately uses the captured fetch, avoiding infinite recursion through
// the interceptor. This does not bypass CORS / WebView restrictions.
// The original SillyTavern sends ALL 5000-character chunks as repeated
// `text` form fields in ONE POST. Sending each chunk in a separate request
// (as v0.1.1 did) can change available translation context.
// Legacy mode is the default. The previous per-chunk mode remains an A/B option.
async function fetchYandexOnce(chunks, lang) {
    const url = `${YANDEX_URL}?ucid=${makeId()}&srv=android&format=text`;
    const form = new URLSearchParams();
    for (const chunk of chunks) form.append('text', chunk);
    form.append('lang', lang);
    let response;
    try {
        response = await originalFetch(url, {
            method: 'POST',
            body: form,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            mode: 'cors',
        });
    } catch (error) {
        throw new Error(`Acesso direto ao Yandex bloqueado ou indisponível (possível CORS/rede): ${error?.message || error}`);
    }
    if (!response.ok) throw new Error(`Yandex respondeu HTTP ${response.status} ${response.statusText || ''}`.trim());
    let json;
    try { json = await response.json(); }
    catch { throw new Error('Yandex retornou uma resposta que não é JSON válido.'); }
    if (!Array.isArray(json?.text)) throw new Error('Resposta do Yandex sem o campo text esperado.');
    return json.text;
}

async function directYandex(chunks, lang) {
    if (!chunks.some(Boolean)) return '';
    if (settings.classicBatch) {
        // Matches upstream src/endpoints/translate.js: json.text.join()
        // (comma is intentional; the upstream route uses the same join).
        const outputs = await fetchYandexOnce(chunks, lang);
        return outputs.join();
    }
    const outputs = [];
    for (const chunk of chunks) {
        if (!chunk) { outputs.push(''); continue; }
        const translations = await fetchYandexOnce([chunk], lang);
        outputs.push(translations.join(''));
    }
    return outputs.join('');
}

async function googleFallback(chunks, lang, init) {
    const result = [];
    for (const chunk of chunks) {
        if (!chunk) { result.push(''); continue; }
        const headers = new Headers(init?.headers || {});
        headers.set('Content-Type', 'application/json');
        const response = await originalFetch('/api/translate/google', {
            method: 'POST',
            headers,
            body: JSON.stringify({ text: chunk, lang }),
        });
        if (!response.ok) {
            throw new Error(`Google respondeu HTTP ${response.status} ${response.statusText || ''}`.trim());
        }
        result.push(await response.text());
    }
    return result.join('');
}

async function translateYandex(input, init) {
    try {
        const { chunks, lang } = await decodeBody(input, init);
        status('Consultando o Yandex diretamente…');
        const translated = await directYandex(chunks, lang);
        status(`Última tradução: Yandex direto (${settings.classicBatch ? 'modo clássico, trechos juntos' : 'modo anterior, trechos separados'}; idioma: ${lang}; sem fallback).`);
        return new Response(translated, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (error) {
        const reason = String(error?.message || error);
        if (settings.fallbackGoogle) {
            try {
                const { chunks, lang } = await decodeBody(input, init);
                const translated = await googleFallback(chunks, lang, init);
                status(`Última tradução: Google (fallback, idioma: ${lang}). Yandex falhou: ${reason}`, 'warn');
                if (settings.notifyFallback) alertUser('Yandex indisponível: esta tradução usou Google, conforme sua configuração.', 'info');
                return new Response(translated, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            } catch (googleError) {
                const msg = `Yandex falhou: ${reason}. Fallback Google falhou: ${googleError?.message || googleError}`;
                status(msg, 'error');
                return new Response(msg, { status: 502, statusText: 'Falha na tradução', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
        }
        const msg = `Yandex não disponível: ${reason}. Ative fallback Google na extensão se desejar.`;
        status(msg, 'error');
        return new Response(msg, { status: 502, statusText: 'Falha no Yandex', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
}

function installFetchPatch() {
    if (window.fetch?.__ttybPatched) return;
    if (typeof window.fetch !== 'function') {
        status('Este aplicativo não disponibiliza fetch; extensão não iniciada.', 'error');
        return;
    }
    originalFetch = window.fetch.bind(window);
    const patched = function ttybFetch(input, init) {
        if (!settings.enabled) return originalFetch(input, init);
        if (extractPath(input) !== '/api/translate/yandex') return originalFetch(input, init);
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'POST') return originalFetch(input, init);
        return translateYandex(input, init);
    };
    Object.defineProperty(patched, '__ttybPatched', { value: true });
    window.fetch = patched;
    hasIntercepted = true;
    status('Extensão ativa. Selecione Yandex nas configurações do Chat Translation.');
}

function control(labelText, id, checked) {
    const label = document.createElement('label');
    label.className = 'ttyb-switch';
    const checkbox = document.createElement('input');
    checkbox.id = id;
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(checkbox, span);
    return label;
}

function installPanel() {
    if (document.getElementById('ttyb_panel')) return;
    const parent = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (!parent) {
        console.warn(EXTENSION_TAG, 'Painel de extensões não encontrado; interceptação de fetch permanece disponível.');
        return;
    }
    const panel = document.createElement('section');
    panel.id = 'ttyb_panel';
    panel.className = 'inline-drawer';
    const heading = document.createElement('h3');
    heading.textContent = 'TT Yandex Bridge';
    panel.append(heading);

    panel.append(control('Ativar correção do Yandex', 'ttyb_enabled', settings.enabled));
    panel.append(control('Forçar português brasileiro (pt-BR)', 'ttyb_ptbr', settings.brazilianPortuguese));
    panel.append(control('Modo clássico do SillyTavern (enviar trechos juntos)', 'ttyb_classic', settings.classicBatch));
    panel.append(control('Usar Google se o Yandex falhar', 'ttyb_fallback', settings.fallbackGoogle));
    panel.append(control('Avisar quando usar Google', 'ttyb_notify', settings.notifyFallback));

    const note = document.createElement('p');
    note.className = 'ttyb-note';
    note.textContent = 'Modo clássico reproduz o agrupamento de trechos e o formato de saída do SillyTavern. Desative apenas para comparar com a versão 0.1.1. pt-BR pode não ser respeitado pelo endpoint não oficial. O fallback Google é opcional.';
    panel.append(note);

    const action = document.createElement('button');
    action.type = 'button';
    action.id = 'ttyb_test';
    action.className = 'menu_button';
    action.textContent = 'Testar tradução (Hello → pt-BR)';
    panel.append(action);
    const state = document.createElement('p');
    state.id = 'ttyb_status';
    state.className = 'ttyb-status';
    state.textContent = statusInfo;
    panel.append(state);
    parent.append(panel);

    for (const [element, key] of [['ttyb_enabled', 'enabled'], ['ttyb_ptbr', 'brazilianPortuguese'], ['ttyb_classic', 'classicBatch'], ['ttyb_fallback', 'fallbackGoogle'], ['ttyb_notify', 'notifyFallback']]) {
        document.getElementById(element).addEventListener('change', (event) => {
            settings[key] = Boolean(event.target.checked);
            saveSettings();
            status(`Configurações salvas. Extensão ${settings.enabled ? 'ativa' : 'desativada'}.`);
        });
    }

    action.addEventListener('click', async () => {
        action.disabled = true;
        try {
            // This exercises the SAME route as the built-in Chat Translation.
            const resp = await window.fetch('/api/translate/yandex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chunks: ['Hello, how are you?'], lang: 'pt-BR' }),
            });
            if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
            const translated = await resp.text();
            alertUser(`Tradução obtida: ${translated}`, 'success');
        } catch (err) {
            alertUser(`Teste falhou: ${err?.message || err}`, 'error');
        } finally { action.disabled = false; }
    });
}

function start() {
    if (hasIntercepted) return;
    installFetchPatch();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installPanel, { once: true });
    } else {
        installPanel();
    }
}

start();

// Testing hook; not part of the public API and not used in production.
export const _test = { normalizeLang, extractPath, decodeBody, directYandex, googleFallback, translateYandex, settings };
