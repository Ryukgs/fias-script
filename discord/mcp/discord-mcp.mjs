#!/usr/bin/env node
/**
 * discord-mcp - ein MCP-server mit schreib-rechten fuer discord
 *
 * Laeuft ohne dependencies (nur node 18+). Spricht MCP ueber stdio und
 * ruft die Discord-REST-API mit einem Bot-Token auf.
 *
 * Token kommt aus der Umgebung, nie aus einer Datei im repo:
 *   DISCORD_TOKEN=...   (bot-token, bot muss im server sein)
 *   DISCORD_GUILD_ID=... (optional, standard-server)
 *
 * Tools:
 *   discord_list_channels
 *   discord_create_category
 *   discord_create_channel
 *   discord_rename_channel
 *   discord_move_channel
 *   discord_delete_channel
 *   discord_create_role
 *   discord_send_message
 */
import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://discord.com/api/v10';
const DEFAULT_GUILD = process.env.DISCORD_GUILD_ID ?? '';
const PROTOCOL = '2024-11-05';

// Token: erst discord-token.txt neben dieser Datei, sonst DISCORD_TOKEN.
// Die Datei wird bei jedem Aufruf neu gelesen, ein Token-Wechsel braucht
// also keinen Neustart des MCP mehr.
const TOKEN_FILE = process.env.DISCORD_TOKEN_FILE || join(dirname(fileURLToPath(import.meta.url)), 'discord-token.txt');
function token() {
  try {
    const fromFile = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (fromFile) return fromFile;
  } catch {
    // keine Datei -> env
  }
  return (process.env.DISCORD_TOKEN ?? '').trim();
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const log = (...args) => console.error('[discord-mcp]', ...args);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body } = {}) {
  const TOKEN = token();
  if (!TOKEN) throw new Error(`Token fehlt: ${TOKEN_FILE} anlegen oder DISCORD_TOKEN setzen`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const info = await res.json().catch(() => ({}));
      await sleep(Math.ceil((info.retry_after ?? 1) * 1000) + 150);
      continue;
    }
    const raw = await res.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = raw; }
    }
    if (!res.ok) {
      const message = (data && data.message) || raw.slice(0, 200) || res.statusText;
      throw new Error(`discord ${res.status}: ${message}`);
    }
    return data;
  }
  throw new Error('discord rate limit');
}

function guildOf(args) {
  const id = args.guild_id || DEFAULT_GUILD;
  if (!id) throw new Error('guild_id fehlt (argument oder DISCORD_GUILD_ID)');
  return id;
}

