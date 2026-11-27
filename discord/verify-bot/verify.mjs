#!/usr/bin/env node
/**
 * ryuk verify bot
 *
 * Postet in #verify ein Panel (ohne Button). Rolle wird spaeter anders vergeben,
 * Rolle "Verified" geben, Log in #logs.
 *
 * Start:  node --env-file=.env verify.mjs
 *
 * ENV:
 *   DISCORD_TOKEN           bot-token (derselbe wie der ryuk Bot)
 *   DISCORD_GUILD_ID        server-id
 *   VERIFY_CHANNEL          kanal-name oder id (standard: verify)
 *   VERIFY_ROLE             rollen-name oder id (standard: Verified)
 *   LOG_CHANNEL             kanal fuer logs (standard: logs)
 *   MIN_ACCOUNT_AGE_DAYS    mindestalter des accounts in tagen (standard: 7)
 */
import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  DISCORD_GUILD_ID,
  VERIFY_CHANNEL = 'verify',
  RULES_CHANNEL = 'rules',
  RULES_ROLE = 'Rules Accepted',
  VERIFY_ROLE = 'Verified',
  LOG_CHANNEL = 'logs',
  WELCOME_CHANNEL = 'welcome',
  GOODBYE_CHANNEL = 'goodbye',
  MIN_ACCOUNT_AGE_DAYS = '7',
} = process.env;

console.log('ryuk bot v3');

const here = dirname(fileURLToPath(import.meta.url));
const statePath = join(here, 'verify-panel.json');

// Token: zuerst dieselbe Datei wie der MCP (Documents/discord-token.txt),
// sonst DISCORD_TOKEN aus der .env. Anfuehrungszeichen und ein fuehrendes
// "Bot " werden entfernt, weil das die haeufigsten Kopierfehler sind.
function cleanToken(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bot\s+/i, '')
    .trim();
}

function loadToken() {
  for (const path of [join(here, '..', 'discord-token.txt'), join(here, 'discord-token.txt')]) {
    try {
      const raw = cleanToken(readFileSync(path, 'utf8'));
      if (raw) {
        console.log(`token aus ${path}`);
        return raw;
      }
    } catch {
      // Datei fehlt -> naechste Quelle
    }
  }
  const fromEnv = cleanToken(process.env.DISCORD_TOKEN);
  if (fromEnv) console.log('token aus der Umgebung (.env / start.cmd)');
  return fromEnv;
}

const TOKEN = loadToken();

if (!TOKEN || !DISCORD_GUILD_ID) {
  console.error('missing env: DISCORD_TOKEN / DISCORD_GUILD_ID');
  process.exit(1);
}

const MIN_AGE_MS = Number(MIN_ACCOUNT_AGE_DAYS) * 24 * 60 * 60 * 1000;

// #verify - dort zaehlt jeder Button-Klick als Verify
const VERIFY_MSG_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || '1575598517781794847';

// Guilds fuer die Kanaldaten, GuildMembers fuer join-Events.
// GuildMembers ist ein privilegierter Intent: im Developer Portal unter
// Bot -> Privileged Gateway Intents -> SERVER MEMBERS INTENT einschalten.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

