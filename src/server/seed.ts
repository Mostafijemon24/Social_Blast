import { BOOST_DEFAULTS, BOOST_DESC, nextSeq, q, tx, type Param } from './db';
import { addDays, zonedDateKey, zonedToUtc } from '@/lib/time';

// Demo data for the prototype's "Northgate HVAC" agency workspace. Dates are
// relative to the moment the database is created so the calendar stays current.

const J = JSON.stringify;

export const DEMO_CAPTIONS: Record<string, string> = {
  instagram: "Texas summer doesn't wait — and neither should your AC. ☀️\n\nBook a Spring Tune-Up for $89 and keep your system running cool before peak season hits. Our Austin-based techs check refrigerant, airflow, and efficiency in one visit.\n\nTap to book 👉 link in bio",
  facebook: 'Beat the Austin heat before it arrives. Our $89 Spring AC Tune-Up gets your system inspected, cleaned, and efficiency-tested by local Northgate HVAC technicians. Limited spring slots — book this week.',
  linkedin: "Spring is the smart time for preventive HVAC maintenance. Northgate HVAC's $89 tune-up helps Austin homeowners avoid summer breakdowns and reduce energy costs. Schedule a visit with our licensed team.",
  x: 'Austin — book your $89 Spring AC tune-up before the heat hits. Local techs, one visit, cooler summer. 🧊',
  pinterest: 'Spring AC Tune-Up Checklist for Texas homes: refrigerant, airflow, filters & efficiency. Book a professional $89 visit with Northgate HVAC in Austin.',
  gbp: 'Our Spring AC Tune-Up is $89 through May. A Northgate HVAC technician will inspect refrigerant levels, test airflow, and check system efficiency at your Austin home. Call or book online to schedule.',
};
export const DEMO_HASHTAGS: Record<string, string[]> = {
  instagram: ['#ATXhomes', '#ACtuneup', '#beatthetexasheat'],
  facebook: ['#AustinHVAC'],
  linkedin: ['#HVAC', '#SmallBusiness'],
  x: ['#ATX'],
  pinterest: ['#homemaintenance'],
  gbp: [],
};
export const DEMO_TITLES: Record<string, string> = {
  pinterest: 'Spring AC Tune-Up Checklist',
  gbp: 'Spring AC Tune-Up — $89',
};

