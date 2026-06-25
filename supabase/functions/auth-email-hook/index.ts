import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import nodemailer from 'npm:nodemailer@6.9.9';

const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace('v1,whsec_', 'whsec_');
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://patchflow.fr';

const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

const ORANGE = '#ff6b1a', NAVY = '#1d3a5f';

function shell(title: string, intro: string, btnLabel: string, url: string, footnote: string) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="font-family:Outfit,Arial,sans-serif;background:#f4f6fb;margin:0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:${NAVY};padding:28px;text-align:center">
    <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-.5px">PatchFlow</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:4px;letter-spacing:2px;text-transform:uppercase">Par des techniciens, pour des techniciens</div>
  </div>
  <div style="padding:36px 32px">
    <h1 style="font-size:20px;font-weight:700;color:${NAVY};margin:0 0 12px">${title}</h1>
    <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 28px">${intro}</p>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${url}" style="display:inline-block;background:${ORANGE};color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none">${btnLabel}</a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">${footnote}</p>
  </div>
  <div style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:11px;color:#94a3b8;margin:0">© ${new Date().getFullYear()} PatchFlow ·
      <a href="https://patchflow.fr" style="color:${ORANGE};text-decoration:none">patchflow.fr</a> ·
      <a href="mailto:support@patchflow.fr" style="color:${ORANGE};text-decoration:none">support@patchflow.fr</a></p>
  </div>
</div></body></html>`;
}

serve(async (req) => {
  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);

    /* Verify the Standard Webhooks signature from GoTrue */
    let data: any;
    try {
      const wh = new Webhook(HOOK_SECRET);
      data = wh.verify(payload, headers);
    } catch (e) {
      console.error('Signature invalide', e);
      return new Response(JSON.stringify({ error: { http_code: 401, message: 'Signature invalide' } }), { status: 401 });
    }

    const user = data.user;
    const ed = data.email_data;
    const type = ed.email_action_type; // signup | recovery | magiclink | email_change | invite

    /* Diagnostic (sans secret) : type réel envoyé par GoTrue + email + préfixe du
       token_hash → permet de voir quel template est choisi et de détecter les
       renvois (même token_hash = retry GoTrue, token_hash différent = 2 demandes). */
    console.log('[auth-email-hook]', JSON.stringify({
      type,
      email: user && user.email,
      token_hash: String(ed.token_hash || '').slice(0, 8),
    }));

    /* Validate redirect_to to prevent open-redirect phishing attacks */
    const rawRedirect = ed.redirect_to || '';
    const safeRedirect = rawRedirect.startsWith(SITE_URL)
      ? rawRedirect
      : SITE_URL + '/app.html';

    const verifyUrl =
      `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify` +
      `?token=${ed.token_hash}&type=${type}` +
      `&redirect_to=${encodeURIComponent(safeRedirect)}`;

    let subject: string, html: string;
    switch (type) {
      case 'recovery':
        subject = 'Réinitialisez votre mot de passe — PatchFlow';
        html = shell('Réinitialisation du mot de passe',
          'Vous avez demandé à réinitialiser votre mot de passe. Cliquez ci-dessous pour en choisir un nouveau.',
          'Choisir un nouveau mot de passe', verifyUrl,
          'Ce lien expire dans 1 heure. Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet email.');
        break;
      case 'magiclink':
        subject = 'Votre lien de connexion — PatchFlow';
        html = shell('Connexion à PatchFlow',
          'Cliquez sur le bouton ci-dessous pour vous connecter à votre compte.',
          'Me connecter', verifyUrl, 'Ce lien expire dans 1 heure.');
        break;
      case 'email_change':
        subject = 'Confirmez votre nouvelle adresse — PatchFlow';
        html = shell('Changement d\'adresse email',
          'Confirmez votre nouvelle adresse email en cliquant ci-dessous.',
          'Confirmer mon adresse', verifyUrl, 'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet email.');
        break;
      case 'invite': {
        const meta = user.user_metadata || {};
        // Valeurs venant de user_metadata (posées par le propriétaire) → échapper le HTML
        const esc = (s: string) => String(s ?? '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const inviterRaw  = meta.inviter   || 'Un technicien';
        const showNameRaw = meta.show_name || 'un show';
        const inviter   = esc(inviterRaw);
        const showName  = esc(showNameRaw);
        subject = `${inviterRaw} vous invite sur PatchFlow — "${showNameRaw}"`;
        html = shell(`${inviter} vous invite sur PatchFlow 🎧`,
          `<strong>${inviter}</strong> vous invite à rejoindre le show <strong>${showName}</strong> sur PatchFlow.<br/><br/>Créez votre compte en cliquant ci-dessous pour accéder au show directement.`,
          'Créer mon compte', verifyUrl, 'Ce lien expire dans 24 heures. Si vous ne connaissez pas cet utilisateur, ignorez cet email.');
        break;
      }
      default: // signup
        subject = 'Confirmez votre adresse email — PatchFlow';
        html = shell('Bienvenue sur PatchFlow 🎧',
          'Merci de vous être inscrit ! Une dernière étape : confirmez votre adresse email en cliquant ci-dessous.',
          'Confirmer mon adresse email', verifyUrl,
          'Ce lien expire dans 24 heures. Si vous n\'avez pas créé de compte, ignorez cet email.');
    }

    await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to: user.email, subject, html });
    return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('Hook error', e);
    return new Response(JSON.stringify({ error: { http_code: 500, message: String(e?.message || e) } }), { status: 500 });
  }
});
