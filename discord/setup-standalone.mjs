#!/usr/bin/env node
/**
 * ryuk hub - discord setup (standalone, keine dependencies)
 *
 * Braucht nur Node 18+. Kein npm install.
 *
 *   1. Bot im Server (Administrator)
 *   2. DISCORD_TOKEN=... node setup.mjs <server_id>
 *   3. alte kanaele ersetzen:  ... node setup.mjs <server_id> --reset
 *
 * Test ohne Server und ohne Token:  node setup.mjs <server_id> --dry
 *
 * Es werden NUR rollen, kategorien und kanaele angelegt. Keine texte,
 * keine embeds, keine nachrichten.
 */
const API = 'https://discord.com/api/v10';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const reset = args.includes('--reset');
const force = args.includes('--force');
const guildId = args.find((a) => /^\d{15,25}$/.test(a));
const token = process.env.DISCORD_TOKEN;

if (!guildId) {
  console.error('usage: DISCORD_TOKEN=<bot token> node setup.mjs <server_id> [--dry] [--reset]');
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
// Rollen (von oben nach unten)
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
// Aufbau (emoji wie in den referenz-servern)
// ---------------------------------------------------------------------------
const LAYOUT = [
  {
    name: '📢 important',
    channels: [
      { name: '📢・announcements', readOnly: true, topic: 'News, releases and important changes' },
      { name: '📜・rules', readOnly: true, topic: 'Read this before posting' },
      { name: '🔄・updates', readOnly: true, topic: 'Script changelog' },
      { name: 'ℹ️・info', readOnly: true, topic: 'What this server is and how to load the script' },
    ],
  },
  {
    name: '📥 script',
    channels: [
      { name: '📥・download', verifiedOnly: true, readOnly: true, topic: 'Loader + how to run it' },
      { name: '🧾・changelog', readOnly: true, topic: 'Version history' },
      { name: '🛠️・support', verifiedOnly: true, topic: 'Questions and help - no DMs to staff', slowmode: 10 },
      { name: '🎬・showcase', verifiedOnly: true, topic: 'Clips and screenshots', slowmode: 15 },
    ],
  },
  {
    name: '💸 purchase',
    channels: [
      { name: '🎫・ticket', topic: 'Open a ticket for private help' },
      { name: '💳・purchase', topic: 'How to buy' },
      { name: '💵・prices', topic: 'Price list' },
    ],
  },
  {
    name: '💬 community',
    channels: [
      { name: '💬・chat', topic: 'Talk here', slowmode: 3 },
      { name: '🖼️・uploads', topic: 'Clips, edits, screenshots', slowmode: 10 },
      { name: '💡・suggestions', topic: 'Ideas for the script' },
      { name: '⚙️・configs', topic: 'Share your configs' },
    ],
  },
  {
    name: '⭐ vouches',
    channels: [
      { name: '⭐・reviews', topic: 'Reviews only' },
      { name: '💬・feedback', topic: 'Feedback and criticism' },
    ],
  },
  {
    name: '🔊 voice',
    channels: [
      { name: '🔊・party chat', voice: true },
      { name: '🎧・script talk', voice: true },
    ],
  },
  {
    name: '🛡️ staff',
    staffOnly: true,
    channels: [
      { name: '🛡️・staff-chat', topic: 'Internal' },
      { name: '📋・logs', readOnly: true, topic: 'Moderation log' },
    ],
  },
];

// Was ein frueherer lauf angelegt hat (ohne emoji). Nur mit --reset.
const LEGACY = {
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

function overwritesFor(spec, roles) {
  const everyone = guildId;
  const ow = [];
  const staff = STAFF.map((n) => roles[n]);

  if (spec.staffOnly) {
    ow.push({ id: everyone, type: 0, deny: bits(P.ViewChannel) });
    for (const r of staff) ow.push({ id: r.id, type: 0, allow: bits(P.ViewChannel, P.SendMessages, P.ReadMessageHistory) });
  } else if (spec.verifiedOnly) {
    ow.push({ id: everyone, type: 0, deny: bits(P.ViewChannel) });
    ow.push({ id: roles.Verified.id, type: 0, allow: bits(P.ViewChannel, P.ReadMessageHistory) });
    for (const r of staff) ow.push({ id: r.id, type: 0, allow: bits(P.ViewChannel, P.SendMessages, P.ReadMessageHistory) });
  } else if (spec.readOnly) {
    ow.push({ id: everyone, type: 0, allow: bits(P.ViewChannel, P.ReadMessageHistory), deny: bits(P.SendMessages, P.CreatePublicThreads) });
    for (const r of staff) ow.push({ id: r.id, type: 0, allow: bits(P.SendMessages) });
  } else if (spec.voice) {
    ow.push({ id: everyone, type: 0, allow: bits(P.ViewChannel, P.Connect, P.Speak) });
    ow.push({ id: roles.Muted.id, type: 0, deny: bits(P.Speak) });
    return ow;
  }

  ow.push({ id: roles.Muted.id, type: 0, deny: bits(P.SendMessages, P.CreatePublicThreads, P.AddReactions) });
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
  console.log('channels');
  for (const group of LAYOUT) {
    console.log(`  [${group.name}]${group.staffOnly ? ' (staff only)' : ''}`);
    for (const ch of group.channels) {
      const flags = [
        ch.voice ? 'voice' : 'text',
        ch.readOnly && 'read-only',
        ch.verifiedOnly && 'verified',
        ch.slowmode && `slowmode ${ch.slowmode}s`,
      ].filter(Boolean).join(', ');
      console.log(`    ${ch.name.padEnd(22)} ${flags}`);
    }
  }
  console.log('');
  console.log(`${ROLES.length} roles, ${LAYOUT.reduce((n, g) => n + g.channels.length, 0)} channels, no messages`);
  if (reset) console.log(`reset: legacy channels without emoji are removed first${force ? ' (even with messages)' : ' (empty ones only)'}`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const created = [];
const kept = [];
const removed = [];

async function removeLegacy() {
  const all = await api(`/guilds/${guildId}/channels`);

  for (const ch of all) {
    if (ch.type === 4) continue;
    if (!LEGACY.channels.includes(ch.name)) continue;
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

  const left = await api(`/guilds/${guildId}/channels`);
  for (const ch of left) {
    if (ch.type !== 4) continue;
    if (!LEGACY.categories.includes(ch.name)) continue;
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
    await removeLegacy();
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
    let category = existing.find((c) => c.type === 4 && c.name === group.name);
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

    for (const spec of group.channels) {
      const type = spec.voice ? 2 : 0;
      const hit = existing.find((c) => c.name === spec.name && c.type === type);
      if (hit) {
        kept.push(`channel ${spec.name}`);
        console.log(`  = ${type === 2 ? 'voice   ' : 'channel '} ${spec.name}`);
        continue;
      }
      await api(`/guilds/${guildId}/channels`, {
        method: 'POST',
        body: {
          name: spec.name,
          type,
          parent_id: category.id,
          topic: type === 0 ? spec.topic : undefined,
          rate_limit_per_user: type === 0 ? (spec.slowmode ?? 0) : undefined,
          permission_overwrites: overwritesFor(spec, roles),
        },
      });
      created.push(`${type === 2 ? 'voice' : 'channel'} ${spec.name}`);
      console.log(`  + ${type === 2 ? 'voice   ' : 'channel '} ${spec.name}`);
      await sleep(160);
    }
  }

  console.log('');
  console.log(`done: ${created.length} created, ${kept.length} already there${removed.length ? `, ${removed.length} removed` : ''}`);
  console.log('');
  console.log('manual after this:');
  console.log('  - verification: Server Settings > Onboarding, so new members need Verified');
  console.log('    (otherwise they cannot see download / support / showcase)');
  console.log('  - give yourself the Owner role');
  console.log('  - drag categories into order, upload the banner');
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
