require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const SAFESWAP_URL = "https://iugmersbynconrfwandv.supabase.co";
const SAFESWAP_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z21lcnNieW5jb25yZndhbmR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMjM0NzUsImV4cCI6MjA5MDc5OTQ3NX0.zcxDFMbXJJcBGxUQNMxT_KkZTeNnomZ-RhZ8sDTTNd8";

const MAX_PRICE = 0.03; // 3 pence in pounds
const PAGE_SIZE = 10;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ---- SafeSwap API ----

async function fetchDeals(maxPrice, gameFilter, sortOrder) {
  const params = new URLSearchParams({
    select: "id,name,game,price,rarity,seller,stock,featured,image_url,created_at",
    hidden: "eq.false",
    sold: "eq.false",
    stock: "gt.0",
    price: `lt.${maxPrice}`,
  });

  if (gameFilter) {
    params.set("game", `eq.${gameFilter}`);
  }

  const order = sortOrder === "newest" ? "created_at.desc" : "price.asc";
  params.set("order", order);
  params.set("limit", "500");

  const url = `${SAFESWAP_URL}/rest/v1/listings?${params}`;

  const res = await fetch(url, {
    headers: {
      apikey: SAFESWAP_KEY,
      Authorization: `Bearer ${SAFESWAP_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`SafeSwap API returned ${res.status}`);
  }

  return res.json();
}

function formatPrice(p) {
  if (p < 1) {
    return `${Math.round(p * 100)}p`;
  }
  return `£${p.toFixed(2)}`;
}

function buildDealsEmbed(deals, page, total, gameFilter, sortOrder) {
  const start = page * PAGE_SIZE;
  const pageDeals = deals.slice(start, start + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(0x2b7fff)
    .setTitle("SafeSwap Deals Under 3p")
    .setDescription(
      `${total} deal${total !== 1 ? "s" : ""} found` +
        (gameFilter ? ` for **${gameFilter}**` : "") +
        ` · sorted by ${sortOrder === "newest" ? "newest" : "lowest price"}`
    )
    .setTimestamp()
    .setFooter({ text: `Page ${page + 1} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}` });

  if (pageDeals.length === 0) {
    embed.addFields({
      name: "No deals on this page",
      value: "Try a different page or filter.",
    });
    return embed;
  }

  for (const d of pageDeals) {
    const featuredTag = d.featured ? " ⭐" : "";
    const rarityTag = d.rarity ? ` · ${d.rarity}` : "";
    const stockTag = d.stock > 1 ? ` · x${d.stock} in stock` : "";
    const link = `https://www.safeswap.gg/listing/${d.id}`;
    embed.addFields({
      name: `${formatPrice(d.price)} — ${d.name}${featuredTag}`,
      value: `${d.game}${rarityTag}${stockTag} · [View listing](${link})`,
    });
  }

  return embed;
}

function buildNavRow(page, total) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("deals_prev")
      .setLabel("◀ Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId("deals_next")
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= maxPage),
    new ButtonBuilder()
      .setCustomId("deals_refresh")
      .setLabel("🔄 Refresh")
      .setStyle(ButtonStyle.Primary)
  );
}

// ---- Slash command registration ----

const commands = [
  new SlashCommandBuilder()
    .setName("deals")
    .setDescription("Find SafeSwap deals under 3p")
    .addStringOption((opt) =>
      opt
        .setName("game")
        .setDescription("Filter by game (e.g. Adopt Me, Pet Sim 99, Blox Fruits)")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("sort")
        .setDescription("Sort order")
        .setRequired(false)
        .addChoices(
          { name: "Lowest price", value: "price" },
          { name: "Newest first", value: "newest" }
        )
    )
    .addNumberOption((opt) =>
      opt
        .setName("max_price")
        .setDescription("Maximum price in pounds (default 0.03 = 3p)")
        .setRequired(false)
    ),
];

// ---- Bot state: store fetched deals per interaction for pagination ----

const dealCache = new Map(); // interactionId -> { deals, page, game, sort, maxPrice, total }

// ---- Events ----

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  // ---- Slash command: /deals ----
  if (interaction.isChatInputCommand() && interaction.commandName === "deals") {
    await interaction.deferReply();

    const game = interaction.options.getString("game") || null;
    const sort = interaction.options.getString("sort") || "price";
    const maxPrice = interaction.options.getNumber("max_price") || MAX_PRICE;

    try {
      const deals = await fetchDeals(maxPrice, game, sort);
      const total = deals.length;

      if (total === 0) {
        await interaction.editReply({
          content: `No deals found under ${formatPrice(maxPrice)}${game ? ` for ${game}` : ""}.`,
        });
        return;
      }

      const embed = buildDealsEmbed(deals, 0, total, game, sort);
      const row = buildNavRow(0, total);

      const reply = await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      dealCache.set(reply.id, {
        deals,
        page: 0,
        game,
        sort,
        maxPrice,
        total,
      });
    } catch (err) {
      console.error(err);
      await interaction.editReply({
        content: "Could not fetch deals from SafeSwap right now. Try again later.",
      });
    }
    return;
  }

  // ---- Button interactions for pagination ----
  if (interaction.isButton()) {
    const cached = dealCache.get(interaction.message.id);
    if (!cached) {
      await interaction.reply({
        content: "This deal list has expired. Run /deals again to get fresh results.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === "deals_refresh") {
      await interaction.deferUpdate();
      try {
        cached.deals = await fetchDeals(cached.maxPrice, cached.game, cached.sort);
        cached.total = cached.deals.length;
        cached.page = 0;
      } catch (err) {
        console.error(err);
        await interaction.editReply({
          content: "Failed to refresh deals.",
          embeds: [],
          components: [],
        });
        return;
      }
    } else if (interaction.customId === "deals_prev") {
      await interaction.deferUpdate();
      cached.page = Math.max(0, cached.page - 1);
    } else if (interaction.customId === "deals_next") {
      await interaction.deferUpdate();
      const maxPage = Math.max(0, Math.ceil(cached.total / PAGE_SIZE) - 1);
      cached.page = Math.min(maxPage, cached.page + 1);
    }

    const embed = buildDealsEmbed(
      cached.deals,
      cached.page,
      cached.total,
      cached.game,
      cached.sort
    );
    const row = buildNavRow(cached.page, cached.total);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
