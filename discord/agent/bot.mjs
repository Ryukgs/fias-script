#!/usr/bin/env node
/**
 * ryuk agent - discord bot, mit dem du normal im chat redest
 *
 * Du schreibst, der bot baut. Keine commands, keine syntax.
 * Er kann kategorien, kanaele und rollen anlegen, umbenennen, verschieben
 * und loeschen.
 *
 * Start:   node --env-file=.env bot.mjs
 *
 * ENV: DISCORD_TOKEN, OWNER_DISCORD_ID, DISCORD_GUILD_ID,
 *      OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, AGENT_CHANNEL
 */
import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  PermissionsBitField,
} from 'discord.js';

const {
  DISCORD_TOKEN,
  OWNER_DISCORD_ID,
  DISCORD_GUILD_ID,
  OPENAI_API_KEY,
  OPENAI_BASE_URL = 'https://freebuff.com/api/v1/paid',
  OPENAI_MODEL = 'gpt-4o-mini',
  OPENAI_FALLBACK_MODELS = '',
  AGENT_CHANNEL = 'bot-chat',
} = process.env;

for (const [key, value] of Object.entries({ DISCORD_TOKEN, OWNER_DISCORD_ID, DISCORD_GUILD_ID, OPENAI_API_KEY })) {
  if (!value) {
    console.error(`missing env: ${key}`);
    process.exit(1);
  }
}

