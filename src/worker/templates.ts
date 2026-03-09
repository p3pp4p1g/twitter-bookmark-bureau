export function renderLoginPage(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="/bookmark.png" />
    <title>${title}</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&display=swap");
      :root {
        --paper: #f5ebda;
        --ink: #111111;
        --accent: #b64e34;
        --border: rgba(17, 17, 17, 0.22);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(182, 78, 52, 0.22), transparent 32%),
          linear-gradient(135deg, #f9f1e6 0%, #efe3d0 100%);
        color: var(--ink);
        font-family: "IBM Plex Mono", monospace;
      }
      .sheet {
        width: min(480px, calc(100vw - 2rem));
        border: 1px solid var(--border);
        background: rgba(255, 251, 244, 0.92);
        box-shadow: 0 30px 80px rgba(17, 17, 17, 0.16);
        padding: 2rem;
      }
      h1 {
        font-family: "Fraunces", serif;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 0.95;
        margin: 0 0 1rem;
      }
      p {
        margin: 0 0 1.25rem;
        line-height: 1.6;
      }
      form {
        display: grid;
        gap: 0.75rem;
      }
      input, button {
        width: 100%;
        border: 1px solid var(--border);
        padding: 0.95rem 1rem;
        font: inherit;
      }
      button {
        cursor: pointer;
        background: var(--ink);
        color: var(--paper);
        transition: transform 180ms ease, background 180ms ease;
      }
      button:hover {
        transform: translateY(-1px);
        background: var(--accent);
      }
      .hint { opacity: 0.76; font-size: 0.92rem; }
      .error { min-height: 1.4rem; color: var(--accent); }
    </style>
  </head>
  <body>
    <section class="sheet">
      <p class="hint">private archive</p>
      <h1>${title}</h1>
      <p>Enter the server-side shared key to unlock the bookmark archive. Cloudflare Access can be layered on top later without changing the app.</p>
      <form id="login-form">
        <input id="psk" name="psk" type="password" placeholder="Shared key" autocomplete="current-password" />
        <button type="submit">Unlock archive</button>
        <div id="error" class="error"></div>
      </form>
    </section>
    <script>
      const form = document.getElementById("login-form");
      const error = document.getElementById("error");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        const psk = document.getElementById("psk").value;
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ psk })
        });
        if (!response.ok) {
          error.textContent = "Invalid key";
          return;
        }
        location.reload();
      });
    </script>
  </body>
</html>`;
}

export function renderAppShell(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" href="/bookmark.png" />
    <meta
      name="description"
      content="Private bookmark archive for X/Twitter with LLM-assisted categorization."
    />
    <title>${title}</title>
    <script type="module" crossorigin src="/assets/app.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/app.css" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}
