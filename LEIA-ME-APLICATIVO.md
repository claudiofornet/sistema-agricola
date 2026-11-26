# Sistema Agrícola — aplicativo offline

O aplicativo abre e registra **sem internet**. Registros, fotos (com GPS, data e hora) e conclusão de OS
ficam guardados no celular e são enviados sozinhos quando a conexão volta. Os dados continuam indo para as
mesmas planilhas e para o mesmo Drive.

Funciona sem internet: registrar, fotografar e anotar fotos, cadastros, entrada e saída de gado, ver as OS já baixadas
e concluí-las por "Registrar execução".
Precisa de internet: dashboard, relatórios e administração de OS.

---

## Passo 1: atualizar o Apps Script (servidor)
1. No projeto do Apps Script, substitua todo o **Código.gs** pelo **Code.gs** novo.
2. **Implantar → Gerenciar implantações → lápis → Versão: Nova versão → Implantar**.
3. Copie a **URL do App da Web** (termina em `/exec`). O acesso deve continuar como **Qualquer pessoa**.

O sistema antigo pelo link do Google continua funcionando junto.

## Passo 2: publicar o aplicativo (GitHub Pages, gratuito)
1. Crie uma conta em https://github.com (se não tiver).
2. Clique em **New repository** → nome: `sistema-agricola` → **Public** → **Create repository**.
3. Clique em **uploading an existing file**, arraste **todo o conteúdo da pasta `app`** (index.html, app.js, config.js,
   sw.js, manifest.json, os dois ícones e a pasta `lib`) e clique em **Commit changes**.
4. Vá em **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** / **(root)** → **Save**.
5. Em 1–2 minutos o endereço aparece no topo da página, por exemplo: `https://SEU-USUARIO.github.io/sistema-agricola/`

(Opcional) Para não precisar digitar a URL do servidor em cada celular: antes de enviar, abra `config.js` e cole a URL do
passo 1 no lugar de `COLE_AQUI_A_URL_DO_APP_DA_WEB`.

## Passo 3: instalar em cada celular (com internet, só na primeira vez)
1. Abra o endereço do GitHub Pages no **Chrome** (Android) ou **Safari** (iPhone).
2. Se pedir, cole a URL do servidor (passo 1) e toque em **Salvar e testar**.
3. Faça login. **Cada usuário precisa entrar uma vez com internet naquele aparelho**; depois entra também offline.
4. Instale: Chrome → menu ⋮ → **Instalar app** / **Adicionar à tela inicial**. No iPhone: Compartilhar → **Adicionar à Tela de Início**.
5. Permita **Localização** e **Câmera** quando o aparelho pedir.

## No dia a dia
- A barra verde do topo mostra **Online/Offline** e quantos registros estão **pendentes**. Tocar em "pendentes" mostra a lista.
- Com sinal, o envio é automático (e a cada minuto tenta de novo). Também há o botão **Enviar agora**.
- Se o servidor recusar um registro (ex.: brinco já ativo), ele fica marcado **com erro** e mostra o motivo:
  lance de novo corrigido e descarte o antigo.
- A data/hora gravada na planilha é a do momento do registro no campo. A coluna **Sincronizado em** mostra quando chegou.
- O login vale por **30 dias** sem precisar de internet. Depois disso, o app pede para entrar de novo com conexão;
  os pendentes não se perdem.
- **Não limpe os dados do navegador/aplicativo** com registros pendentes: eles ficam guardados no próprio celular.

## Atualizar o aplicativo no futuro
Envie os arquivos novos para o mesmo repositório e, no arquivo `sw.js`, aumente a versão (`agro-v1` → `agro-v2`).
Os celulares recebem a atualização na próxima vez que abrirem o app com internet.
