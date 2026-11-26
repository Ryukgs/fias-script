#!/usr/bin/env node
/**
 * ryuk hub - discord setup (standalone, keine dependencies)
 *
 * Braucht nur Node 18+. Kein npm install, kein discord.js.
 *
 *   1. Bot im Server (Administrator)
 *   2. DISCORD_TOKEN=... node setup.mjs <server_id>
 *
 * Test ohne Server:  node setup.mjs <server_id> --dry
 */
const API = 'https://discord.com/api/v10';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const guildId = args.find((a) => /^\d{15,25}$/.test(a));
const token = process.env.DISCORD_TOKEN;

if (!guildId) {
  console.error('usage: DISCORD_TOKEN=<bot token> node setup.mjs <server_id> [--dry]');
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
// Aufbau
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

const LAYOUT = [
  {
    name: 'INFO',
    channels: [
      { name: 'announcements', readOnly: true, topic: 'News, releases and important changes', post: 'announcements' },
      { name: 'rules', readOnly: true, topic: 'Read this before posting', post: 'rules' },
      { name: 'updates', readOnly: true, topic: 'Script changelog', post: 'changelog' },
      { name: 'info', readOnly: true, topic: 'What this server is and how to load the script', post: 'info' },
    ],
  },
  {
    name: 'SCRIPT',
    channels: [
      { name: 'download', verifiedOnly: true, readOnly: true, topic: 'Loader + how to run it', post: 'download' },
      { name: 'support', verifiedOnly: true, topic: 'Questions and help - no DMs to staff', slowmode: 10, post: 'support' },
      { name: 'showcase', verifiedOnly: true, topic: 'Clips and screenshots', slowmode: 15 },
    ],
  },
  {
    name: 'COMMUNITY',
    channels: [
      { name: 'general', topic: 'Talk here', slowmode: 3 },
      { name: 'media', topic: 'Clips, edits, screenshots', slowmode: 10 },
      { name: 'memes', topic: 'Memes', slowmode: 10 },
      { name: 'bot-commands', topic: 'Bot spam only', slowmode: 5 },
    ],
  },
  {
    name: 'VOICE',
    channels: [
      { name: 'General', voice: true },
      { name: 'Chill', voice: true },
      { name: 'Script Talk', voice: true },
    ],
  },
  {
    name: 'STAFF',
    staffOnly: true,
    channels: [
      { name: 'staff-chat', topic: 'Internal' },
      { name: 'logs', readOnly: true, topic: 'Moderation log' },
    ],
  },
];

const LOADER = 'loadstring(game:HttpGet("https://raw.githubusercontent.com/Ryukgs/fias-script/main/loader.lua"))()';

const TEXTS = {
  announcements: {
    title: 'Server is live',
    lines: [
      '**ryuk hub** is open.',
      '',
      'Script releases, changelogs and support all land here from now on.',
      'Grab the loader in {download} and read the rules before posting.',
    ],
  },
  rules: {
    title: 'Rules',
    lines: [
      '**1.** Respect everyone. No racism, insults, threats or harassment.',
      '**2.** No spam, no advertising, no server invites.',
      '**3.** No NSFW content anywhere.',
      '**4.** Support only in {support}, never in staff DMs.',
      '**5.** Do not leak the script, its key or paid content.',
      '**6.** Follow staff instructions. Arguing in public gets you muted.',
      '**7.** No alt accounts to dodge mutes or bans.',
      '',
      'Breaking a rule = mute, kick or ban, depending on severity.',
    ],
  },
  info: {
    title: 'ryuk hub',
    lines: [
      'Script for **Fight in a School**.',
      '',
      '**Features**',
      '• Auto Weave - constant weave window, no gap while punching or dodging',
      '• Auto Punch / Auto Dodge',
      '• Potato mode, no camera effects',
      '• Clean menu: Main / Misc / Config',
      '',
      '**How to load**',
      '```lua',
      LOADER,
      '```',
      'RightShift opens the menu.',
      '',
      '**Channels**',
      '• {download} - loader',
      '• {updates} - changelog',
      '• {support} - help',
    ],
  },
  download: {
    title: 'Download',
    lines: [
      '**Loader**',
      '```lua',
      LOADER,
      '```',
      '**Steps**',
      '1. Copy the line above.',
      '2. Paste it into your executor and execute.',
      '3. RightShift opens and closes the menu.',
      '',
      '**If it does not load**',
      '• Clear the executor cache and execute again.',
      '• Check {updates} for the current version.',
      '• Still stuck? Ask in {support} with your executor name and a screenshot.',
    ],
  },
  changelog: {
    title: 'v1.0',
    lines: [
      '**Auto Weave is finished**',
      '• Steady weave with a fixed cadence - no flicker while standing or dodging',
      '• Punch and dodge no longer close the window, so combo spam stays covered',
      '• Instant reopen if the server ever drops the window',
      '',
      '**Versioning**',
      'From here on every release goes up by 0.1: 1.1, 1.2, 1.3 ...',
    ],
  },
  support: {
    title: 'Support',
    lines: [
      'Ask here, not in DMs. One question per message, please.',
      '',
      '**Include**',
      '• What you expected and what happened',
      '• Your executor',
      '• Script version (shown in the menu header)',
      '• A screenshot or clip if it is visual',
      '',
      'Staff will answer as soon as someone is free.',
    ],
  },
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
// Plan (auch fuer --dry)
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
      const flags = [ch.voice ? 'voice' : 'text', ch.readOnly && 'read-only', ch.verifiedOnly && 'verified', ch.slowmode && `slowmode ${ch.slowmode}s`, ch.post && `text: ${ch.post}`]
        .filter(Boolean).join(', ');
      console.log(`    ${ch.name.padEnd(16)} ${flags}`);
    }
  }
  console.log('');
  console.log(`${ROLES.length} roles, ${LAYOUT.reduce((n, g) => n + g.channels.length, 0)} channels`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const created = [];
const kept = [];

async function run() {
  const guild = await api(`/guilds/${guildId}`);
  console.log(`server: ${guild.name} (${guild.id})`);

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

  const existingChannels = await api(`/guilds/${guildId}/channels`);
  const channels = {};

  for (const group of LAYOUT) {
    let category = existingChannels.find((c) => c.type === 4 && c.name === group.name);
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
      if (!channels[spec.name]) {
        const hit = existingChannels.find((c) => c.name === spec.name && c.type === type);
        if (hit) {
          channels[spec.name] = hit;
          kept.push(`channel ${spec.name}`);
          console.log(`  = channel  ${spec.name}`);
          continue;
        }
        const ch = await api(`/guilds/${guildId}/channels`, {
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
        channels[spec.name] = ch;
        created.push(`${type === 2 ? 'voice' : 'channel'} ${spec.name}`);
        console.log(`  + ${type === 2 ? 'voice   ' : 'channel '} ${spec.name}`);
        await sleep(150);
      }
    }
  }

  console.log('  texts');
  const lookup = { download: channels.download, updates: channels.updates, support: channels.support };
  for (const group of LAYOUT) {
    for (const spec of group.channels) {
      if (!spec.post) continue;
      const ch = channels[spec.name];
      if (!ch) continue;
      try {
        const recent = await api(`/channels/${ch.id}/messages?limit=1`);
        if (recent.length > 0) {
          console.log(`  = text     ${spec.name}`);
          continue;
        }
        const text = TEXTS[spec.post];
        let description = text.lines.join('\n');
        for (const [name, target] of Object.entries(lookup)) {
          description = description.split(`{${name}}`).join(target ? `<#${target.id}>` : `#${name}`);
        }
        await api(`/channels/${ch.id}/messages`, {
          method: 'POST',
          body: { embeds: [{ title: text.title, description, color: 0xffffff }] },
        });
        created.push(`text ${spec.name}`);
        console.log(`  + text     ${spec.name}`);
        await sleep(150);
      } catch (err) {
        console.log(`  ! text     ${spec.name}: ${err.message}`);
      }
    }
  }

  console.log('');
  console.log(`done: ${created.length} created, ${kept.length} already there`);
  console.log('');
  console.log('manual after this:');
  console.log('  - verification: Server Settings > Onboarding, so new members need Verified');
  console.log('    (otherwise they cannot see download/support)');
  console.log('  - give yourself the Owner role');
  console.log('  - drag categories into order, upload the banner');
}

if (dry) {
  printPlan();
} else {
  run().catch((err) => {
    console.error('');
    console.error(`error: ${err.message}`);
    if (err.status === 401) console.error('token invalid - did you reset it after posting it in chat?');
    if (err.status === 403) console.error('bot lacks permissions - invite it with Administrator');
    if (err.status === 404) console.error('server id wrong, or the bot is not on that server');
    process.exit(1);
  });
}
