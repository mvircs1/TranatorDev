# TT Yandex Bridge v0.1.2 (experimental) — TauriTavern / SillyTavern

Uma extensão **somente de frontend** que tenta contornar a mensagem
`Unsupported translate provider: yandex` vista em versões do TauriTavern.

## Novidade da v0.1.2 — modo clássico (qualidade narrativa)

Verificamos no `src/endpoints/translate.js` oficial do SillyTavern que os
blocos do mesmo texto são enviados juntos em **uma única requisição** como
campos repetidos `text`. Nas versões anteriores do TT Yandex Bridge, cada
bloco disparava uma requisição isolada. Isso pode reduzir a continuidade em
histórias extensas, embora não haja garantia de melhora em todos os casos.

- **Modo clássico do SillyTavern (enviar trechos juntos)** vem **ativado**.
- Desative temporariamente para comparar com o comportamento da v0.1.1.
- Quando ativado, o modo também reproduz a combinação `json.text.join()` do
  servidor original (que usa vírgulas como separador, inclusive entre blocos).
- Ainda há diferenças: o original faz a chamada pelo servidor Node.js e a
  extensão faz a chamada pelo navegador Android/WebView. Não é possível
  garantir que o Yandex retorne sempre o mesmo texto.
- Se o Google fallback estiver ativo, confira no status qual provedor foi
  realmente utilizado antes de comparar a qualidade.
- Traduções já gravadas no chat não mudam sozinhas; traduza a mensagem de novo.

## Correção da versão 0.1.1 — português brasileiro

Na v0.1.0, a função `normalizeLang()` convertia **`pt-BR` em `pt`** e, assim, perdia a preferência pelo português brasileiro. Desde a v0.1.1, o plugin envia **`pt-BR`** quando você seleciona Português (Brasil) ou português genérico, com a opção **Forçar português brasileiro (pt-BR)** ativada por padrão.

- Para traduzir as respostas para português brasileiro, mantenha essa opção ativada.
- Traduções de entrada para inglês (`en`) não são alteradas.
- O painel mostra qual código de idioma foi enviado ao Yandex.
- Desativar a opção volta a solicitar `pt` genérico, útil caso o endpoint não oficial rejeite `pt-BR`.

**Importante:** Yandex Cloud documenta `pt-BR`, mas o endpoint *não oficial* usado por esta extensão não possui contrato público confirmando o comportamento regional. Portanto, essa correção garante o **pedido explícito de pt-BR**, mas não pode garantir que o texto devolvido sempre use vocabulário brasileiro. Se a API rejeitar `pt-BR`, a extensão exibirá o erro (ou usará Google somente se o fallback estiver ativado).

## O que faz

- Intercepta **apenas** requisições `POST /api/translate/yandex` feitas pelo **Chat Translation** integrado.
- Tenta fazer a requisição diretamente à interface de tradução utilizada pelo SillyTavern original (`translate.yandex.net`).
- Mantém o Chat Translation original encarregado da tradução automática/manual de entradas, respostas e do histórico.
- Oferece fallback opcional via a rota Google, que já funciona no seu aparelho. **Fallback DESATIVADO por padrão**, para não fingir que Google é Yandex.
- Exibe a origem da última tradução e um teste rápido.
- Não usa sua API de IA nem altera chaves ou configurações de personagens.

## Limitação importante

A API usada pelo SillyTavern original é um endpoint **não oficial** do Yandex.
O SillyTavern original o consulta **no servidor**. No Android, este plugin só
pode consultar a API do Yandex pelo WebView, que pode **bloquear CORS**.
Uma extensão de frontend não consegue remover essa restrição, nem implementar
uma rota Rust ausente. Portanto **o Yandex não tem funcionamento garantido**.
Se o teste indicar CORS, a correção real exige suporte nativo no TauriTavern,
ou um proxy próprio autorizado, ou usar outro tradutor. Não recomendamos proxies
públicos para textos de conversas privadas.

## Instalação

### Se tiver acesso ao diretório de extensões (instalação manual)

Copie `manifest.json`, `index.js` e `style.css` para uma pasta chamada
`TT-Yandex-Bridge` no diretório de extensões do seu usuário (`data/default-user/extensions/`)
ou na pasta global `data/extensions/third-party/` (conforme sua instalação).
Reabra o aplicativo e ative a extensão. **No Android, essas pastas podem estar
inacessíveis sem ferramentas especiais**.

### Pelo menu **Install Extension** (mais indicado no Android)

O instalador de extensões exige **uma URL de repositório Git**, não um arquivo ZIP.
Crie um repositório GitHub próprio, carregue os três arquivos na **raiz** do
repositório e cole sua URL em **Extensions > Install Extension**. Exemplo
`https://github.com/SEU-USUARIO/TT-Yandex-Bridge` (este é só um exemplo,
**não é um link existente**). Aguarde a instalação e recarregue.

Se você já publicou a versão 0.1.0 no GitHub, **substitua os arquivos** no mesmo repositório (não crie uma segunda extensão), depois use **Update Extension** ou reinstale/atualize no TauriTavern e recarregue.

O ZIP desta entrega é **código-fonte pronto para publicar**, não um APK e não
pode ser colado diretamente no campo **Install Extension**.

## Configuração

1. Em **Extensions > Chat Translation**, selecione **Yandex** como provedor.
2. Escolha **Portuguese** ou **Portuguese (Brazil)** como idioma de destino.
3. Em **Auto-mode**, escolha *Translate responses* ou *Translate both*.
4. Em **Extensions > TT Yandex Bridge**, mantenha a extensão ativada.
5. Mantenha **Forçar português brasileiro (pt-BR)** ativado.
6. Pressione **Testar tradução**. Veja o status:
    - `Yandex direto`: a API Yandex foi utilizada;
    - `Google (fallback)`: o Yandex falhou, mas Google foi utilizado, **somente** se você ativou a opção;
    - erro `CORS/rede`: Android bloqueou a chamada ou o serviço recusou.

Ao desativar a extensão pelo gerenciador, recarregue a aplicação para que a
interceptação seja totalmente removida da sessão.

## Privacidade

Texto enviado ao Yandex é transmitido à infraestrutura do Yandex. Se você
habilitar o fallback Google, o texto pode ser enviado ao Google. Não são
criados logs remotos nem coletadas chaves. A configuração de fallback fica no
`localStorage` do aplicativo. Nenhuma chamada é enviada a proxies de terceiros.

## Compatibilidade e testes

- Desenvolvido a partir das rotas e do formato de requisição documentado no
  código oficial SillyTavern (branch `release`, consultada em novembro de 2026).
- **Teste automatizado local** cobre interceptação, roteamento, códigos de idioma pt-BR/pt/en, modo clássico com múltiplos trechos, modo por trecho, Yandex direto simulado, erro e fallback Google simulado.
- **Não testado em um dispositivo Android/TauriTavern real**.

Referências de API:
- https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/translate/index.js
- https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/translate.js
- https://docs.sillytavern.app/for-contributors/writing-extensions/
- https://github.com/Darkatse/TauriTavern/blob/main/ExtensionDEV.md

- https://aistudio.yandex.ru/en/docs/translate/concepts/supported-languages
