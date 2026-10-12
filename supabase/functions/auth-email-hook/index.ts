import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import nodemailer from 'npm:nodemailer@6.9.9';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderEmail, p, callout, details, esc } from '../_shared/email.ts';

const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace('v1,whsec_', 'whsec_');
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://patchflow.fr';

const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  /* Certificat vérifié (Let's Encrypt, valide pour mail.patchflow.fr et
     patchflow.fr) : sans vérification, une interception pouvait récupérer
     le mot de passe SMTP et le contenu des emails (liens de connexion…). */
  tls: { minVersion: 'TLSv1.2' },
});


/* Journal des envois (table email_log, lue par l'onglet E-mails de l'administration). Jamais le corps,
   jamais de lien : le type, le destinataire masqué, l'objet et le résultat. Sans effet si la table manque. */
async function logEmail(source: string, kind: string, to: string, subject: string, err?: unknown) {
  try {
    const at = to.indexOf('@');
    const masked = at > 1 ? to[0] + '***' + to.slice(at) : '***' + to.slice(Math.max(at, 0));
    await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      .from('email_log').insert({
        source, kind: String(kind || 'inconnu').slice(0, 60), to_masked: masked, subject: String(subject || '').slice(0, 160),
        status: err ? 'failed' : 'sent', error: err ? String((err as Error)?.message ?? err).slice(0, 300) : null,
      });
  } catch { /* le journal ne doit jamais empêcher un envoi */ }
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
    const type = ed.email_action_type; // signup | recovery | magiclink | email | email_change | invite | reauthentication | *_notification

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
    /* Origine EXACTE : startsWith(SITE_URL) laissait passer
       « https://patchflow.fr.site-pirate.com » (redirection ouverte). */
    let safeRedirect = SITE_URL + '/app.html';
    try {
      if (rawRedirect && new URL(rawRedirect).origin === new URL(SITE_URL).origin) safeRedirect = rawRedirect;
    } catch (_) { /* URL invalide → page par défaut */ }

    const verifyUrl =
      `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify` +
      `?token=${encodeURIComponent(ed.token_hash)}&type=${encodeURIComponent(type)}` +
      `&redirect_to=${encodeURIComponent(safeRedirect)}`;

    /* Avis de sécurité (réglage « Security notifications » de Supabase) : l'événement a déjà eu lieu,
       il n'y a ni lien à confirmer ni jeton. Avant, ces types tombaient dans le cas « signup » et
       l'utilisateur recevait « Confirmez votre adresse » (avec un lien mort) après avoir changé son mot de passe. */
    const when = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });
    const secureUrl = SITE_URL + '/app.html?forgot=1';
    const account = esc(user.email);
    const SEC_REASON = 'Cet avis de sécurité est envoyé à chaque modification importante de votre compte PatchFlow. Il ne peut pas être désactivé.';
    const NOTICES: Record<string, [string, string, string]> = {
      password_changed_notification: ['Votre mot de passe PatchFlow a été modifié', 'Mot de passe modifié', 'Le mot de passe de votre compte vient d\'être modifié.'],
      email_changed_notification: ['L\'adresse e-mail de votre compte PatchFlow a été modifiée', 'Adresse e-mail modifiée', 'L\'adresse e-mail de votre compte vient d\'être modifiée.'],
      phone_changed_notification: ['Le numéro de téléphone de votre compte PatchFlow a été modifié', 'Numéro de téléphone modifié', 'Le numéro de téléphone de votre compte vient d\'être modifié.'],
      identity_linked_notification: ['Un moyen de connexion a été ajouté à votre compte PatchFlow', 'Moyen de connexion ajouté', 'Un nouveau moyen de connexion (Google par exemple) vient d\'être ajouté à votre compte.'],
      identity_unlinked_notification: ['Un moyen de connexion a été retiré de votre compte PatchFlow', 'Moyen de connexion retiré', 'Un moyen de connexion vient d\'être retiré de votre compte.'],
    };

    let subject: string, mail: { html: string; text: string };
    if (typeof type === 'string' && type.endsWith('_notification')) {
      const n = NOTICES[type] ?? ['Modification de sécurité sur votre compte PatchFlow', 'Modification de votre compte', 'Une modification de sécurité vient d\'être apportée à votre compte.'];
      subject = n[0];
      mail = renderEmail({
        tag: 'Sécurité', title: n[1], preheader: `${n[2]} Ce n'était pas vous ? Sécurisez votre compte.`,
        body: p(n[2]) + details([['Compte', account], ['Date', esc(when) + ' (heure de Paris)']]) +
          callout('warn', 'Ce n\'était pas vous ?', 'Choisissez un nouveau mot de passe tout de suite, puis écrivez-nous à support@patchflow.fr pour que nous vérifiions votre compte.'),
        cta: { label: 'Sécuriser mon compte', url: secureUrl },
        note: 'Si vous êtes à l\'origine de cette modification, vous n\'avez rien à faire.',
        reason: SEC_REASON,
      });
      try { await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to: user.email, subject, ...mail }); }
      catch (e) { await logEmail('auth-email-hook', type, user.email, subject, e); throw e; }
      await logEmail('auth-email-hook', type, user.email, subject);
      return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
    }
    const ACCOUNT_REASON = `Cet e-mail a été envoyé à ${account} à la suite d'une demande faite sur patchflow.fr.`;
    switch (type) {
      case 'recovery':
        subject = 'Réinitialisez votre mot de passe PatchFlow';
        mail = renderEmail({
          tag: 'Sécurité', title: 'Choisissez un nouveau mot de passe', preheader: 'Votre lien de réinitialisation est valable 1 heure.',
          body: p(`Une demande de réinitialisation du mot de passe a été faite pour le compte <strong style="color:#101828">${account}</strong>.`) +
            p('Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Le lien ne sert qu\'une fois.'),
          cta: { label: 'Choisir un nouveau mot de passe', url: verifyUrl }, fallback: true,
          note: 'Ce lien expire dans 1 heure. Vous n\'avez rien demandé ? Ignorez cet e-mail : votre mot de passe actuel reste valable.',
          reason: ACCOUNT_REASON,
        });
        break;
      case 'magiclink':
      case 'email':
        subject = 'Votre lien de connexion à PatchFlow';
        mail = renderEmail({
          title: 'Connexion à PatchFlow', preheader: 'Cliquez pour vous connecter. Lien valable 1 heure.',
          body: p(`Voici votre lien de connexion pour le compte <strong style="color:#101828">${account}</strong>. Il ouvre PatchFlow directement, sans mot de passe.`),
          cta: { label: 'Me connecter', url: verifyUrl }, fallback: true,
          note: 'Ce lien expire dans 1 heure et ne sert qu\'une fois. Vous n\'avez rien demandé ? Ignorez cet e-mail.',
          reason: ACCOUNT_REASON,
        });
        break;
      case 'email_change':
        subject = 'Confirmez votre nouvelle adresse e-mail';
        mail = renderEmail({
          tag: 'Sécurité', title: 'Confirmez votre nouvelle adresse', preheader: 'Une dernière étape pour changer l\'adresse de votre compte PatchFlow.',
          body: p(`Vous avez demandé à utiliser <strong style="color:#101828">${account}</strong> pour votre compte PatchFlow.`) +
            p('Confirmez ce changement en cliquant ci-dessous. Tant que ce n\'est pas fait, votre ancienne adresse reste active.'),
          cta: { label: 'Confirmer mon adresse', url: verifyUrl }, fallback: true,
          note: 'Vous n\'êtes pas à l\'origine de cette demande ? Ignorez cet e-mail et écrivez-nous à support@patchflow.fr.',
          reason: ACCOUNT_REASON,
        });
        break;
      case 'invite': {
        const meta = user.user_metadata || {};
        // Valeurs venant de user_metadata (posées par le propriétaire) → échapper le HTML
        const inviterRaw  = meta.inviter   || 'Un technicien';
        const showNameRaw = meta.show_name || 'un show';
        const inviter   = esc(inviterRaw);
        const showName  = esc(showNameRaw);
        subject = `${inviterRaw} vous invite sur le show « ${showNameRaw} »`;
        mail = renderEmail({
          tag: 'Invitation', title: `${inviter} vous invite à rejoindre un show`, preheader: `Rejoignez « ${showName} » sur PatchFlow.`,
          body: p(`<strong style="color:#101828">${inviter}</strong> vous invite à collaborer sur PatchFlow, l'outil de préparation technique des équipes son et scène.`) +
            details([['Show', showName], ['Invité', account]]) +
            p('Créez votre compte avec cette adresse : vous accéderez directement au show.'),
          cta: { label: 'Créer mon compte', url: verifyUrl }, fallback: true,
          note: 'Ce lien expire dans 24 heures. Vous ne connaissez pas cette personne ? Ignorez cet e-mail.',
          reason: `Cet e-mail a été envoyé à ${account} à la demande de ${inviter}, qui utilise PatchFlow.`,
        });
        break;
      }
      case 'signup':
        subject = 'Confirmez votre adresse pour activer votre compte PatchFlow';
        mail = renderEmail({
          title: 'Bienvenue sur PatchFlow', preheader: 'Confirmez votre adresse pour activer votre compte.',
          body: p('Merci de vous être inscrit. Il reste une étape : confirmer votre adresse e-mail pour activer votre compte.') +
            details([['Compte', account]]),
          cta: { label: 'Confirmer mon adresse', url: verifyUrl }, fallback: true,
          note: 'Ce lien expire dans 24 heures. Vous n\'avez pas créé de compte ? Ignorez cet e-mail.',
          reason: ACCOUNT_REASON,
        });
        break;
      default:
        /* Type inconnu (nouveau type ajouté par Supabase, code à usage unique…) : aucun e-mail plutôt qu'un
           e-mail de confirmation trompeur. Le type est dans les journaux (ligne « [auth-email-hook] »). */
        console.warn('[auth-email-hook] type non géré, aucun e-mail envoyé :', type);
        await logEmail('auth-email-hook', String(type), user.email, '(aucun e-mail)', new Error('type non géré : aucun e-mail envoyé'));
        return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
    }

    try { await transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to: user.email, subject, ...mail }); }
    catch (e) { await logEmail('auth-email-hook', type, user.email, subject, e); throw e; }
    await logEmail('auth-email-hook', type, user.email, subject);
    return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('Hook error', e);
    return new Response(JSON.stringify({ error: { http_code: 500, message: String(e?.message || e) } }), { status: 500 });
  }
});
