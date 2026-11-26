#!/usr/bin/env node
/**
 * ryuk verify bot
 *
 * Postet in #verify ein Panel mit Button. Klick = Account-Alter pruefen,
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
import { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  DISCORD_GUILD_ID,
  VERIFY_CHANNEL = 'verify',
  VERIFY_ROLE = 'Verified',
  LOG_CHANNEL = 'logs',
  WELCOME_CHANNEL = 'welcome',
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
      'Read <#RULES> first.',
      '',
      'Click **Verify** below to get access to the server.',
      `Your account must be at least **${MIN_ACCOUNT_AGE_DAYS} days** old.`,
    ].join('\n'),
    color: 0xffffff,
  };
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_accept').setLabel('Verify').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
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

  let saved = null;
  if (existsSync(statePath)) {
    try { saved = JSON.parse(readFileSync(statePath, 'utf8')); } catch { saved = null; }
  }

  if (saved?.channelId === channel.id && saved?.messageId) {
    try {
      const msg = await channel.messages.fetch(saved.messageId);
      await msg.edit(payload);
      console.log(`panel aktualisiert in #${channel.name}`);
      return;
    } catch {
      // nachricht weg -> neu posten
    }
  }

  const msg = await channel.send(payload);
  writeFileSync(statePath, JSON.stringify({ channelId: channel.id, messageId: msg.id }, null, 2));
  console.log(`panel gepostet in #${channel.name}`);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`eingeloggt als ${c.user.tag}`);
  try {
    const guild = await c.guilds.fetch(DISCORD_GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    await ensurePanel(guild);
    console.log('bereit');
  } catch (err) {
    console.error(`setup fehlgeschlagen: ${err.message}`);
  }
});

// Join-Karte: Avatar + Anzeigename, sonst nichts.
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const channel = findChannel(member.guild, WELCOME_CHANNEL);
    if (!channel?.isTextBased()) return;
    const message = await channel.send({
      embeds: [
        {
          color: 0xffffff,
          description: `Welcome to **ryuk hub**, **${member.displayName}**`,
          thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
        },
      ],
    });

    try {
      await message.pin('welcome');
    } catch (err) {
      // 30003 = 50 Pins voll. Dann die aelteste eigene Karte loesen und neu pinnen.
      if (err.code === 30003) {
        const pinned = await channel.messages.fetchPinned();
        const oldest = pinned.filter((m) => m.author.id === client.user.id).last();
        if (oldest) await oldest.unpin().catch(() => {});
        await message.pin('welcome').catch(() => {});
      }
    }
  } catch (err) {
    console.error(`welcome fehlgeschlagen: ${err.message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== 'verify_accept') return;

  const guild = interaction.guild;
  if (!guild) return;

  const role = findRole(guild, VERIFY_ROLE);
  if (!role) {
    await interaction.reply({ content: 'Verified role is missing. Tell an admin.', flags: MessageFlags.Ephemeral });
    return;
  }

  const member = interaction.member;
  if (member.roles.cache.has(role.id)) {
    await interaction.reply({ content: 'You are already verified.', flags: MessageFlags.Ephemeral });
    return;
  }

  const ageMs = Date.now() - interaction.user.createdTimestamp;
  if (ageMs < MIN_AGE_MS) {
    const days = Math.ceil((MIN_AGE_MS - ageMs) / (24 * 60 * 60 * 1000));
    await interaction.reply({
      content: `Your account is too new. Try again in **${days} day${days === 1 ? '' : 's'}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await member.roles.add(role, 'verification');
    await interaction.reply({ content: 'Verified. Welcome to the server.', flags: MessageFlags.Ephemeral });

    const log = findChannel(guild, LOG_CHANNEL);
    if (log?.isTextBased()) {
      const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      await log.send(`✅ <@${interaction.user.id}> verified (account age ${days} days)`).catch(() => {});
    }
  } catch (err) {
    console.error(err);
    await interaction.reply({
      content: 'Could not assign the role. Check that the bot role is above Verified.',
      flags: MessageFlags.Ephemeral,
    });
  }
});

client.login(TOKEN);
