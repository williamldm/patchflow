/* Gabarit commun des e-mails PatchFlow.
   Mise en page en tableaux et styles en ligne : c'est ce que Gmail, Outlook et Apple Mail rendent
   de la même façon. Chaque e-mail part avec sa version texte (meilleure délivrabilité, lecteurs
   d'écran, montres). Les valeurs venant des utilisateurs passent par esc() avant d'arriver ici. */

export const SITE = (Deno.env.get('SITE_URL') ?? 'https://patchflow.fr').replace(/\/+$/, '');
const LOGO = 'https://patchflow.fr/img/email-logo.png';
const SUPPORT = 'support@patchflow.fr';

const C = {
  bg: '#f2f4f7', card: '#ffffff', line: '#e4e7ec', ink: '#101828', body: '#344054', mute: '#667085', faint: '#98a2b3',
  brand: '#e8590c', brandSoft: '#fff4ed',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ── Blocs ── */
export const p = (html: string) => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body}">${html}</p>`;

const TONES = {
  info:   { bg: '#f0f6ff', bd: '#b2ccff', ink: '#1849a9' },
  warn:   { bg: '#fffaeb', bd: '#fedf89', ink: '#93370d' },
  danger: { bg: '#fef3f2', bd: '#fecdca', ink: '#b42318' },
  ok:     { bg: '#ecfdf3', bd: '#abefc6', ink: '#067647' },
};
export function callout(tone: keyof typeof TONES, title: string, html = '') {
  const t = TONES[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-collapse:separate">
<tr><td style="background:${t.bg};border:1px solid ${t.bd};border-radius:8px;padding:14px 16px;font-family:${FONT}">
<p style="margin:0;font-size:14px;line-height:20px;font-weight:600;color:${t.ink}">${title}</p>${html ? `<p style="margin:6px 0 0;font-size:14px;line-height:21px;color:${t.ink}">${html}</p>` : ''}
</td></tr></table>`;
}
/* Tableau libellé / valeur (show, rôle, date…) */
export function details(rows: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid ${C.line};border-radius:8px;border-collapse:separate">
${rows.map(([k, v], i) => `<tr><td style="padding:11px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:13px;line-height:20px;color:${C.mute};width:38%;vertical-align:top">${k}</td>
<td style="padding:11px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink};font-weight:600;vertical-align:top">${v}</td></tr>`).join('')}
</table>`;
}
/* Texte cité (message d'un utilisateur) : déjà échappé, les retours à la ligne sont gardés */
export function quote(label: string, html: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px">
<tr><td style="border-left:3px solid ${C.brand};background:#f9fafb;padding:12px 16px;font-family:${FONT}">
<p style="margin:0 0 6px;font-size:12px;line-height:16px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.mute}">${label}</p>
<p style="margin:0;font-size:14px;line-height:22px;color:${C.body};white-space:pre-wrap">${html}</p></td></tr></table>`;
}
export function list(items: string[]) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">${items.map((it) =>
    `<tr><td style="padding:0 10px 8px 2px;vertical-align:top;font-family:${FONT};font-size:15px;line-height:24px;color:${C.brand}">&#8226;</td>
<td style="padding:0 0 8px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body}">${it}</td></tr>`).join('')}</table>`;
}

/* ── Version texte, tirée du HTML ── */
function toText(html: string) {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, u, t) => { const l = t.replace(/<[^>]+>/g, '').trim(); return l && l !== u ? `${l} (${u})` : u; })
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h1)>/gi, "\n\n").replace(/<\/(tr|li)>/gi, "\n").replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '').replace(/&#8226;/g, '-').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface EmailOpts {
  preheader: string;           /* aperçu affiché dans la boîte de réception, après l'objet */
  title: string;               /* déjà échappé */
  body: string;                /* blocs ci-dessus */
  cta?: { label: string; url: string };
  fallback?: boolean;          /* lien en clair sous le bouton (liens de connexion, invitations) */
  note?: string;               /* petite ligne sous le bouton : expiration, « ignorez cet e-mail »… */
  reason?: string;             /* pourquoi on reçoit cet e-mail */
  tag?: string;                /* petite étiquette au-dessus du titre : Sécurité, Support, Abonnement… */
}

export function renderEmail(o: EmailOpts): { html: string; text: string } {
  const year = new Date().getFullYear();
  const cta = o.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 ${o.fallback || o.note ? '16px' : '4px'}">
<tr><td style="border-radius:8px;background:${C.brand}" bgcolor="${C.brand}">
<a href="${o.cta.url}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${o.cta.label}</a>
</td></tr></table>` : '';
  const fb = o.cta && o.fallback ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.mute}">Le bouton ne s'ouvre pas&nbsp;? Copiez ce lien dans votre navigateur&nbsp;:<br/>
<a href="${o.cta.url}" style="color:${C.brand};text-decoration:underline;word-break:break-all">${o.cta.url}</a></p>` : '';
  const note = o.note ? `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.mute}">${o.note}</p>` : '';
  const tag = o.tag ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.brand}">${o.tag}</p>` : '';

  const html = `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/>
<meta name="x-apple-disable-message-reformatting"/><title>${o.title}</title>
<style>@media (max-width:600px){.pf-pad{padding-left:24px!important;padding-right:24px!important}.pf-h1{font-size:21px!important;line-height:28px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${o.preheader}${'&#8199;&#65279;&#847; '.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}" bgcolor="${C.bg}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 20px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;padding-right:10px"><img src="${LOGO}" width="32" height="32" alt="" style="display:block;border:0;border-radius:7px"/></td>
      <td style="vertical-align:middle;font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:${C.ink};letter-spacing:-.01em">PatchFlow</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${C.card};border:1px solid ${C.line};border-top:3px solid ${C.brand};border-radius:12px" bgcolor="${C.card}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pf-pad" style="padding:36px 40px 32px">
      ${tag}<h1 class="pf-h1" style="margin:0 0 16px;font-family:${FONT};font-size:23px;line-height:30px;font-weight:700;color:${C.ink};letter-spacing:-.01em">${o.title}</h1>
      ${o.body}${cta}${fb}${note}
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:24px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.faint}">
    ${o.reason ? `<p style="margin:0 0 10px">${o.reason}</p>` : ''}
    <p style="margin:0 0 10px">Une question&nbsp;? Écrivez à <a href="mailto:${SUPPORT}" style="color:${C.mute};text-decoration:underline">${SUPPORT}</a>.</p>
    <p style="margin:0">PatchFlow · préparation technique son et scène ·
      <a href="${SITE}" style="color:${C.mute};text-decoration:underline">patchflow.fr</a> ·
      <a href="${SITE}/confidentialite.html" style="color:${C.mute};text-decoration:underline">Confidentialité</a> · © ${year}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    'PatchFlow', '',
    toText(o.title), '',
    toText(o.body),
    o.cta ? `${o.cta.label} : ${o.cta.url}` : '',
    o.note ? toText(o.note) : '',
    '', '—',
    o.reason ? toText(o.reason) : '',
    `Une question ? ${SUPPORT}`,
    `PatchFlow · ${SITE}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();

  return { html, text };
}
