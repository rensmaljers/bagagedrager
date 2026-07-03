// Losse module zodat App.svelte zelf geen `import(` bevat: rolldown's
// dynamic-import-vars-plugin parseert .svelte-bestanden met `import(` als JS
// (vóór de Svelte-transform) en crasht dan op de HTML.
export const loadAdmin = () => import('./Admin.svelte');
