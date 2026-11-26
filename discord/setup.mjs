#!/usr/bin/env node
/**
 * ryuk hub - discord server setup
 *
 * Legt in einem (leeren) Server an:
 *   - Rollen: Owner, Admin, Moderator, Helper, Verified, Member, Muted
 *   - Kategorien + Kanaele inkl. Rechte, Topics, Slowmodes
 *   - Start-Nachrichten in Regeln, Info, Download, Changelog, Support, Announcements
 *
 * Aufruf:
 *   DISCORD_TOKEN=dein_bot_token node setup.mjs <server_id>
 *
 * Der Bot muss im Zielserver sein und "Server verwalten" + "Rollen verwalten"
 * + "Kanaele verwalten" duerfen (Administrator ist am einfachsten).
 * Das Script ist idempotent: es legt nur an, was noch nicht da ist.
 */
import { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType } from 'discord.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const P = PermissionFlagsBits;

const token = process.env.DISCORD_TOKEN;
const guildId = process.argv[2];
if (!token || !guildId) {
  console.error('usage: DISCORD_TOKEN=<bot token> node setup.mjs <guild id>');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const iconPath = join(here, '..', 'artifacts', 'ryuk-logo.jpg');

// ---------------------------------------------------------------------------
// Rollen (Reihenfolge = Hierarchie von oben nach unten)
// ---------------------------------------------------------------------------
const ROLES = [
  {
    name: 'Owner',
    color: 0xffffff,
    perms: [P.Administrator],
  },
  {
    name: 'Admin',
    color: 0xe8e8e8,
    perms: [
      P.ManageGuild, P.ManageRoles, P.ManageChannels, P.KickMembers, P.BanMembers,
      P.ModerateMembers, P.ManageMessages, P.ViewAuditLog, P.ManageWebhooks,
      P.ManageEvents,
    ],
  },
  {
    name: 'Moderator',
    color: 0xbfbfbf,
    perms: [P.KickMembers, P.ModerateMembers, P.ManageMessages, P.ViewAuditLog, P.MuteMembers, P.DeafenMembers],
  },
  {
    name: 'Helper',
    color: 0x8f8f8f,
    perms: [P.ManageMessages],
  },
  {
    name: 'Verified',
    color: 0x6e6e6e,
    perms: [],
  },
  {
    name: 'Member',
    color: 0x4a4a4a,
    perms: [],
  },
  {
    name: 'Muted',
    color: 0x2a2a2a,
    perms: [],
  },
];

const STAFF = ['Owner', 'Admin', 'Moderator', 'Helper'];

// ---------------------------------------------------------------------------
// Kanaele
// ---------------------------------------------------------------------------

/** @type {{name: string, staffOnly?: boolean, channels: any[]}[]} */
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

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

const LOADER = 'loadstring(game:HttpGet("https://raw.githubusercontent.com/Ryukgs/fias-script/main/loader.lua"))()';

const TEXTS = {
  announcements: {
    title: 'Server is live',
    description: [
      '**ryuk hub** is open.',
      '',
      'Script releases, changelogs and support all land here from now on.',
      'Grab the loader in <#DOWNLOAD_CHANNEL> and read the rules before posting.',
    ].join('\n'),
  },
  rules: {
    title: 'Rules',
    description: [
      '**1.** Respect everyone. No racism, insults, threats or harassment.',
      '**2.** No spam, no advertising, no server invites.',
      '**3.** No NSFW content anywhere.',
      '**4.** Support only in <#SUPPORT_CHANNEL>, never in staff DMs.',
      '**5.** Do not leak the script, its key or paid content.',
      '**6.** Follow staff instructions. Arguing in public gets you muted.',
      '**7.** No alt accounts to dodge mutes or bans.',
      '',
      'Breaking a rule = mute, kick or ban, depending on severity.',
    ].join('\n'),
  },
  info: {
    title: 'ryuk hub',
    description: [
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
      'Executed in your executor. RightShift opens the menu.',
      '',
      '**Channels**',
      '• <#DOWNLOAD_CHANNEL> - loader',
      '• <#UPDATES_CHANNEL> - changelog',
      '• <#SUPPORT_CHANNEL> - help',
    ].join('\n'),
  },
  download: {
    title: 'Download',
    description: [
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
      '• Clear your executor cache and execute again.',
      '• Make sure you are on the latest version - see <#UPDATES_CHANNEL>.',
      '• Still stuck? Ask in <#SUPPORT_CHANNEL> with your executor name and a screenshot.',
    ].join('\n'),
  },
  changelog: {
    title: 'v1.0',
    description: [
      '**Auto Weave is finished**',
      '• Steady weave with a fixed cadence - no flicker while standing or dodging',
      '• Punch and dodge no longer close the window, so combo spam stays covered',
      '• Instant reopen if the server ever drops the window',
      '',
      '**Versioning**',
      'From here on every release goes up by 0.1: 1.1, 1.2, 1.3 ...',
    ].join('\n'),
  },
  support: {
    title: 'Support',
    description: [
      'Ask here, not in DMs. One question per message, please.',
      '',
      '**Include**',
      '• What you expected and what happened',
      '• Your executor',
      '• Script version (shown in the menu header)',
      '• A screenshot or clip if it is visual',
      '',
      'Staff will answer as soon as someone is free.',
    ].join('\n'),
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const created = [];
const skipped = [];

function logCreated(what, name) {
  created.push(`${what}: ${name}`);
  console.log(`  + ${what.padEnd(8)} ${name}`);
}

function logSkipped(what, name) {
  skipped.push(`${what}: ${name}`);
  console.log(`  = ${what.padEnd(8)} ${name}`);
}

function staff(roles) {
  return STAFF.map((n) => roles[n]);
}

function overwritesFor(guild, roles, spec) {
  const everyone = guild.roles.everyone;
  const muted = roles.Muted;
  const ow = [];

  if (spec.staffOnly) {
    ow.push({ id: everyone.id, deny: [P.ViewChannel] });
    for (const r of staff(roles)) ow.push({ id: r.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] });
  } else if (spec.verifiedOnly) {
    ow.push({ id: everyone.id, deny: [P.ViewChannel] });
    ow.push({ id: roles.Verified.id, allow: [P.ViewChannel, P.ReadMessageHistory] });
    for (const r of staff(roles)) ow.push({ id: r.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] });
  } else if (spec.readOnly) {
    ow.push({ id: everyone.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.CreatePublicThreads] });
    for (const r of staff(roles)) ow.push({ id: r.id, allow: [P.SendMessages] });
  } else if (spec.voice) {
    ow.push({ id: everyone.id, allow: [P.ViewChannel, P.Connect, P.Speak] });
    ow.push({ id: muted.id, deny: [P.Speak] });
  }

  if (!spec.voice) {
    ow.push({ id: muted.id, deny: [P.SendMessages, P.CreatePublicThreads, P.AddReactions] });
  }
  return ow;
}

