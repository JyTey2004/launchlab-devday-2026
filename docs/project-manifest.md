# Static project contract — v0.1

Put `launchlab.json` in the root of the repository:

```json
{
  "name": "My agent experiment",
  "description": "A small product question for testers to explore.",
  "adapter": "static",
  "entry": "index.html",
  "files": ["index.html", "app.js", "style.css"],
  "chainId": 1952
}
```

`name` is 1–80 characters; `description` is at most 400. `adapter` must be `static`; entry must be `index.html`; chain ID must be X Layer testnet 1952. The current version rejects additional fields.

List every asset the preview needs. Filenames use letters, digits, underscore or hyphen, with optional subdirectories, and one of `.html`, `.css`, `.js`, `.json`, `.svg`, `.txt`. Traversal, symlinks and dotfiles are unsupported. Filenames are case-sensitive. Use relative resource URLs, external CSS and external classic scripts. Inline scripts/styles, network calls, wallet interactions, module imports requiring CORS and same-origin storage are blocked by this prototype's sandbox policy.

This deliberately narrow adapter is for static usability experiments. A future wallet-enabled preview adapter must introduce an explicit network policy and a separately scoped wallet. Declaring `chainId` is configuration metadata; it does not prove a contract was deployed or that the RPC works.

On GitHub import, the selected branch/tag is resolved once to a 40-character commit SHA. Every file request uses that SHA. Before deployment the content digest must match the imported digest. A new version requires a new import. The bundled example has a content digest and no claimed Git commit.