function findChannel(guild, ref) {
  const clean = String(ref).trim().replace(/^#/, '').toLowerCase();
  return (
    guild.channels.cache.get(clean) ??
    guild.channels.cache.find((c) => c.name.toLowerCase() === clean) ??
    guild.channels.cache.find((c) => c.name.toLowerCase().includes(clean)) ??
    null
  );
}

// #goodbye: eigener Kanal fuer Leaves
const GOODBYE_CHANNEL_ID = process.env.GOODBYE_CHANNEL_ID || '1575673077768126464';
function findGoodbye(guild) {
  return (
    guild.channels.cache.get(GOODBYE_CHANNEL_ID) ??
    findChannel(guild, GOODBYE_CHANNEL) ??
    guild.channels.cache.find((c) => c.name.toLowerCase().includes('goodbye')) ??
    null
  );
}

// #welcome: Name ODER feste ID - so findet er den Kanal immer
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '1575608950185918535';
function findWelcome(guild) {
  return (
    guild.channels.cache.get(WELCOME_CHANNEL_ID) ??
    findChannel(guild, WELCOME_CHANNEL) ??
    guild.channels.cache.find((c) => c.name.toLowerCase().includes('welcome')) ??
    null
  );
}

function findRole(guild, ref) {
  const clean = String(ref).trim().replace(/^@/, '').toLowerCase();
  return (
    guild.roles.cache.get(clean) ??
    guild.roles.cache.find((r) => r.name.toLowerCase() === clean) ??
    null
  );
}

function panelPayload() {
  const embed = {
    title: 'Verification',
    description: [
      'Once you are verified, the whole server unlocks:',
      '',
      '💬  chat + uploads',
      '💡  suggestions, reviews, feedback',
      '🔑  free key channel',
      '🔊  voice calls',
      '',
      `Your account must be at least **${MIN_ACCOUNT_AGE_DAYS} days** old.`,
    ].join('\n'),
    color: 0xffffff,
  };
  return { embeds: [embed] };
}

async function ensurePanel(guild) {
  const channel = findChannel(guild, VERIFY_CHANNEL);
  if (!channel) {
    console.error(`kanal nicht gefunden: ${VERIFY_CHANNEL}`);
    return;
  }

  const rules = findChannel(guild, 'rules');
  const payload = panelPayload();
  payload.embeds[0].description = payload.embeds[0].description.replace('<#RULES>', rules ? `<#${rules.id}>` : '#rules');

  // alles alte raus - auch panels von anderen bots/apps.
  // sonst klicken leute einen button, dessen app gar nicht laeuft ("reagiert nicht").
  try {
    const old = await channel.messages.fetch({ limit: 50 });
    for (const msg of old.values()) {
      await msg.delete().catch(() => {});
    }
    console.log(`alte nachrichten in #${channel.name} geloescht: ${old.size}`);
  } catch (err) {
    console.error(`aufraeumen fehlgeschlagen: ${err?.message || err}`);
  }

  const msg = await channel.send(payload);
  writeFileSync(statePath, JSON.stringify({ channelId: channel.id, messageId: msg.id }, null, 2));
  console.log(`panel gepostet in #${channel.name} (message ${msg.id})`);
}

// ---------------- rules / accept ----------------

const RULES_TEXT = [
  '**1.** Be respectful. No insults, racism, spam or advertising.',
  '**2.** No leaking, reselling or sharing keys or the script.',
  '**3.** No scam attempts, no fake vouches, no alt-account abuse.',
  '**4.** Staff decisions are final. Appeals belong in a ticket.',
  '**5.** Breaking a rule = mute, kick or ban without refund.',
].join('\n');

function rulesPayload() {
  return {
    embeds: [
      {
        title: 'Server rules',
        description: RULES_TEXT,
        color: 0xffffff,
        footer: { text: 'ryuk hub' },
      },
    ],
  };
}

async function ensureRulesPanel(guild) {
  const channel = findChannel(guild, RULES_CHANNEL);
  if (!channel?.isTextBased()) {
    console.error(`rules-kanal nicht gefunden (RULES_CHANNEL=${RULES_CHANNEL})`);
    return;
  }
  try {
    const old = await channel.messages.fetch({ limit: 50 });
    for (const msg of old.values()) await msg.delete().catch(() => {});
  } catch (err) {
    console.error(`rules aufraeumen fehlgeschlagen: ${err?.message || err}`);
  }
  await channel.send(rulesPayload());
  console.log(`rules-panel gepostet in #${channel.name}`);
}

async function handleRulesAccept(interaction) {
  try {
    const guild = interaction.guild;
    const role = findRole(guild, RULES_ROLE);
    if (!role) {
      await interaction.reply({ content: 'Role "Rules Accepted" is missing. Tell an admin.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    if (interaction.member.roles.cache.has(role.id)) {
      await interaction.editReply({ content: `You already accepted the rules. Head to <#1575598517781794847>.` });
      return;
    }

    await interaction.member.roles.add(role, 'rules accepted');
    await interaction.editReply({ content: `Rules accepted. Now open <#1575598517781794847> and verify.` });
    console.log(`rules accepted: ${interaction.user.tag}`);
  } catch (err) {
    console.error(`rules accept fehlgeschlagen: ${err?.message || err}`);
    try {
      const text = 'Could not accept the rules. Is the bot role above "Rules Accepted"?';
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: text });
      else await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    } catch {}
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`eingeloggt als ${c.user.tag}`);
  try {
    const guild = await c.guilds.fetch(DISCORD_GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    await ensurePanel(guild);
    await ensureRulesPanel(guild);
    console.log(`welcome-kanal: ${findWelcome(guild)?.name ?? 'NICHT GEFUNDEN'}`);
    console.log(`goodbye-kanal: ${findGoodbye(guild)?.name ?? 'NICHT GEFUNDEN'}`);
    console.log('bereit');
  } catch (err) {
    console.error(`setup fehlgeschlagen: ${err.message}`);
  }
});

// Join-Karte: Avatar + Name + Profil-Infos
client.on(Events.GuildMemberAdd, async (member) => {
  console.log(`join: ${member.user.tag}`);
  try {
    const channel = findWelcome(member.guild);
    if (!channel?.isTextBased()) {
      console.error(`welcome-kanal nicht gefunden (WELCOME_CHANNEL=${WELCOME_CHANNEL})`);
      return;
    }

    const created = Math.floor(member.user.createdTimestamp / 1000);
    const name = member.displayName || member.user.username;

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [
        {
          color: 0xffffff,
          description: [
            `**Welcome to ryuk hub, ${name}**`,
            '',
            `You are member **#${member.guild.memberCount}**.`,
            `Read <#1575599573060161708> and get verified in <#1575598517781794847>.`,
          ].join('\n'),
          thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
          fields: [
            { name: 'User', value: `${member.user.tag}`, inline: true },
            { name: 'Account created', value: `<t:${created}:R>`, inline: true },
          ],
          footer: { text: 'ryuk hub' },
        },
      ],
      allowedMentions: { parse: ['users'] },
    });
  } catch (err) {
    console.error(`welcome fehlgeschlagen: ${err.message}`);
  }
});