async function ensureRole(guild, def) {
  const existing = guild.roles.cache.find((r) => r.name === def.name && !r.managed);
  if (existing) {
    logSkipped('role', def.name);
    return existing;
  }
  const role = await guild.roles.create({
    name: def.name,
    color: def.color,
    hoist: true,
    mentionable: false,
    permissions: def.perms,
    reason: 'ryuk setup',
  });
  logCreated('role', def.name);
  return role;
}

async function ensureCategory(guild, name) {
  const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (existing) {
    logSkipped('category', name);
    return existing;
  }
  const ch = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'ryuk setup' });
  logCreated('category', name);
  return ch;
}

async function ensureChannel(guild, parent, spec, roles) {
  const type = spec.voice ? ChannelType.GuildVoice : ChannelType.GuildText;
  const existing = guild.channels.cache.find((c) => c.name === spec.name && c.type === type);
  if (existing) {
    logSkipped(type === ChannelType.GuildVoice ? 'voice' : 'channel', spec.name);
    return existing;
  }
  const ch = await guild.channels.create({
    name: spec.name,
    type,
    parent,
    topic: spec.topic,
    rateLimitPerUser: spec.slowmode ?? 0,
    permissionOverwrites: overwritesFor(guild, roles, spec),
    reason: 'ryuk setup',
  });
  logCreated(type === ChannelType.GuildVoice ? 'voice' : 'channel', spec.name);
  return ch;
}

function buildEmbed(key, channels) {
  const t = TEXTS[key];
  if (!t) return null;
  let description = t.description;
  for (const [name, ch] of Object.entries(channels)) {
    description = description.replaceAll(`<#${name.toUpperCase()}_CHANNEL>`, `<#${ch.id}>`);
  }
  return { embeds: [{ title: t.title, description, color: 0xffffff }] };
}

async function postIfEmpty(channel, payload) {
  if (!payload || !channel?.isTextBased?.()) return;
  try {
    const recent = await channel.messages.fetch({ limit: 1 });
    if (recent.size > 0) return;
    await channel.send(payload);
    console.log(`  > posted  ${channel.name}`);
  } catch (err) {
    console.log(`  ! post    ${channel.name}: ${err.message}`);
  }
}

/** Reihenfolge: Rollen, Kategorien, Kanaele, Texte, Icon. */
async function run() {
  const guild = await client.guilds.fetch(guildId);
  console.log(`server: ${guild.name} (${guild.id})`);

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(P.Administrator) && !me.permissions.has(P.ManageChannels)) {
    console.error('bot needs "Manage Channels" (Administrator recommended)');
    process.exit(1);
  }

  console.log('roles');
  const roles = {};
  for (const def of ROLES) roles[def.name] = await ensureRole(guild, def);

  console.log('channels');
  const channels = {};
  for (const group of LAYOUT) {
    const parent = await ensureCategory(guild, group.name);
    for (const spec of group.channels) {
      const ch = await ensureChannel(guild, parent, spec, roles);
      channels[spec.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()] = ch;
    }
  }

  console.log('texts');
  const lookup = {
    download: channels.download,
    updates: channels.updates,
    support: channels.support,
  };
  for (const group of LAYOUT) {
    for (const spec of group.channels) {
      if (!spec.post) continue;
      const key = spec.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await postIfEmpty(channels[key], buildEmbed(spec.post, lookup));
    }
  }

  if (existsSync(iconPath)) {
    try {
      await guild.setIcon(iconPath);
      console.log('  > icon    set');
    } catch (err) {
      console.log(`  ! icon    ${err.message}`);
    }
  }

  console.log('');
  console.log(`done: ${created.length} created, ${skipped.length} already there`);
  console.log('');
  console.log('still manual (Discord has no API for these):');
  console.log('  - verification gate: Server Settings > Onboarding / Verification Level');
  console.log('  - channel order: drag categories into place');
  console.log('  - banner: Server Settings > Overview > Banner');
}

client.once('ready', () => {
  run()
    .then(() => client.destroy())
    .catch((err) => {
      console.error(err);
      client.destroy();
      process.exit(1);
    });
});

client.login(token);
