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

const API = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_TOKEN ?? '';
const DEFAULT_GUILD = process.env.DISCORD_GUILD_ID ?? '';
const PROTOCOL = '2024-11-05';

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const log = (...args) => console.error('[discord-mcp]', ...args);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body } = {}) {
  if (!TOKEN) throw new Error('DISCORD_TOKEN fehlt in der MCP-Konfiguration');
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
];

const F = {
  ViewChannel: 1024n,
  SendMessages: 2048n,
  ReadMessageHistory: 65536n,
};
const bits = (...list) => list.reduce((a, b) => a | b, 0n).toString();

async function staffRoleIds(guildId) {
  const roles = await api(`/guilds/${guildId}/roles`);
  return roles
    .filter((r) => ['Owner', 'Admin', 'Moderator', 'Helper'].includes(r.name))
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
      if (args.private) {
        overwrites.push({ id: everyone, type: 0, deny: bits(F.ViewChannel) });
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