// Leave-Karte: "goodbye <name>" + Profil
client.on(Events.GuildMemberRemove, async (member) => {
  console.log(`leave: ${member.user.tag}`);
  try {
    const channel = findGoodbye(member.guild);
    if (!channel?.isTextBased()) {
      console.error(`goodbye-kanal nicht gefunden (GOODBYE_CHANNEL=${GOODBYE_CHANNEL})`);
      return;
    }

    const name = member.displayName || member.user.username;
    const joined = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
    const stayed = member.joinedTimestamp
      ? Math.max(1, Math.round((Date.now() - member.joinedTimestamp) / 3600000))
      : null;

    const fields = [{ name: 'User', value: member.user.tag, inline: true }];
    if (joined) fields.push({ name: 'Joined', value: `<t:${joined}:R>`, inline: true });
    if (stayed !== null) fields.push({ name: 'Stayed', value: `${stayed} h`, inline: true });

    await channel.send({
      embeds: [
        {
          color: 0x2b2d31,
          description: `**goodbye ${name}**\nLeft the server.`,
          thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
          fields,
          footer: { text: `Members now: ${member.guild.memberCount}` },
        },
      ],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`goodbye fehlgeschlagen: ${err.message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // jede interaction einmal loggen - so sieht man sofort, ob der klick ankommt
  console.log(`interaction: type=${interaction.type} id=${interaction.customId ?? '-'} user=${interaction.user?.tag ?? '?'}`);
  if (!interaction.isButton()) return;
  if (interaction.customId === 'rules_accept') {
    await handleRulesAccept(interaction);
    return;
  }
  // jeder Button im #verify-Kanal zaehlt - auch ein alter Panel-Button
  if (interaction.customId !== 'verify_accept' && interaction.channelId !== VERIFY_MSG_CHANNEL_ID) {
    console.log(`  -> fremder button (${interaction.customId}) in ${interaction.channelId}, ignoriert`);
    return;
  }

  try {
    const guild = interaction.guild;
    if (!guild || !interaction.member) return;

    // discord gibt nur 3 sekunden - sofort bestaetigen, dann antworten
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    const say = (text) => interaction.editReply({ content: text });

    const rulesRole = findRole(guild, RULES_ROLE);
    if (rulesRole && !interaction.member.roles.cache.has(rulesRole.id)) {
      return say('Accept the rules in <#1575599573060161708> first, then come back.');
    }

    const role = findRole(guild, VERIFY_ROLE);
    if (!role) return say('Verified role is missing. Tell an admin.');

    const member = interaction.member;
    if (member.roles.cache.has(role.id)) return say('You are already verified.');

    const ageMs = Date.now() - interaction.user.createdTimestamp;
    if (ageMs < MIN_AGE_MS) {
      const days = Math.ceil((MIN_AGE_MS - ageMs) / (24 * 60 * 60 * 1000));
      return say(`Your account is too new. Try again in **${days} day${days === 1 ? '' : 's'}**.`);
    }

    await member.roles.add(role, 'verification');
    await say('Verified. Welcome to the server.');

    const log = findChannel(guild, LOG_CHANNEL);
    if (log?.isTextBased()) {
      const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      await log.send(`✅ <@${interaction.user.id}> verified (account age ${days} days)`).catch(() => {});
    }
  } catch (err) {
    console.error(`verify fehlgeschlagen: ${err?.message || err}`);
    try {
      const text = 'Could not verify. Check that the bot role is above Verified, then try again.';
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: text });
      else await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    } catch {}
  }
});

process.on('unhandledRejection', (err) => console.error(`unhandledRejection: ${err?.message || err}`));
process.on('uncaughtException', (err) => console.error(`uncaughtException: ${err?.message || err}`));

// ---- login (muss am ende stehen, sonst beendet sich der prozess sofort) ----
console.log('verbinde mit discord...');
client.login(TOKEN).catch((err) => {
  console.error(`login fehlgeschlagen: ${err?.message || err}`);
  console.error(`code=${err?.code || '-'} status=${err?.status || '-'}`);
  process.exit(1);
});
