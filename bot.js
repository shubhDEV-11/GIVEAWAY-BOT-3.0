import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import cors from "cors";

const app = express();

// Allow frontend URL to communicate with backend
app.use(cors({ origin: "https://giveaway-bot-3-0.onrender.com" }));
app.use(bodyParser.json());

// Serve static files (optional if hosting frontend separately)
app.use(express.static("public"));

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;      // Your Telegram Bot Token
const CHANNEL_ID = process.env.CHANNEL_ID;    // Telegram Channel ID (-100xxxxxxxx)
const ADMIN_ID = process.env.ADMIN_ID;        // Your Telegram ID

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const DB_FILE = "giveaways.json";

// Load giveaways from file
let giveaways = [];
if (fs.existsSync(DB_FILE)) {
  giveaways = JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(giveaways, null, 2));
}

// Helper: format duration for display
function durationToString(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

// Helper: pick random winners
function pickWinners(giveaway) {
  const winners = [];
  const participants = [...giveaway.participants];
  for (let i = 0; i < giveaway.winners && participants.length > 0; i++) {
    const idx = Math.floor(Math.random() * participants.length);
    winners.push(participants[idx]);
    participants.splice(idx, 1);
  }
  return winners;
}

// =====================
// POST /create-giveaway
// =====================
app.post("/create-giveaway", async (req, res) => {
  try {
    const { title, prize, duration, winners } = req.body;
    if (!title || !prize || !duration || !winners)
      return res.status(400).send({ status: "error", msg: "Missing fields" });

    const endTime = Date.now() + duration * 1000;
    const giveaway = { id: giveaways.length + 1, title, prize, duration, endTime, winners, participants: [] };
    giveaways.push(giveaway);
    saveDB();

    const msgText = `
🎉 *${title}*

🏆 Prize: ${prize}
🎯 Number of Winners: ${winners}
⏳ Duration: ${durationToString(duration)}

Click below to join the giveaway!
`;

    const sentMsg = await bot.sendMessage(CHANNEL_ID, msgText, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🎁 Join Giveaway", callback_data: `join_${giveaway.id}` }]]
      }
    });

    giveaway.message_id = sentMsg.message_id;
    saveDB();

    // Schedule automatic end
    setTimeout(() => endGiveaway(giveaway.id), duration * 1000);

    res.send({ status: "success" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "error", msg: "Server error" });
  }
});

// =====================
// Handle Join Button
// =====================
bot.on("callback_query", (query) => {
  const data = query.data;
  const userId = query.from.id;
  const username = query.from.username || query.from.first_name;

  if (!data.startsWith("join_")) return;

  const giveawayId = parseInt(data.split("_")[1]);
  const giveaway = giveaways.find(g => g.id === giveawayId);
  if (!giveaway) return bot.answerCallbackQuery(query.id, { text: "Giveaway not found" });

  if (giveaway.participants.find(p => p.userId === userId))
    return bot.answerCallbackQuery(query.id, { text: "You already joined!" });

  giveaway.participants.push({ userId, username });
  saveDB();

  bot.answerCallbackQuery(query.id, { text: "✅ You joined the giveaway!" });
});

// =====================
// End Giveaway
// =====================
function endGiveaway(id) {
  const giveaway = giveaways.find(g => g.id === id);
  if (!giveaway) return;

  if (giveaway.participants.length === 0) {
    bot.sendMessage(CHANNEL_ID, `❌ Giveaway "${giveaway.title}" ended with no participants.`);
    return;
  }

  const winners = pickWinners(giveaway);
  let winnerText = `🏆 Giveaway "${giveaway.title}" has ended!\n\n🎉 Winners:\n`;
  winners.forEach((w, i) => (winnerText += `${i + 1}. @${w.username}\n`));

  bot.sendMessage(CHANNEL_ID, winnerText);
}

// =====================
// Admin command: manual pick (optional)
// =====================
bot.onText(/\/pickwinner (\d+)/, (msg, match) => {
  if (msg.from.id != ADMIN_ID) return;
  const giveawayId = parseInt(match[1]);
  const giveaway = giveaways.find(g => g.id === giveawayId);
  if (!giveaway) return bot.sendMessage(ADMIN_ID, "Giveaway not found");

  if (giveaway.participants.length === 0) return bot.sendMessage(ADMIN_ID, "No participants yet.");

  const winners = pickWinners(giveaway);
  let text = `🏆 Winners for "${giveaway.title}":\n\n`;
  winners.forEach((w, i) => (text += `${i + 1}. @${w.username}\n`));
  bot.sendMessage(CHANNEL_ID, text);
  bot.sendMessage(ADMIN_ID, text);
});

// =====================
// Start server
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