const F = PermissionsBitField.Flags;
const MAX_STEPS = 8;
const MAX_HISTORY = 24;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_channels',
      description: 'Listet alle Kategorien und Kanaele des Servers mit Typ und ID.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_category',
      description: 'Legt eine neue Kategorie an.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Name der Kategorie' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_channel',
      description: 'Legt einen Kanal an. type: text, voice oder announcement.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['text', 'voice', 'announcement'] },
          category: { type: 'string', description: 'Name der Kategorie, optional' },
          topic: { type: 'string' },
          read_only: { type: 'boolean', description: 'Nur Staff darf schreiben' },
          private: { type: 'boolean', description: 'Nur Staff sieht den Kanal' },
          slowmode: { type: 'number', description: 'Sekunden zwischen Nachrichten' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_channel',
      description: 'Benennt einen Kanal oder eine Kategorie um.',
      parameters: {
        type: 'object',
        properties: { channel: { type: 'string' }, name: { type: 'string' } },
        required: ['channel', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_channel',
      description: 'Verschiebt einen Kanal in eine Kategorie.',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          category: { type: 'string', description: 'Leer lassen, um aus der Kategorie zu nehmen' },
        },
        required: ['channel'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_channel',
      description: 'Loescht einen Kanal. Nur nach ausdruecklicher Bestaetigung des Nutzers.',
      parameters: {
        type: 'object',
        properties: { channel: { type: 'string' }, confirm: { type: 'boolean' } },
        required: ['channel', 'confirm'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_role',
      description: 'Legt eine Rolle an.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          color: { type: 'string', description: 'Hex wie #ffffff, optional' },
          hoist: { type: 'boolean', description: 'Rolle in der Mitgliederliste trennen' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
];

function findGuildChannel(guild, ref) {
  if (!ref) return null;
  const raw = String(ref).trim();
  const clean = raw.replace(/^#/, '');
  const byId = guild.channels.cache.get(clean);
  if (byId) return byId;

  const lower = clean.toLowerCase();
  return (
    guild.channels.cache.find((c) => c.name.toLowerCase() === lower) ??
    guild.channels.cache.find((c) => c.name.toLowerCase().includes(lower)) ??
    guild.channels.cache.find((c) => c.id === raw) ??
    null
  );
}

function findCategory(guild, ref) {
  const ch = findGuildChannel(guild, ref);
  return ch && ch.type === ChannelType.GuildCategory ? ch : null;
}

const TYPE_MAP = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
};

function overwritesFor(guild, args) {
  const everyone = guild.roles.everyone;
  const out = [];
  const staffIds = guild.roles.cache
    .filter((r) => ['Owner', 'Admin', 'Moderator', 'Helper'].includes(r.name))
    .map((r) => r.id);

  if (args.private) {
    out.push({ id: everyone.id, deny: [F.ViewChannel] });
    for (const id of staffIds) out.push({ id, allow: [F.ViewChannel, F.SendMessages, F.ReadMessageHistory] });
  } else if (args.read_only) {
    out.push({ id: everyone.id, allow: [F.ViewChannel, F.ReadMessageHistory], deny: [F.SendMessages] });
    for (const id of staffIds) out.push({ id, allow: [F.SendMessages] });
  }
  return out;
}

async function execTool(guild, name, rawArgs) {
  const args = rawArgs ? JSON.parse(rawArgs) : {};

  switch (name) {
    case 'list_channels': {
      const list = guild.channels.cache
        .sorted((a, b) => a.position - b.position)
        .map((c) => {
          const type = c.type === ChannelType.GuildCategory ? 'category'
            : c.type === ChannelType.GuildVoice ? 'voice'
              : c.type === ChannelType.GuildAnnouncement ? 'announcement' : 'text';
          return { name: c.name, type, id: c.id, parent: c.parent?.name ?? null };
        });
      return { ok: true, channels: list };
    }

    case 'create_category': {
      const ch = await guild.channels.create({ name: args.name, type: ChannelType.GuildCategory });
      return { ok: true, created: ch.name, id: ch.id };
    }

    case 'create_channel': {
      const type = TYPE_MAP[args.type ?? 'text'] ?? ChannelType.GuildText;
      const parent = args.category ? findCategory(guild, args.category) : null;
      const body = {
        name: args.name,
        type,
        parent: parent?.id,
        topic: type === ChannelType.GuildText ? args.topic : undefined,
        rateLimitPerUser: type === ChannelType.GuildText ? (args.slowmode ?? 0) : undefined,
        permissionOverwrites: overwritesFor(guild, args),
      };
      let ch;
      try {
        ch = await guild.channels.create(body);
      } catch (err) {
        if (type === ChannelType.GuildAnnouncement) {
          ch = await guild.channels.create({ ...body, type: ChannelType.GuildText });
          return { ok: true, created: ch.name, id: ch.id, note: 'announcement not available, created as text' };
        }
        throw err;
      }
      return { ok: true, created: ch.name, id: ch.id, parent: parent?.name ?? null };
    }

    case 'rename_channel': {
      const ch = findGuildChannel(guild, args.channel);
      if (!ch) return { ok: false, error: `channel not found: ${args.channel}` };
      await ch.setName(args.name);
      return { ok: true, renamed: args.name, id: ch.id };
    }

    case 'move_channel': {
      const ch = findGuildChannel(guild, args.channel);
      if (!ch) return { ok: false, error: `channel not found: ${args.channel}` };
      const parent = args.category ? findCategory(guild, args.category) : null;
      await ch.setParent(parent?.id ?? null, { lockPermissions: false });
      return { ok: true, moved: ch.name, into: parent?.name ?? null };
    }

    case 'delete_channel': {
      if (!args.confirm) return { ok: false, error: 'confirmation required, ask the user first' };
      const ch = findGuildChannel(guild, args.channel);
      if (!ch) return { ok: false, error: `channel not found: ${args.channel}` };
      const label = ch.name;
      await ch.delete();
      return { ok: true, deleted: label };
    }

    case 'create_role': {
      const color = args.color ? Number.parseInt(String(args.color).replace('#', ''), 16) : undefined;
      const role = await guild.roles.create({ name: args.name, color, hoist: args.hoist ?? false });
      return { ok: true, created: role.name, id: role.id };
    }

    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Modell
// ---------------------------------------------------------------------------
function systemPrompt(guild) {
  return [
    'Du bist der Server-Assistent von "ryuk hub" auf Discord.',
    'Du sprichst Deutsch, kurz und locker, aber nicht übertrieben.',
    'Du baust den Server direkt über deine Tools: Kategorien, Kanäle, Rollen.',
    'Der Nutzer schreibt normal, ohne Commands. Du machst daraus die Tool-Aufrufe.',
    '',
    'Regeln:',
    '- Kanalnamen dürfen Emoji enthalten, z. B. "💬・chat".',
    '- Standard-Kanaltypen: text, voice, announcement (Megafon).',
    '- Announcement braucht das Community-Feature. Wenn es nicht geht, als Text anlegen.',
    '- Vor delete_channel immer erst fragen und auf ein klares Ja warten.',
    '- Nach dem Bauen kurz zusammenfassen, was du gemacht hast. Keine langen Erklärungen.',
    '',
    `Server: ${guild.name} (${guild.id})`,
    `Kategorien: ${guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).map((c) => c.name).join(', ') || 'keine'}`,
  ].join('\n');
}

// Modell-Liste: erst das konfigurierte, dann die fallbacks. Wenn ein Modell
// ueberlastet ist (503) oder das Limit erreicht (429), nimmt der Bot das
// naechste, statt einfach zu sterben.
const DEFAULT_FALLBACKS = OPENAI_BASE_URL.includes('generativelanguage')
  ? 'gemini-3.5-flash-lite,gemini-2.5-flash'
  : '';
const FALLBACKS = (OPENAI_FALLBACK_MODELS || DEFAULT_FALLBACKS)
  .split(',').map((s) => s.trim()).filter(Boolean);
const MODELS = [...new Set([
  OPENAI_MODEL,
  ...FALLBACKS,
])];

async function callModelOnce(model, messages, tools) {
  const res = await fetch(`${OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.3 }),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (!res.ok) {
    const hint = res.status === 401 ? ' (API key invalid)' : res.status === 404 ? ' (model or base url wrong)' : '';
    const err = new Error(`api ${res.status}${hint}: ${(data && data.error && data.error.message) || text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error('api returned no message');
  return message;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

async function callModel(messages, tools) {
  let lastError;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callModelOnce(model, messages, tools);
      } catch (err) {
        lastError = err;
        if (!RETRY_STATUS.has(err.status)) throw err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (model !== MODELS[MODELS.length - 1]) {
      console.log(`model ${model} busy, trying next`);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const history = new Map();

function chunk(text, size = 1900) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) out.push(rest);
  return out;
}

async function handleMessage(message) {
  const guild = message.guild;
  if (!guild || guild.id !== DISCORD_GUILD_ID) return;

  if (AGENT_CHANNEL) {
    const wanted = AGENT_CHANNEL.replace(/^#/, '').toLowerCase();
    if (!message.channel.name?.toLowerCase().includes(wanted)) return;
  }

  if (message.author.id !== OWNER_DISCORD_ID) {
    await message.reply('Nur der Owner kann mit mir bauen.').catch(() => {});
    return;
  }

  const text = message.content.trim();
  if (!text) return;

  if (/^(reset|neu|clear|vergiss)$/i.test(text)) {
    history.delete(message.channel.id);
    await message.reply('Verlauf gelöscht.');
    return;
  }

  const key = message.channel.id;
  const messages = history.get(key) ?? [];
  messages.push({ role: 'user', content: text });

  await message.channel.sendTyping().catch(() => {});

  const actions = [];
  try {
    let final = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await callModel([{ role: 'system', content: systemPrompt(guild) }, ...messages], TOOLS);
      messages.push(reply);

      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        final = reply.content ?? '';
        break;
      }

      for (const call of reply.tool_calls) {
        let result;
        try {
          result = await execTool(guild, call.function.name, call.function.arguments);
        } catch (err) {
          result = { ok: false, error: err.message };
        }
        if (result.ok) {
          if (result.created) actions.push(`+ ${result.created}`);
          else if (result.renamed) actions.push(`~ ${result.renamed}`);
          else if (result.moved) actions.push(`> ${result.moved}`);
          else if (result.deleted) actions.push(`- ${result.deleted}`);
        } else if (!result.channels) {
          actions.push(`! ${result.error}`);
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 4000) });
      }
    }

    const lines = [];
    if (actions.length) lines.push(...actions, '');
    lines.push(final || 'Fertig.');
    const out = lines.join('\n').trim();

    for (const part of chunk(out)) await message.reply(part);

    // nur echte dialog-schritte behalten, keine tool-nachrichten
    const clean = messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 0))
      .map((m) => ({ role: m.role, content: m.content }));
    history.set(key, clean.slice(-MAX_HISTORY));
  } catch (err) {
    console.error(err);
    await message.reply(`Fehler: ${err.message}`).catch(() => {});
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`eingeloggt als ${c.user.tag}`);
  console.log(`server: ${DISCORD_GUILD_ID} | kanal: ${AGENT_CHANNEL || 'alle'}`);
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return;
  handleMessage(message).catch((err) => console.error(err));
});

client.login(DISCORD_TOKEN);