async function findChannel(guildId, ref) {
  if (!ref) return null;
  const clean = String(ref).trim().replace(/^#/, '');
  const all = await api(`/guilds/${guildId}/channels`);
  const lower = clean.toLowerCase();
  return (
    all.find((c) => c.id === clean) ??
    all.find((c) => c.name.toLowerCase() === lower) ??
    all.find((c) => c.name.toLowerCase().includes(lower)) ??
    null
  );
}

const TYPE = { text: 0, voice: 2, announcement: 5 };

const TOOLS = [
  {
    name: 'discord_list_channels',
    description: 'Alle Kategorien und Kanaele eines Servers mit Typ und ID.',
    inputSchema: {
      type: 'object',
      properties: { guild_id: { type: 'string', description: 'Server-ID, optional' } },
      additionalProperties: false,
    },
  },
  {
    name: 'discord_create_category',
    description: 'Legt eine Kategorie an.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, guild_id: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_create_channel',
    description: 'Legt einen Kanal an (text, voice oder announcement).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['text', 'voice', 'announcement'] },
        category: { type: 'string', description: 'Kategorie-Name oder ID, optional' },
        topic: { type: 'string' },
        read_only: { type: 'boolean' },
        private: { type: 'boolean' },
        verified_only: { type: 'boolean', description: 'Nur Verified (und Staff) sehen den Kanal' },
        role: { type: 'string', description: 'Mit verified_only: diese Rolle statt Verified (Name oder ID)' },
        slowmode: { type: 'number' },
        guild_id: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_rename_channel',
    description: 'Benennt einen Kanal oder eine Kategorie um.',
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, name: { type: 'string' }, guild_id: { type: 'string' } },
      required: ['channel', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_move_channel',
    description: 'Verschiebt einen Kanal in eine Kategorie (leer = aus der Kategorie).',
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, category: { type: 'string' }, guild_id: { type: 'string' } },
      required: ['channel'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_delete_channel',
    description: 'Loescht einen Kanal.',
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, guild_id: { type: 'string' } },
      required: ['channel'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_create_role',
    description: 'Legt eine Rolle an.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        color: { type: 'string', description: 'Hex wie #ffffff, optional' },
        hoist: { type: 'boolean' },
        guild_id: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_send_message',
    description: 'Schreibt eine Nachricht in einen Kanal.',
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, text: { type: 'string' }, guild_id: { type: 'string' } },
      required: ['channel', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_edit_message',
    description: 'Aendert den Text einer bestehenden Nachricht.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        message_id: { type: 'string' },
        text: { type: 'string' },
        guild_id: { type: 'string' },
      },
      required: ['channel', 'message_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_delete_message',
    description: 'Loescht eine Nachricht.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        message_id: { type: 'string' },
        guild_id: { type: 'string' },
      },
      required: ['channel', 'message_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_list_roles',
    description: 'Alle Rollen eines Servers mit Rechten und Position.',
    inputSchema: {
      type: 'object',
      properties: { guild_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'discord_create_role_full',
    description: 'Legt eine Rolle mit Rechten an (permissions als Liste von Namen, z. B. ["ViewChannel","SendMessages"]).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        color: { type: 'string' },
        hoist: { type: 'boolean' },
        mentionable: { type: 'boolean' },
        permissions: { type: 'array', items: { type: 'string' } },
        guild_id: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_edit_role',
    description: 'Aendert Name, Farbe oder Rechte einer Rolle (permissions als Liste von Namen).',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Rollen-Name oder ID' },
        name: { type: 'string' },
        color: { type: 'string' },
        hoist: { type: 'boolean' },
        permissions: { type: 'array', items: { type: 'string' } },
        guild_id: { type: 'string' },
      },
      required: ['role'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_delete_role',
    description: 'Loescht eine Rolle (Name oder ID).',
    inputSchema: {
      type: 'object',
      properties: { role: { type: 'string' }, guild_id: { type: 'string' } },
      required: ['role'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_create_automod_rule',
    description: 'Legt eine AutoMod-Regel an. trigger: keyword | spam | mentions | preset. preset 1=profanity 2=sexual 3=slurs.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        trigger: { type: 'string', enum: ['keyword', 'spam', 'mentions', 'preset'] },
        keywords: { type: 'array', items: { type: 'string' } },
        presets: { type: 'array', items: { type: 'number' } },
        mention_limit: { type: 'number' },
        alert_channel: { type: 'string' },
        timeout_seconds: { type: 'number', description: '0 = kein Timeout' },
        guild_id: { type: 'string' },
      },
      required: ['name', 'trigger'],
      additionalProperties: false,
    },
  },
  {
    name: 'discord_list_automod_rules',
    description: 'Listet die AutoMod-Regeln des Servers.',
    inputSchema: {
      type: 'object',
      properties: { guild_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'discord_set_guild_security',
    description: 'Setzt Verifizierungsstufe und Medienfilter. verification_level: none|low|medium|high|highest, content_filter: disabled|members_without_roles|all_members.',
    inputSchema: {
      type: 'object',
      properties: {
        verification_level: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'highest'] },
        content_filter: { type: 'string', enum: ['disabled', 'members_without_roles', 'all_members'] },
        guild_id: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'discord_create_template',
    description: 'Erstellt ein Server-Template als Backup des aktuellen Aufbaus.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, description: { type: 'string' }, guild_id: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

const F = {
  ViewChannel: 1024n,
  SendMessages: 2048n,
  ReadMessageHistory: 65536n,
};
const bits = (...list) => list.reduce((a, b) => a | b, 0n).toString();

const PERMS = {
  CreateInstantInvite: 1n, KickMembers: 2n, BanMembers: 4n, Administrator: 8n, ManageChannels: 16n,
  ManageGuild: 32n, AddReactions: 64n, ViewAuditLog: 128n, PrioritySpeaker: 256n, Stream: 512n,
  ViewChannel: 1024n, SendMessages: 2048n, ManageMessages: 8192n, EmbedLinks: 16384n,
  AttachFiles: 32768n, ReadMessageHistory: 65536n, MentionEveryone: 131072n, UseExternalEmojis: 262144n,
  Connect: 1048576n, Speak: 2097152n, MuteMembers: 4194304n, DeafenMembers: 8388608n,
  MoveMembers: 16777216n, UseVAD: 33554432n, ChangeNickname: 67108864n, ManageNicknames: 134217728n,
  ManageRoles: 268435456n, ManageWebhooks: 536870912n, ManageEmojisAndStickers: 1073741824n,
  ManageGuildExpressions: 1073741824n, UseApplicationCommands: 2147483648n, ManageEvents: 8589934592n,
  ModerateMembers: 1099511627776n, CreatePublicThreads: 34359738368n, CreatePrivateThreads: 68719476736n,
  SendMessagesInThreads: 274877906944n,
};

function permsToBits(names) {
  let out = 0n;
  for (const name of names) {
    const bit = PERMS[name];
    if (bit === undefined) throw new Error(`unbekannte permission: ${name}`);
    out |= bit;
  }
  return out.toString();
}

async function findRole(guildId, ref) {
  const clean = String(ref).trim().replace(/^@/, '');
  const roles = await api(`/guilds/${guildId}/roles`);
  const lower = clean.toLowerCase();
  return (
    roles.find((r) => r.id === clean) ??
    roles.find((r) => r.name.toLowerCase() === lower) ??
    null
  );
}

async function staffRoleIds(guildId) {
  const roles = await api(`/guilds/${guildId}/roles`);
  return roles
    .filter((r) => ['Owner', 'Admin', 'Moderator', 'Helper', 'Staff'].includes(r.name))
    .map((r) => r.id);
}

async function callTool(name, args = {}) {
  const guildId = guildOf(args);

  switch (name) {
    case 'discord_list_channels': {
      const all = await api(`/guilds/${guildId}/channels`);
      const lines = all
        .sort((a, b) => a.position - b.position)
        .map((c) => {
          const type = c.type === 4 ? 'category' : c.type === 2 ? 'voice' : c.type === 5 ? 'announcement' : 'text';
          const parent = all.find((p) => p.id === c.parent_id);
          return `${type.padEnd(12)} ${c.name}  (${c.id})${parent ? `  in ${parent.name}` : ''}`;
        });
      return lines.join('\n');
    }

    case 'discord_create_category': {
      const ch = await api(`/guilds/${guildId}/channels`, { method: 'POST', body: { name: args.name, type: 4 } });
      return `Kategorie angelegt: ${ch.name} (${ch.id})`;
    }

    case 'discord_create_channel': {
      const type = TYPE[args.type ?? 'text'] ?? 0;
      let parentId;
      if (args.category) {
        const parent = await findChannel(guildId, args.category);
        if (parent && parent.type === 4) parentId = parent.id;
      }

      const overwrites = [];
      const everyone = guildId; // @everyone traegt die server-id als rollen-id
      const staff = await staffRoleIds(guildId);
      const roles = await api(`/guilds/${guildId}/roles`);
      const wantedRole = args.role ? String(args.role).replace(/^@/, '').toLowerCase() : '';
      const verified = wantedRole
        ? roles.find((r) => r.name.toLowerCase() === wantedRole) ?? null
        : roles.find((r) => r.name === 'Verified');

      if (args.private) {
        overwrites.push({ id: everyone, type: 0, deny: bits(F.ViewChannel) });
        for (const id of staff) overwrites.push({ id, type: 0, allow: bits(F.ViewChannel, F.SendMessages, F.ReadMessageHistory) });
      } else if (args.verified_only) {
        overwrites.push({ id: everyone, type: 0, deny: bits(F.ViewChannel) });
        if (verified) {
          overwrites.push({
            id: verified.id,
            type: 0,
            allow: bits(F.ViewChannel, F.ReadMessageHistory),
            deny: args.read_only ? bits(F.SendMessages) : undefined,
          });
        }
        for (const id of staff) overwrites.push({ id, type: 0, allow: bits(F.ViewChannel, F.SendMessages, F.ReadMessageHistory) });
      } else if (args.read_only) {
        overwrites.push({ id: everyone, type: 0, allow: bits(F.ViewChannel, F.ReadMessageHistory), deny: bits(F.SendMessages) });
        for (const id of staff) overwrites.push({ id, type: 0, allow: bits(F.SendMessages) });
      }

      const body = {
        name: args.name,
        type,
        parent_id: parentId,
        topic: type === 0 ? args.topic : undefined,
        rate_limit_per_user: type === 0 ? (args.slowmode ?? 0) : undefined,
        permission_overwrites: overwrites,
      };

      try {
        const ch = await api(`/guilds/${guildId}/channels`, { method: 'POST', body });
        return `Kanal angelegt: ${ch.name} (${ch.id})${parentId ? ' in Kategorie' : ''}`;
      } catch (err) {
        if (type === 5) {
          const ch = await api(`/guilds/${guildId}/channels`, { method: 'POST', body: { ...body, type: 0 } });
          return `Kanal angelegt: ${ch.name} (${ch.id}) - announcement nicht verfuegbar, als text`;
        }
        throw err;
      }
    }

    case 'discord_rename_channel': {
      const ch = await findChannel(guildId, args.channel);
      if (!ch) throw new Error(`Kanal nicht gefunden: ${args.channel}`);
      const updated = await api(`/channels/${ch.id}`, { method: 'PATCH', body: { name: args.name } });
      return `Umbenannt: ${ch.name} -> ${updated.name}`;
    }

    case 'discord_move_channel': {
      const ch = await findChannel(guildId, args.channel);
      if (!ch) throw new Error(`Kanal nicht gefunden: ${args.channel}`);
      let parentId = null;
      let parentName = 'keine Kategorie';
      if (args.category) {
        const parent = await findChannel(guildId, args.category);
        if (!parent || parent.type !== 4) throw new Error(`Kategorie nicht gefunden: ${args.category}`);
        parentId = parent.id;
        parentName = parent.name;
      }
      await api(`/channels/${ch.id}`, { method: 'PATCH', body: { parent_id: parentId } });
      return `Verschoben: ${ch.name} -> ${parentName}`;
    }

    case 'discord_delete_channel': {
      const ch = await findChannel(guildId, args.channel);
      if (!ch) throw new Error(`Kanal nicht gefunden: ${args.channel}`);
      await api(`/channels/${ch.id}`, { method: 'DELETE' });
      return `Geloescht: ${ch.name}`;
    }

    case 'discord_create_role': {
      const color = args.color ? Number.parseInt(String(args.color).replace('#', ''), 16) : undefined;
      const role = await api(`/guilds/${guildId}/roles`, {
        method: 'POST',
        body: { name: args.name, color, hoist: args.hoist ?? false },
      });
      return `Rolle angelegt: ${role.name} (${role.id})`;
    }

    case 'discord_send_message': {
      const ch = await findChannel(guildId, args.channel);
      if (!ch) throw new Error(`Kanal nicht gefunden: ${args.channel}`);
      const msg = await api(`/channels/${ch.id}/messages`, { method: 'POST', body: { content: args.text } });
      return `Nachricht gesendet in #${ch.name} (${msg.id})`;
    }

    case 'discord_edit_message': {
      const ch = await findChannel(guildId, args.channel);
      if (!ch) throw new Error(`Kanal nicht gefunden: ${args.channel}`);
      const msg = await api(`/channels/${ch.id}/messages/${args.message_id}`, {
        method: 'PATCH',
        body: { content: args.text },
      });
      return `Nachricht bearbeitet (${msg.id})`;
    }

    case 'discord_delete_message': {
      const ch = await findChannel(guildId, args.channel);
      if (!ch) throw new Error(`Kanal nicht gefunden: ${args.channel}`);
      await api(`/channels/${ch.id}/messages/${args.message_id}`, { method: 'DELETE' });
      return `Nachricht geloescht (${args.message_id})`;
    }

    case 'discord_list_roles': {
      const roles = await api(`/guilds/${guildId}/roles`);
      return roles
        .sort((a, b) => b.position - a.position)
        .map((r) => `${r.name}  (${r.id})  pos ${r.position}  perms ${r.permissions}  hoist ${r.hoist}`)
        .join('\n');
    }

    case 'discord_create_role_full': {
      const perms = permsToBits(args.permissions ?? []);
      const color = args.color ? Number.parseInt(String(args.color).replace('#', ''), 16) : undefined;
      const role = await api(`/guilds/${guildId}/roles`, {
        method: 'POST',
        body: {
          name: args.name,
          color,
          hoist: args.hoist ?? false,
          mentionable: args.mentionable ?? false,
          permissions: perms,
        },
      });
      return `Rolle angelegt: ${role.name} (${role.id}) perms ${role.permissions}`;
    }

    case 'discord_edit_role': {
      const role = await findRole(guildId, args.role);
      if (!role) throw new Error(`Rolle nicht gefunden: ${args.role}`);
      const body = {};
      if (args.name) body.name = args.name;
      if (args.color) body.color = Number.parseInt(String(args.color).replace('#', ''), 16);
      if (args.hoist !== undefined) body.hoist = args.hoist;
      if (args.permissions) body.permissions = permsToBits(args.permissions);
      const updated = await api(`/guilds/${guildId}/roles/${role.id}`, { method: 'PATCH', body });
      return `Rolle geaendert: ${updated.name} (${updated.id}) perms ${updated.permissions}`;
    }

    case 'discord_delete_role': {
      const role = await findRole(guildId, args.role);
      if (!role) throw new Error(`Rolle nicht gefunden: ${args.role}`);
      await api(`/guilds/${guildId}/roles/${role.id}`, { method: 'DELETE' });
      return `Rolle geloescht: ${role.name}`;
    }

    case 'discord_create_automod_rule': {
      const trigger = args.trigger;
      let triggerType;
      let metadata = {};
      if (trigger === 'keyword') {
        triggerType = 1;
        metadata = { keyword_filter: args.keywords ?? [] };
      } else if (trigger === 'spam') {
        triggerType = 3;
      } else if (trigger === 'mentions') {
        triggerType = 5;
        metadata = { mention_total_limit: args.mention_limit ?? 6 };
      } else if (trigger === 'preset') {
        triggerType = 4;
        metadata = { presets: args.presets ?? [1] };
      } else {
        throw new Error(`unbekannter trigger: ${trigger}`);
      }

      const actions = [{ type: 1 }];
      if (args.alert_channel) {
        const ch = await findChannel(guildId, args.alert_channel);
        if (ch) actions.push({ type: 2, metadata: { channel_id: ch.id } });
      }
      if (args.timeout_seconds && args.timeout_seconds > 0) {
        actions.push({ type: 3, metadata: { duration_seconds: args.timeout_seconds } });
      }

      const rule = await api(`/guilds/${guildId}/auto-moderation/rules`, {
        method: 'POST',
        body: {
          name: args.name,
          event_type: 1,
          trigger_type: triggerType,
          trigger_metadata: metadata,
          actions,
          enabled: true,
        },
      });
      return `AutoMod-Regel angelegt: ${rule.name} (${rule.id})`;
    }

    case 'discord_list_automod_rules': {
      const rules = await api(`/guilds/${guildId}/auto-moderation/rules`);
      if (!rules.length) return 'keine Regeln';
      return rules.map((r) => `${r.name} (${r.id}) trigger ${r.trigger_type} enabled ${r.enabled}`).join('\n');
    }

    case 'discord_set_guild_security': {
      const levels = { none: 0, low: 1, medium: 2, high: 3, highest: 4 };
      const filters = { disabled: 0, members_without_roles: 1, all_members: 2 };
      const body = {};
      if (args.verification_level) {
        if (!(args.verification_level in levels)) throw new Error('verification_level ungueltig');
        body.verification_level = levels[args.verification_level];
      }
      if (args.content_filter) {
        if (!(args.content_filter in filters)) throw new Error('content_filter ungueltig');
        body.explicit_content_filter = filters[args.content_filter];
      }
      const guild = await api(`/guilds/${guildId}`, { method: 'PATCH', body });
      return `gesetzt: verification ${guild.verification_level}, filter ${guild.explicit_content_filter}`;
    }

    case 'discord_create_template': {
      const t = await api(`/guilds/${guildId}/templates`, {
        method: 'POST',
        body: { name: args.name, description: args.description ?? '' },
      });
      return `Template: https://discord.new/${t.code}`;
    }

    default:
      throw new Error(`unbekanntes Tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// MCP ueber stdio
// ---------------------------------------------------------------------------
function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'discord-mcp', version: '1.0.0' },
      },
    };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    return callTool(name, args)
      .then((text) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } }))
      .catch((err) => ({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Fehler: ${err.message}` }], isError: true },
      }));
  }

  if (id === undefined) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }

  Promise.resolve(handle(msg))
    .then((reply) => { if (reply) send(reply); })
    .catch((err) => {
      log(err.message);
      if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
    });
});

log('ready', TOKEN ? '(token gesetzt)' : '(kein token)');
