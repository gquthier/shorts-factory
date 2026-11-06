// All network access. Every call resolves with `data` or throws an Error with a French message.

async function parse(r) {
  let j;
  try { j = await r.json(); } catch { throw new Error(`Réponse illisible (${r.status})`); }
  if (!j.success) throw new Error(j.error || `Erreur ${r.status}`);
  return j.data;
}

async function call(method, path, body) {
  let r;
  try {
    r = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error('Serveur injoignable'); }
  return parse(r);
}

export const get = (path) => call('GET', path);
export const post = (path, body = {}) => call('POST', path, body);
export const del = (path) => call('DELETE', path);

export function upload(file, { kind, title }, onProgress) {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ kind, rights: '1', name: file.name });
    if (title) q.set('title', title);
    const x = new XMLHttpRequest();
    x.open('POST', `/api/upload?${q}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      try {
        const j = JSON.parse(x.responseText);
        if (j.success) resolve(j.data); else reject(new Error(j.error || 'Envoi refusé'));
      } catch { reject(new Error(`Réponse illisible (${x.status})`)); }
    };
    x.onerror = () => reject(new Error("L'envoi a échoué, réessaie."));
    x.send(file);
  });
}
