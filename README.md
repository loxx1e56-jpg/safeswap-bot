# SafeSwap Deals Bot

A Discord bot that finds SafeSwap listings under 3 pence.

## Setup

1. Create a bot on the [Discord Developer Portal](https://discord.com/developers/applications)
2. Copy the bot token and add it to a `.env` file:
   ```
   DISCORD_TOKEN=your_token_here
   ```
3. Install dependencies: `npm install`
4. Start the bot: `npm start`

## Commands

- `/deals` — show all listings under 3p, cheapest first
- `/deals game: Adopt Me` — filter by game
- `/deals sort: Newest first` — sort by newest listings
- `/deals max_price: 0.05` — change the price cap

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token (required) |