/** Inserts the demo workspace in one transaction. Statements are collected, then run in order. */
export async function seed(): Promise<void> {
  const stmts: [string, Param[]][] = [];
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const H = 3600000;
  const D = 24 * H;

  const ins = (sql: string) => ({ run: (...params: Param[]) => { stmts.push([sql, params]); } });
  // Rows whose display order matters get a monotonic seq.
  const ordered = (sql: string) => ({ run: (...params: Param[]) => { stmts.push([sql, [...params, nextSeq()]]); } });
  const client = ins('INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES (?,?,?,?,?,?,?,?)');
  const conn = ins('INSERT INTO connections (id,client_id,name,platform,dests_label,last_sync,status) VALUES (?,?,?,?,?,?,?)');
  const dest = ordered('INSERT INTO destinations (id,client_id,connection_id,platform,name,meta,kind,seq) VALUES (?,?,?,?,?,?,?,?)');
  const post = ins('INSERT INTO posts (id,client_id,title,brief,keywords,status,scheduled_at,created_at,updated_at,platforms,source_pages,tone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const variant = ins('INSERT INTO post_variants (post_id,platform,caption,title,hashtags) VALUES (?,?,?,?,?)');
  const pdest = ins('INSERT INTO post_destinations (post_id,destination_id) VALUES (?,?)');
  const job = ins('INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)');

  {
    // ---- clients
    client.run('c1', 'Northgate HVAC', 'Austin, TX', 'NH', 'northgatehvac.com', 'Austin, TX', 'America/Chicago', iso(now - 400 * D));
    client.run('c2', 'Bloom & Co Floral', 'Portland, OR', 'BC', 'bloomandco.example', '', 'America/Los_Angeles', iso(now - 200 * D));
    client.run('c3', 'Peak Dental Studio', 'Denver, CO', 'PD', 'peakdental.example', '', 'America/Denver', iso(now - 90 * D));

    // ---- connections + destinations (c1 mirrors the design)
    conn.run('k1', 'c1', 'Northgate HVAC', 'facebook', '1 page', iso(now - 2 * 60000), 'connected');
    conn.run('k2', 'c1', '@northgatehvac', 'instagram', '1 account', iso(now - 2 * 60000), 'connected');
    conn.run('k3', 'c1', 'Northgate HVAC', 'linkedin', '1 company', iso(now - 14 * 60000), 'connected');
    conn.run('k4', 'c1', 'Northgate HVAC — Austin', 'gbp', '1 location', iso(now - H), 'connected');
    conn.run('k5', 'c1', '@northgate_hvac', 'x', '1 account', null, 'expired');
    dest.run('d1', 'c1', 'k2', 'instagram', '@northgatehvac', 'Professional account', 'ok');
    dest.run('d2', 'c1', 'k1', 'facebook', 'Northgate HVAC', 'Page · 4.2k followers', 'ok');
    dest.run('d3', 'c1', 'k3', 'linkedin', 'Northgate HVAC', 'Company page', 'ok');
    dest.run('d4', 'c1', 'k4', 'gbp', 'Northgate HVAC — Austin', 'Verified location', 'ok');
    dest.run('d5', 'c1', 'k5', 'x', '@northgate_hvac', 'Token expired', 'reauth');
    dest.run('d6', 'c1', null, 'pinterest', 'Northgate HVAC', 'Scheduling not supported via API', 'unsupported');

    const otherConns: [string, string, string, string, string][] = [
      ['k6', 'c2', 'Bloom & Co Floral', 'facebook', 'Page'],
      ['k7', 'c2', '@bloomandco', 'instagram', 'Professional account'],
      ['k8', 'c2', 'Bloom & Co — Portland', 'gbp', 'Verified location'],
      ['k9', 'c2', 'Bloom & Co Floral', 'pinterest', 'Board · Wedding florals'],
      ['k10', 'c3', 'Peak Dental Studio', 'facebook', 'Page'],
      ['k11', 'c3', '@peakdental', 'instagram', 'Professional account'],
      ['k12', 'c3', 'Peak Dental Studio', 'linkedin', 'Company page'],
      ['k13', 'c3', 'Peak Dental — Denver', 'gbp', 'Verified location'],
      ['k14', 'c3', 'Peak Dental — Lakewood', 'gbp', 'Verified location'],
      ['k15', 'c3', '@peakdentalco', 'x', 'Account'],
    ];
    otherConns.forEach(([id, cid, name, platform, meta], i) => {
      conn.run(id, cid, name, platform, platform === 'gbp' ? '1 location' : platform === 'pinterest' ? '1 board' : platform === 'facebook' ? '1 page' : platform === 'linkedin' ? '1 company' : '1 account', iso(now - (i + 3) * 7 * 60000), 'connected');
      dest.run(`d${i + 7}`, cid, id, platform, name, meta, platform === 'pinterest' ? 'unsupported' : 'ok');
    });

    // ---- posts for c1
    const tz = 'America/Chicago';
    const today = zonedDateKey(new Date(now), tz);
    const at = (dayOffset: number, hhmm: string) => zonedToUtc(addDays(today, dayOffset), hhmm, tz);
    const soon = iso(Math.ceil((now + 2 * H) / (30 * 60000)) * 30 * 60000); // ~2h out, on the half hour

    type SeedPost = { id: string; title: string; kw: string[]; status: string; when: string | null; dests: string[]; caption: string; created: number };
    const posts: SeedPost[] = [
      { id: 'p1', title: 'Spring AC tune-up special for Austin homeowners', kw: ['ac tune-up', 'austin'], status: 'scheduled', when: soon, dests: ['d1', 'd2', 'd4'], caption: DEMO_CAPTIONS.instagram, created: now - 3 * H },
      { id: 'p2', title: 'How often should you service your AC?', kw: ['ac maintenance'], status: 'draft', when: null, dests: ['d3'], caption: 'Most HVAC manufacturers recommend a professional AC check once a year — ideally in spring, before the cooling season starts. Here is what a tune-up covers and why timing matters.', created: now - 5 * H },
      { id: 'p3', title: 'Emergency AC repair — same-day in Austin', kw: ['ac repair', 'emergency'], status: 'pending', when: at(1, '08:00'), dests: ['d2', 'd1'], caption: 'AC quit on you? Northgate HVAC offers same-day repair visits across Austin. Call us and a local technician will diagnose the problem on the first visit.', created: now - 8 * H },
      { id: 'p4', title: 'Financing your new HVAC system', kw: ['hvac financing'], status: 'published', when: iso(now - 2 * D), dests: ['d2'], caption: 'Replacing your HVAC system? Northgate HVAC offers financing options so you can spread the cost. See the details on our financing page.', created: now - 4 * D },
      { id: 'p5', title: 'Beat the Texas heat checklist', kw: ['seasonal'], status: 'scheduled', when: at(2, '10:00'), dests: ['d1'], caption: 'Your 5-step beat-the-heat checklist: change filters, clear the outdoor unit, check the thermostat, look for leaks, and book a tune-up.', created: now - 20 * H },
      { id: 'p6', title: 'Why refrigerant levels matter', kw: ['education'], status: 'failed', when: at(3, '16:00'), dests: ['d5'], caption: 'Low refrigerant makes your AC work harder and cool less. A tune-up checks levels and looks for leaks. #ATX', created: now - 30 * H },
      { id: 'p7', title: '$89 tune-up — Austin', kw: ['ac tune-up', '$89 offer'], status: 'pending', when: soon, dests: ['d4'], caption: DEMO_CAPTIONS.gbp, created: now - 2 * H },
      { id: 'p8', title: 'Beat the heat — book this week', kw: ['ac tune-up'], status: 'scheduled', when: at(1, '12:30'), dests: ['d2'], caption: DEMO_CAPTIONS.facebook, created: now - 6 * H },
      { id: 'p9', title: 'Preventive HVAC maintenance', kw: ['hvac maintenance'], status: 'draft', when: at(1, '08:00'), dests: ['d3'], caption: DEMO_CAPTIONS.linkedin, created: now - 7 * H },
    ];
    const platformOf: Record<string, string> = { d1: 'instagram', d2: 'facebook', d3: 'linkedin', d4: 'gbp', d5: 'x', d6: 'pinterest' };
    const P1: Record<string, string> = {
      instagram: 'Peak season is coming to Austin. ☀️ Our $89 Spring Tune-Up covers refrigerant, airflow and an efficiency check — booked in one visit by a local tech. Link in bio to grab a slot.',
      facebook: 'Spring tune-up slots are open for Austin homes: $89 for a full refrigerant, airflow and efficiency check from the Northgate HVAC team. Book online or give us a call.',
      gbp: 'Spring AC Tune-Ups are $89 this season. Our technicians check refrigerant, airflow and efficiency so your system is ready for summer. Book online or call to schedule a visit.',
    };
    const OWN: Record<string, string> = {
      p7: 'Book an $89 AC tune-up at our Austin location. Each visit includes a refrigerant level check, airflow test and efficiency review by a Northgate HVAC technician.',
      p8: 'Summer in Austin is close. Book this week and a Northgate HVAC technician will clean, inspect and test your AC for $89 — before the first heat wave.',
      p9: 'Preventive maintenance is the cheapest HVAC repair. A yearly spring visit catches worn parts and low refrigerant early, which keeps energy bills predictable for Austin homeowners.',
    };
    for (const p of posts) {
      const plats = [...new Set(p.dests.map((d) => platformOf[d]))];
      post.run(p.id, 'c1', p.title, p.title, J(p.kw), p.status, p.when, iso(p.created), iso(p.created), J(plats), J(['/services/ac-tune-up', '/locations/austin', '/about']), 'friendly');
      for (const pl of plats) variant.run(p.id, pl, p.id === 'p1' ? P1[pl]! : OWN[p.id] ?? p.caption, DEMO_TITLES[pl] ?? '', J(p.id === 'p1' ? DEMO_HASHTAGS[pl] : []));
      for (const d of p.dests) pdest.run(p.id, d);
    }

    // The Content Studio's working draft (all six platforms).
    post.run('p0', 'c1', 'Spring AC tune-up — $89 offer', 'Spring AC tune-up special for Austin homeowners — $89, book before peak season', J(['ac tune-up', 'austin', '$89 offer']), 'draft', null, iso(now - 60000), iso(now - 60000),
      J(['instagram', 'facebook', 'linkedin', 'x', 'pinterest', 'gbp']), J(['/services/ac-tune-up', '/locations/austin', '/about']), 'friendly');
    for (const pl of Object.keys(DEMO_CAPTIONS)) variant.run('p0', pl, DEMO_CAPTIONS[pl], DEMO_TITLES[pl] ?? '', J(DEMO_HASHTAGS[pl]));
    for (const d of ['d1', 'd2', 'd4']) pdest.run('p0', d);

    // Publishing history (drives "Published (30d)").
    const histTitles = ['AC filter reminder', 'Meet our Austin techs', 'Thermostat tips for fall', 'Heat pump vs. furnace', 'Indoor air quality basics', 'Customer FAQ: AC noises', 'Duct cleaning explained', 'Weekend emergency service'];
    const hist = (cid: string, destIds: string[], count: number, startDay: number, span: number) => {
      for (let i = 0; i < count; i++) {
        const id = `h_${cid}_${startDay}_${i}`;
        const when = iso(Math.floor((now - (startDay + (i * span) / count) * D - 3 * H) / H) * H);
        const d = destIds[i % destIds.length];
        post.run(id, cid, histTitles[i % histTitles.length], '', '[]', 'published', when, when, when, J([platformOf[d] ?? 'facebook']), '[]', 'friendly');
        variant.run(id, platformOf[d] ?? 'facebook', `${histTitles[i % histTitles.length]} — published update.`, '', '[]');
        pdest.run(id, d);
      }
    };
    hist('c1', ['d1', 'd2', 'd3', 'd4'], 63, 1, 29); // last 30 days
    hist('c1', ['d1', 'd2', 'd3', 'd4'], 54, 30, 30); // previous 30 days
    platformOf.d7 = 'facebook'; platformOf.d8 = 'instagram'; platformOf.d9 = 'gbp';
    platformOf.d11 = 'facebook'; platformOf.d12 = 'instagram'; platformOf.d13 = 'linkedin'; platformOf.d14 = 'gbp';
    hist('c2', ['d7', 'd8', 'd9'], 41, 1, 29);
    hist('c2', ['d7', 'd8', 'd9'], 36, 30, 30);
    hist('c3', ['d11', 'd12', 'd13', 'd14'], 37, 1, 29);
    hist('c3', ['d11', 'd12', 'd13', 'd14'], 30, 30, 30);
    // Upcoming for other clients so "Scheduled" spans the workspace.
    const up = (cid: string, d: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const id = `u_${cid}_${i}`;
        const when = iso(now + (i + 1) * 0.9 * D);
        post.run(id, cid, `Scheduled update ${i + 1}`, '', '[]', 'scheduled', when, iso(now), iso(now), J([platformOf[d]]), '[]', 'friendly');
        variant.run(id, platformOf[d], `Scheduled update ${i + 1}.`, '', '[]');
        pdest.run(id, d);
      }
    };
    up('c2', 'd8', 12);
    up('c3', 'd11', 13);
    // A few more c2/c3 drafts awaiting approval.
    for (const [id, cid, d, st] of [['a_c2_1', 'c2', 'd8', 'pending'], ['a_c2_2', 'c2', 'd7', 'pending'], ['a_c3_1', 'c3', 'd11', 'pending'], ['a_c3_2', 'c3', 'd12', 'pending'], ['f_c3_1', 'c3', 'd13', 'failed']] as const) {
      post.run(id, cid, st === 'failed' ? 'Hygiene tips for kids' : 'Awaiting review', '', '[]', st, iso(now + 3 * D), iso(now), iso(now), J([platformOf[d]]), '[]', 'friendly');
      variant.run(id, platformOf[d], 'Awaiting review.', '', '[]');
      pdest.run(id, d);
    }

    // ---- jobs (Super Admin queues)
    let j = 0;
    const addJobs = (type: string, status: string, n: number, attempts = 0) => {
      for (let i = 0; i < n; i++) job.run(`j${++j}`, type, 'c1', null, status, attempts, null, iso(now - j * 60000));
    };
    addJobs('crawl', 'running', 3);
    addJobs('content', 'running', 4); addJobs('content', 'queued', 3);
    addJobs('image', 'queued', 2);
    addJobs('publish', 'queued', 6); addJobs('publish', 'retrying', 1, 1);
    for (const p of posts.filter((x) => x.status === 'scheduled')) {
      for (const d of p.dests) job.run(`jp_${p.id}_${d}`, 'publish', 'c1', p.id, 'queued', 0, `publish:${p.id}:${d}:${p.when}`, iso(p.created));
    }

    // ---- automations
    const auto = ins('INSERT INTO automations (id,client_id,kind,name,descr,enabled,supported,config,stat1,stat1_label,stat2,stat2_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    const commentDm = {
      keywords: ['price', 'quote', 'book', 'cost'],
      match: 'contains',
      commentReply: 'Thanks for reaching out! 🙌 Just sent you a DM with the details.',
      dm: "Hi! Thanks for your interest in our Spring AC Tune-Up 🧊\nIt's $89 through May and includes a full refrigerant, airflow & efficiency check. Want me to grab you a slot? Reply here or book: northgatehvac.com/book",
      tag: 'Warm lead',
      safeguards: { once: true, window: true, handoff: true },
    };
    const evergreen = { maxPerWeek: 3, minReuseDays: 45, days: ['Mon', 'Wed', 'Fri'], requireReview: true };
    const digest = { recipients: ['rhea@agency.example', 'ops@agency.example', 'owner@northgatehvac.com', 'marketing@northgatehvac.com'], sendDay: 'Mon' };
    for (const cid of ['c1', 'c2', 'c3']) {
      const c1 = cid === 'c1';
      auto.run(`${cid}_a1`, cid, 'evergreen', 'Evergreen rotation', 'Re-publishes approved content on a controlled schedule', c1 || cid === 'c2' ? 1 : 0, 1, J(evergreen), c1 ? '18' : '0', 'in library', '3/wk', 'max per dest');
      auto.run(`${cid}_a2`, cid, 'comment_dm', 'Comment → DM', 'Replies to keyword comments where the API permits', c1 ? 1 : 0, 1, J(commentDm), c1 ? '42' : '0', 'replies (30d)', c1 ? '6' : '0', 'leads captured');
      auto.run(`${cid}_a3`, cid, 'auto_boost', 'Auto-boost top posts', BOOST_DESC, 0, 1, J(BOOST_DEFAULTS), '0', 'boosts this month', '$0', 'planned spend (mo)');
      auto.run(`${cid}_a4`, cid, 'digest', 'Weekly digest', 'Emails a performance summary every Monday', c1 ? 1 : 0, 1, J(digest), '4', 'recipients', 'Mon', 'send day');
    }

    // ---- contacts
    const contact = ins('INSERT INTO contacts (id,client_id,name,handle,platform,campaign,tag,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    ([
      ['Marcus Lee', '@marcuslee', 'instagram', 'Spring tune-up', 'warm lead', 'pending'],
      ['Dana Price', 'dana.p', 'facebook', 'Beat the heat', 'new', 'scheduled'],
      ['Inez Rivera', '@inezr', 'instagram', 'Spring tune-up', 'contacted', 'published'],
      ['Sam Okafor', 'sam.okafor', 'linkedin', 'HVAC financing', 'qualified', 'published'],
      ['Priya Shah', '@priyashah', 'instagram', 'Emergency repair', 'new', 'scheduled'],
    ] as const).forEach((c, i) => contact.run(`ct${i + 1}`, 'c1', ...c, iso(now - (i + 1) * D)));

    // ---- website intelligence (c1)
    ordered('INSERT INTO crawls (id,client_id,site,finished_at,seq) VALUES (?,?,?,?,?)').run('cr1', 'c1', 'northgatehvac.com', zonedToUtc(today, '06:02', tz));
    const page = ins('INSERT INTO pages (id,client_id,url,title,type,state,error,sort) VALUES (?,?,?,?,?,?,?,?)');
    const named: [string, string, string, string, string | null][] = [
      ['/services/ac-tune-up', 'AC Tune-Up & Maintenance', 'Service', 'included', null],
      ['/services/ac-repair', 'AC Repair', 'Service', 'included', null],
      ['/locations/austin', 'HVAC in Austin, TX', 'Location', 'included', null],
      ['/about', 'About Northgate HVAC', 'About', 'included', null],
      ['/blog/spring-hvac-checklist', 'Spring HVAC Checklist', 'Blog', 'excluded', null],
      ['/financing', 'Financing Options', 'Page', 'error', 'HTTP 500 from origin'],
    ];
    named.forEach((p, i) => page.run(`pg${i + 1}`, 'c1', ...p, i));
    const extra = [
      ['/services/furnace-tune-up', 'Furnace Tune-Up', 'Service'], ['/services/heat-pumps', 'Heat Pump Installation', 'Service'],
      ['/services/duct-cleaning', 'Duct Cleaning', 'Service'], ['/services/indoor-air-quality', 'Indoor Air Quality', 'Service'],
      ['/services/thermostats', 'Smart Thermostats', 'Service'], ['/services/new-ac-installation', 'New AC Installation', 'Service'],
      ['/locations/round-rock', 'HVAC in Round Rock, TX', 'Location'], ['/locations/cedar-park', 'HVAC in Cedar Park, TX', 'Location'],
      ['/faq', 'Frequently Asked Questions', 'FAQ'], ['/contact', 'Contact Northgate HVAC', 'Contact'], ['/reviews', 'Customer Reviews', 'Page'],
      ['/careers', 'Careers', 'Page'], ['/warranty', 'Warranty Information', 'Page'], ['/maintenance-plans', 'Maintenance Plans', 'Service'],
    ];
    extra.forEach((p, i) => page.run(`pg${i + 7}`, 'c1', p[0], p[1], p[2], 'included', null, i + 6));
    for (let i = 0; i < 22; i++) {
      const err = i === 21;
      page.run(`pgb${i}`, 'c1', `/blog/post-${i + 1}`, `Blog post ${i + 1}`, 'Blog', err ? 'error' : 'included', err ? 'Timed out after 15s' : null, 100 + i);
    }
    const kw = ordered('INSERT INTO keywords (id,client_id,text,category,seq) VALUES (?,?,?,?,?)');
    let k = 0;
    for (const t of ['ac tune-up', 'ac repair austin', 'hvac maintenance']) kw.run(`kw${++k}`, 'c1', t, 'primary');
    for (const t of ['refrigerant check', 'air conditioner service', 'hvac financing', 'furnace tune-up']) kw.run(`kw${++k}`, 'c1', t, 'secondary');
    for (const t of ['energy efficiency', 'spring checklist', 'same-day repair']) kw.run(`kw${++k}`, 'c1', t, 'optional');

    // ---- activity
    const act = ins('INSERT INTO activity (id,client_id,kind,text,at) VALUES (?,?,?,?,?)');
    act.run('ac1', 'c1', 'published', 'Published to Facebook · Northgate HVAC', iso(now - 12 * 60000));
    act.run('ac2', 'c1', 'failed', 'X publish failed · token expired', iso(now - H));
    act.run('ac3', 'c1', 'generated', '6 drafts generated from website', iso(now - 3 * H));
    act.run('ac4', 'c1', 'crawl', 'Crawl complete · northgatehvac.com', zonedToUtc(today, '06:02', tz));

    // ---- a parsed bulk import awaiting confirmation (matches the design)
    const lbl = (off: number, hhmm: string) => { const u = at(off, hhmm); const [mo, dy] = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(u)).split(' '); return `${mo} ${dy} · ${shortT(u)}`; };
    const shortT = (u: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(u)).replace(' AM', 'a').replace(' PM', 'p');
    const rowsOut: unknown[] = [
      { row: 2, topic: 'Spring AC tune-up special', platform: 'instagram', destination: 'd1', when: lbl(5, '09:00'), scheduledAt: at(5, '09:00'), result: 'ok', msg: '' },
      { row: 3, topic: '$89 tune-up — Austin', platform: 'gbp', destination: 'd4', when: lbl(5, '09:00'), scheduledAt: at(5, '09:00'), result: 'ok', msg: '' },
      { row: 4, topic: 'Beat the heat — book this week', platform: 'facebook', destination: 'd2', when: lbl(6, '12:30'), scheduledAt: at(6, '12:30'), result: 'ok', msg: '' },
      { row: 5, topic: 'Emergency AC repair', platform: 'x', destination: 'd5', when: lbl(7, '16:00'), scheduledAt: null, result: 'error', msg: 'Destination needs reconnect (token expired)' },
      { row: 6, topic: 'Why refrigerant levels matter', platform: 'pinterest', destination: '', when: lbl(8, '09:00').split(' · ')[0], scheduledAt: null, result: 'error', msg: 'Missing destination — column is blank' },
      { row: 7, topic: 'Financing your new HVAC', platform: 'linkedin', destination: 'd3', when: '17/5/25', scheduledAt: null, result: 'warn', msg: 'Unrecognized date format — expected YYYY-MM-DD' },
    ];
    const fillerTopics = ['Filter change reminder', 'Meet the team', 'Thermostat tips', 'Heat pump FAQ', 'Air quality basics', 'Duct cleaning'];
    for (let r = 8; r <= 43; r++) {
      const isErr = r === 29;
      const d = ['d1', 'd2', 'd3', 'd4'][r % 4];
      rowsOut.push({ row: r, topic: `${fillerTopics[r % fillerTopics.length]} #${r - 7}`, platform: platformOf[d], destination: d, when: lbl(7 + (r % 20), '10:00'), scheduledAt: isErr ? null : at(7 + (r % 20), '10:00'), result: isErr ? 'error' : 'ok', msg: isErr ? 'Missing topic — column is blank' : '' });
    }
    ins('INSERT INTO imports (id,client_id,filename,created_at,status,rows,committed_count) VALUES (?,?,?,?,?,?,?)').run('im1', 'c1', 'spring-campaign.xlsx', iso(now - 20 * 60000), 'parsed', J(rowsOut), 0);

    // ---- AI usage + logs
    const usage = ins('INSERT INTO ai_usage (id,name,used_cents,budget_cents) VALUES (?,?,?,?)');
        usage.run('openrouter', 'OpenRouter (text)', 930, 4000);
    usage.run('images', 'AI images', 500, 2000);
    const lg = ins('INSERT INTO logs (at,level,msg) VALUES (?,?,?)');
    lg.run(zonedToUtc(today, '06:02', tz), 'INFO', 'crawl.completed site=northgatehvac.com pages=42');
    lg.run(zonedToUtc(today, '06:14', tz), 'INFO', 'content.generated client=c1 drafts=6');
    lg.run(zonedToUtc(today, '08:41', tz), 'WARN', 'oauth.token_expired platform=x account=d5');
    lg.run(zonedToUtc(today, '09:10', tz), 'ERROR', 'publish.failed job=8821 reason=auth retry=1');
    lg.run(zonedToUtc(today, '09:12', tz), 'INFO', 'publish.succeeded job=8822 platform=facebook');

  }
  await tx(async () => {
    for (const [sql, params] of stmts) await q.run(sql, ...params);
  });
}
