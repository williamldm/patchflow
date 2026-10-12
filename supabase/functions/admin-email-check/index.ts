/**
 * admin-email-check — Vérifications des e-mails, pour l'onglet « E-mails » de l'administration.
 *
 * Réservée aux administrateurs : le jeton de l'appelant est vérifié par is_app_admin() (base), en plus de la
 * vérification de jeton de la plateforme. Actions :
 *   check  -> { config, smtp, dns }   secrets présents (jamais leurs valeurs), connexion et authentification
 *                                     SMTP, enregistrements SPF / DKIM / DMARC / MX du domaine d'envoi
 *   test   -> { ok, ms, error? }      envoie un e-mail de test à l'adresse du compte administrateur, et à
 *                                     elle seule (aucun destinataire n'est accepté dans la requête)
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.9';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const SMTP_HOST   = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_PORT   = parseInt(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER   = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS   = Deno.env.get('SMTP_PASS') ?? '';
const RESEND_KEY  = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SUPPORT     = Deno.env.get('SUPPORT_EMAIL') ?? '';
const SITE_URL    = Deno.env.get('SITE_URL') ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS }, tls: { minVersion: 'TLSv1.2' },
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
});
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('délai dépassé (' + ms / 1000 + ' s)')), ms))]);

/* Enregistrements TXT / MX par DNS sur HTTPS (Cloudflare) : aucune dépendance, résolution publique */
async function dns(name: string, type: string): Promise<string[]> {
  try {
    const r = await withTimeout(fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
    }), 6000);
    const j = await r.json();
    return ((j.Answer ?? []) as Array<{ type: number; data: string }>)
      .filter((a) => (type === 'TXT' ? a.type === 16 : a.type === 15))
      .map((a) => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
  } catch { return []; }
}

const maskOf = (to: string) => {
  const at = to.indexOf('@');
  return at > 1 ? to[0] + '***' + to.slice(at) : '***' + to.slice(Math.max(at, 0));
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user }, error: uerr } = await asUser.auth.getUser();
    if (uerr || !user) return json({ error: 'unauthorized' }, 401);
    const { data: isAdmin } = await asUser.rpc('is_app_admin');
    if (isAdmin !== true) return json({ error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // ── Vérifications ──
    if (body.action === 'check') {
      const domain = (SMTP_USER.split('@')[1] || '').toLowerCase();
      const config = {
        smtp_host: !!SMTP_HOST, smtp_port: SMTP_PORT, smtp_user: SMTP_USER ? maskOf(SMTP_USER) : '', smtp_pass: !!SMTP_PASS,
        hook_secret: !!HOOK_SECRET, resend: !!RESEND_KEY, support_email: SUPPORT, site_url: SITE_URL, domain,
      };
      let smtp: { ok: boolean; ms: number; error?: string; skipped?: boolean };
      if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) smtp = { ok: false, ms: 0, skipped: true, error: 'SMTP_HOST, SMTP_USER ou SMTP_PASS manquant' };
      else {
        const t0 = Date.now();
        try { await withTimeout(transporter.verify(), 14000); smtp = { ok: true, ms: Date.now() - t0 }; }
        catch (e) { smtp = { ok: false, ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 240) }; }
      }
      let dnsRes: Record<string, unknown> = { domain: '' };
      if (domain) {
        const selectors = ['default', 'mail', 'dkim', 's1', 's2', 'selector1', 'selector2', 'k1', 'google'];
        const [mx, txt, dmarcTxt, ...dk] = await Promise.all([
          dns(domain, 'MX'), dns(domain, 'TXT'), dns('_dmarc.' + domain, 'TXT'),
          ...selectors.map((s) => dns(`${s}._domainkey.${domain}`, 'TXT')),
        ]);
        const spf = txt.filter((t) => /^v=spf1\b/i.test(t));
        const dmarc = dmarcTxt.filter((t) => /^v=DMARC1\b/i.test(t));
        const dkim = selectors.filter((_, i) => dk[i].some((t) => /v=DKIM1|p=/i.test(t)));
        dnsRes = {
          domain,
          mx: mx.slice(0, 5),
          spf: { records: spf.map((s) => s.slice(0, 300)), count: spf.length },
          dmarc: { records: dmarc.map((s) => s.slice(0, 300)), policy: (dmarc[0]?.match(/\bp=([a-z]+)/i)?.[1] ?? '').toLowerCase() },
          dkim: { selectors: dkim },
        };
      }
      return json({ ok: true, config, smtp, dns: dnsRes });
    }

    // ── E-mail de test, à l'administrateur seulement ──
    if (body.action === 'test') {
      const to = String(user.email ?? '').trim();
      if (!to) return json({ error: 'no_email' }, 400);
      /* Une demande toutes les 15 secondes au plus */
      const { data: last } = await admin.from('email_log').select('at').eq('kind', 'test').order('at', { ascending: false }).limit(1).maybeSingle();
      if (last && Date.now() - new Date(last.at).getTime() < 15000) return json({ error: 'too_fast' }, 429);

      const subject = 'Test d\'envoi — PatchFlow';
      const when = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'medium' });
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:24px auto;padding:24px;border:1px solid #e2e8f0;border-radius:10px">
<h2 style="margin:0 0 12px;color:#1d3a5f">Test d'envoi réussi</h2>
<p style="color:#475569;line-height:1.6;margin:0">Cet e-mail confirme que PatchFlow peut envoyer des messages depuis <strong>${SMTP_USER || 'Resend'}</strong>.<br/>Envoyé le ${when}.</p></div>`;
      const t0 = Date.now();
      let ok = true, err = '';
      try {
        if (RESEND_KEY) {
          const r = await withTimeout(fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: `PatchFlow <${SMTP_USER || SUPPORT}>`, to: [to], subject, html }),
          }), 15000);
          if (!r.ok) throw new Error('Resend ' + r.status + ' : ' + (await r.text()).slice(0, 160));
        } else {
          if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error('SMTP_HOST, SMTP_USER ou SMTP_PASS manquant');
          await withTimeout(transporter.sendMail({ from: `PatchFlow <${SMTP_USER}>`, to, subject, html }), 20000);
        }
      } catch (e) { ok = false; err = String((e as Error)?.message ?? e).slice(0, 300); }
      await admin.from('email_log').insert({ source: 'admin-email-check', kind: 'test', to_masked: maskOf(to), subject, status: ok ? 'sent' : 'failed', error: ok ? null : err });
      return json({ ok, ms: Date.now() - t0, to: maskOf(to), via: RESEND_KEY ? 'resend' : 'smtp', ...(ok ? {} : { error: err }) });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('[admin-email-check]', e);
    return json({ error: 'server_error' }, 500);
  }
});
