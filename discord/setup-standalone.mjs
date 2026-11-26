#!/usr/bin/env node
/**
 * ryuk hub - discord setup (standalone, keine dependencies)
 *
 * 1:1 der referenz-aufbau: gleiche kategorien, gleiche kanal-namen mit emoji,
 * gleiche kanal-typen (ankuendigung = megafon, text = hashtag, privat = schloss).
 *
 * Braucht nur Node 18+.
 *
 *   1. Bot im Server (Administrator)
 *   2. DISCORD_TOKEN=... node setup.mjs <server_id> --reset --force
 *
 * Test ohne Server und ohne Token:  node setup.mjs <server_id> --dry
 *
 * Es werden NUR rollen, kategorien und kanaele angelegt. Keine Nachrichten.
 */
const API = 'https://discord.com/api/v10';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const reset = args.includes('--reset');
const force = args.includes('--force');
const guildId = args.find((a) => /^\d{15,25}$/.test(a));
const token = process.env.DISCORD_TOKEN;

if (!guildId) {
  console.error('usage: DISCORD_TOKEN=<bot token> node setup.mjs <server_id> [--dry] [--reset] [--force]');
  process.exit(1);
}
if (!dry && !token) {
  console.error('DISCORD_TOKEN fehlt. Beispiel: $env:DISCORD_TOKEN="dein_token"; node setup.mjs <server_id>');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
const P = {
  KickMembers: 2n,
  BanMembers: 4n,
  Administrator: 8n,
  ManageChannels: 16n,
  ManageGuild: 32n,
  AddReactions: 64n,
  ViewAuditLog: 128n,
  ViewChannel: 1024n,
  SendMessages: 2048n,
  ManageMessages: 8192n,
  ReadMessageHistory: 65536n,
  Connect: 1048576n,
  Speak: 2097152n,
  MuteMembers: 4194304n,
  DeafenMembers: 8388608n,
  ManageRoles: 268435456n,
  ManageWebhooks: 536870912n,
  ManageEvents: 8589934592n,
  ModerateMembers: 1099511627776n,
  CreatePublicThreads: 34359738368n,
  SendMessagesInThreads: 274877906944n,
};
const bits = (...list) => list.reduce((a, b) => a | b, 0n).toString();

// ---------------------------------------------------------------------------
// Rollen
// ---------------------------------------------------------------------------
const ROLES = [
  { name: 'Owner', color: 0xffffff, perms: () => bits(P.Administrator) },
  {
    name: 'Admin',
    color: 0xe8e8e8,
    perms: () => bits(P.ManageGuild, P.ManageRoles, P.ManageChannels, P.KickMembers, P.BanMembers,
      P.ModerateMembers, P.ManageMessages, P.ViewAuditLog, P.ManageWebhooks, P.ManageEvents),
  },
  {
    name: 'Moderator',
    color: 0xbfbfbf,
    perms: () => bits(P.KickMembers, P.ModerateMembers, P.ManageMessages, P.ViewAuditLog, P.MuteMembers, P.DeafenMembers),
  },
  { name: 'Helper', color: 0x8f8f8f, perms: () => bits(P.ManageMessages) },
  { name: 'Verified', color: 0x6e6e6e, perms: () => '0' },
  { name: 'Member', color: 0x4a4a4a, perms: () => '0' },
  { name: 'Muted', color: 0x2a2a2a, perms: () => '0' },
];
const STAFF = ['Owner', 'Admin', 'Moderator', 'Helper'];

// ---------------------------------------------------------------------------
// Aufbau - 1:1 wie im referenz-server
//
// kind:  'announcement' = megafon   'text' = hashtag   'voice' = lautsprecher
// lock:  true = schloss (nur staff sieht den kanal)
// ---------------------------------------------------------------------------
const LAYOUT = [
  {
    name: null, // ohne kategorie, ganz oben
    channels: [
      { name: 'rules', kind: 'announcement', readOnly: true, topic: 'Read this before posting' },
      { name: 'tos', kind: 'text', readOnly: true, topic: 'Terms of service' },
      { name: 'STATUS: 🟢', kind: 'text', lock: true, topic: 'Status' },
    ],
  },
  {
    name: 'IMPORTANT',
    channels: [
      { name: '📣・announcements', kind: 'announcement', readOnly: true, topic: 'News and releases' },
      { name: '📣・affiliate-program', kind: 'text', topic: 'Affiliate program' },
      { name: '📣・updates', kind: 'text', readOnly: true, topic: 'Changelog' },
      { name: '🍑・purchase', kind: 'text', topic: 'How to buy' },
      { name: '🎫・ticket', kind: 'text', topic: 'Open a ticket' },
      { name: '📘・info', kind: 'text', readOnly: true, topic: 'Info' },
      { name: '💰・stock', kind: 'text', topic: 'Stock' },
      { name: '💰・limiteds', kind: 'text', topic: 'Limiteds' },
      { name: '💰・robux', kind: 'text', topic: 'Robux' },
      { name: '💰・discord-accounts', kind: 'text', topic: 'Discord accounts' },
    ],
  },
  {
    name: 'COMMUNITY',
    channels: [
      { name: '💬・chat', kind: 'text', topic: 'Talk here', slowmode: 3 },
      { name: '🎥・uploads', kind: 'text', topic: 'Clips and screenshots', slowmode: 10 },
      { name: '💡・suggestions', kind: 'text', topic: 'Ideas' },
      { name: '⚙️・configs', kind: 'text', topic: 'Share your configs' },
    ],
  },
  {
    name: 'VOUCHES',
    channels: [
      { name: '⭐・reviews', kind: 'text', topic: 'Reviews only' },
      { name: '💬・feedback', kind: 'text', topic: 'Feedback' },
    ],
  },
];

// Namen aus frueheren Laeufen, damit --reset sauber aufraeumt.
const OLD_EMOJI = {
  categories: ['📢 important', '📥 script', '💸 purchase', '💬 community', '⭐ vouches', '🔊 voice', '🛡️ staff'],
  channels: [
    '📢・announcements', '📜・rules', '🔄・updates', 'ℹ️・info',
    '📥・download', '🧾・changelog', '🛠️・support', '🎬・showcase',
    '🎫・ticket', '💳・purchase', '💵・prices',
    '💬・chat', '🖼️・uploads', '💡・suggestions', '⚙️・configs',
    '⭐・reviews', '💬・feedback',
    '🔊・party chat', '🎧・script talk',
    '🛡️・staff-chat', '📋・logs',
  ],
};
const OLD_PLAIN = {
  categories: ['INFO', 'SCRIPT', 'COMMUNITY', 'VOICE', 'STAFF'],
  channels: [
    'announcements', 'rules', 'updates', 'info',
    'download', 'support', 'showcase',
    'general', 'media', 'memes', 'bot-commands',
    'General', 'Chill', 'Script Talk',
    'staff-chat', 'logs',
  ],
};

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const info = await res.json().catch(() => ({}));
      await sleep(Math.ceil((info.retry_after ?? 1) * 1000) + 150);
      continue;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status} ${(data && data.message) || ''}`.trim());
      err.status = res.status;
      throw err;
    }
    return data;
  }
  throw new Error(`rate limited: ${method} ${path}`);
}

/** 0 text, 2 voice, 4 category, 5 announcement */
const CHANNEL_TYPE = { text: 0, voice: 2, announcement: 5 };

function overwritesFor(spec, roles) {
  const everyone = guildId;
  const staff = STAFF.map((n) => roles[n]);
  const ow = [];

  if (spec.lock) {
    ow.push({ id: everyone, type: 0, deny: bits(P.ViewChannel) });
    ow.push({ id: roles.Verified.id, type: 0, deny: bits(P.ViewChannel) });
    for (const r of staff) ow.push({ id: r.id, type: 0, allow: bits(P.ViewChannel, P.SendMessages, P.ReadMessageHistory) });
    return ow;
  }

  if (spec.readOnly) {
    ow.push({ id: everyone, type: 0, allow: bits(P.ViewChannel, P.ReadMessageHistory), deny: bits(P.SendMessages, P.CreatePublicThreads) });
    for (const r of staff) ow.push({ id: r.id, type: 0, allow: bits(P.SendMessages) });
  } else if (spec.voice) {
    ow.push({ id: everyone, type: 0, allow: bits(P.ViewChannel, P.Connect, P.Speak) });
    ow.push({ id: roles.Muted.id, type: 0, deny: bits(P.Speak) });
    return ow;
  }

  if (spec.kind !== 'voice') {
    ow.push({ id: roles.Muted.id, type: 0, deny: bits(P.SendMessages, P.CreatePublicThreads, P.AddReactions) });
  }
  return ow;
}

// ---------------------------------------------------------------------------
// Plan (--dry)
// ---------------------------------------------------------------------------
function printPlan() {
  console.log(`server id: ${guildId}`);
  console.log('');
  console.log('roles');
  for (const r of ROLES) console.log(`  ${r.name.padEnd(10)} perms ${r.perms()}`);
  console.log('');
  console.log('channels (megafon = announcement, # = text, schloss = privat)');
  for (const group of LAYOUT) {
    console.log(`  ${group.name ? `[${group.name}]` : '[no category]'}`);
    for (const ch of group.channels) {
      const icon = ch.kind === 'announcement' ? 'megafon' : ch.kind === 'voice' ? 'voice' : '#';
      const flags = [
        icon,
        ch.readOnly && 'read-only',
        ch.lock && 'private',
        ch.slowmode && `slowmode ${ch.slowmode}s`,
      ].filter(Boolean).join(', ');
      console.log(`    ${ch.name.padEnd(26)} ${flags}`);
    }
  }
  console.log('');
  console.log(`${ROLES.length} roles, ${LAYOUT.reduce((n, g) => n + g.channels.length, 0)} channels, no messages`);
  if (reset) console.log(`reset: everything this script ever created is removed first${force ? ' (even with messages)' : ' (empty ones only)'}`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const created = [];
const kept = [];
const removed = [];

function knownNames() {
  const names = new Set();
  for (const group of LAYOUT) {
    if (group.name) names.add(group.name);
    for (const ch of group.channels) names.add(ch.name);
  }
  for (const n of OLD_EMOJI.categories) names.add(n);
  for (const n of OLD_EMOJI.channels) names.add(n);
  for (const n of OLD_PLAIN.categories) names.add(n);
  for (const n of OLD_PLAIN.channels) names.add(n);
  return names;
}

async function removeKnown(names) {
  const all = await api(`/guilds/${guildId}/channels`);

  for (const ch of all) {
    if (ch.type === 4) continue;
    if (!names.has(ch.name)) continue;
    if (ch.type === 0 && !force) {
      const msgs = await api(`/channels/${ch.id}/messages?limit=1`).catch(() => []);
      if (Array.isArray(msgs) && msgs.length > 0) {
        console.log(`  ~ keep     ${ch.name} (has messages, use --force)`);
        continue;
      }
    }
    try {
      await api(`/channels/${ch.id}`, { method: 'DELETE' });
      removed.push(ch.name);
      console.log(`  - remove   ${ch.name}`);
      await sleep(150);
    } catch (err) {
      console.log(`  ! remove   ${ch.name}: ${err.message}`);
    }
  }

  // kategorien erst danach, und nur wenn sie leer sind
  const left = await api(`/guilds/${guildId}/channels`);
  for (const ch of left) {
    if (ch.type !== 4 || !names.has(ch.name)) continue;
    if (left.some((c) => c.parent_id === ch.id)) continue;
    try {
      await api(`/channels/${ch.id}`, { method: 'DELETE' });
      removed.push(ch.name);
      console.log(`  - remove   [${ch.name}]`);
      await sleep(150);
    } catch (err) {
      console.log(`  ! remove   [${ch.name}]: ${err.message}`);
    }
  }
}

async function run() {
  const guild = await api(`/guilds/${guildId}`);
  console.log(`server: ${guild.name} (${guild.id})`);

  if (reset) {
    console.log('reset');
    await removeKnown(knownNames());
  }

  const existingRoles = await api(`/guilds/${guildId}/roles`);
  const roles = {};
  for (const def of ROLES) {
    const hit = existingRoles.find((r) => r.name === def.name && !r.managed);
    if (hit) {
      roles[def.name] = hit;
      kept.push(`role ${def.name}`);
      console.log(`  = role     ${def.name}`);
      continue;
    }
    const role = await api(`/guilds/${guildId}/roles`, {
      method: 'POST',
      body: { name: def.name, color: def.color, hoist: true, mentionable: false, permissions: def.perms() },
    });
    roles[def.name] = role;
    created.push(`role ${def.name}`);
    console.log(`  + role     ${def.name}`);
    await sleep(120);
  }

  const existing = await api(`/guilds/${guildId}/channels`);

  for (const group of LAYOUT) {
    let category = null;
    if (group.name) {
      category = existing.find((c) => c.type === 4 && c.name === group.name);
      if (!category) {
        category = await api(`/guilds/${guildId}/channels`, {
          method: 'POST',
          body: { name: group.name, type: 4 },
        });
        created.push(`category ${group.name}`);
        console.log(`  + category ${group.name}`);
        await sleep(120);
      } else {
        kept.push(`category ${group.name}`);
        console.log(`  = category ${group.name}`);
      }
    }

    for (const spec of group.channels) {
      const type = CHANNEL_TYPE[spec.kind ?? 'text'];
      const hit = existing.find((c) => c.name === spec.name && c.type === type);
      if (hit) {
        kept.push(`channel ${spec.name}`);
        console.log(`  = channel  ${spec.name}`);
        continue;
      }
      const body = {
        name: spec.name,
        type,
        parent_id: category ? category.id : undefined,
        topic: type === 2 ? undefined : spec.topic,
        rate_limit_per_user: type === 0 ? (spec.slowmode ?? 0) : undefined,
        permission_overwrites: overwritesFor(spec, roles),
      };
      try {
        await api(`/guilds/${guildId}/channels`, { method: 'POST', body });
      } catch (err) {
        // megafon-kanal braucht das Community-feature. Ohne das: als text anlegen,
        // damit nichts abbricht.
        if (type === 5 && (err.status === 400 || err.status === 403)) {
          await api(`/guilds/${guildId}/channels`, { method: 'POST', body: { ...body, type: 0 } });
          console.log(`  ! channel  ${spec.name} (announcement braucht Community -> als text)`);
          created.push(`channel ${spec.name}`);
          await sleep(160);
          continue;
        }
        throw err;
      }
      created.push(`channel ${spec.name}`);
      console.log(`  + channel  ${spec.name}`);
      await sleep(160);
    }
  }

  console.log('');
  console.log(`done: ${created.length} created, ${kept.length} already there${removed.length ? `, ${removed.length} removed` : ''}`);
  console.log('');
  console.log('manual after this:');
  console.log('  - drag the categories into order (IMPORTANT, COMMUNITY, VOUCHES)');
  console.log('  - give yourself the Owner role');
  console.log('  - upload the banner');
}

if (dry) {
  printPlan();
} else {
  run().catch((err) => {
    console.error('');
    console.error(`error: ${err.message}`);
    if (err.status === 401) console.error('token invalid - reset it in the developer portal');
    if (err.status === 403) console.error('bot lacks permissions - invite it with Administrator');
    if (err.status === 404) console.error('server id wrong, or the bot is not on that server');
    process.exit(1);
  });
}
