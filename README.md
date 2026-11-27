# Kozmos Trade

Turns any NPC token into a merchant in two clicks. Players trade on a barter scale where coins and goods sit on one balance, and skills, attitude and the merchant's own stat block move the numbers.

For Foundry VTT 14 and the dnd5e system 6.0 or newer. No other modules needed.

**Status:** in development. Not ready for play yet.

## Getting started

1. Select an NPC token on the map and click the **Shops** tool (store icon) in the token tools on the left. A bar at the top offers **Set up as a shop**. The store button in the token HUD does the same.
2. Pick what it sells (the archetype) and how wealthy the shop is.
3. Click **Stock and open** to roll a fresh shelf from the compendiums, or **Open with its own items** to sell what the NPC already carries.

Players can now trade with it. They walk up to its token and press the Trade button that appears, or use an Open Shop card or a `@Trade[...]` link in a journal.

## How the windows work

Everything opens one of two windows: the **barter window** to trade, or **Configure shop** to set a shop up. In both, fields wait for **Save**, and actions that happen at once sit in the window menu at the top right.

## One person, or a kind of merchant

Configure shop shows **Who is this merchant?** with a **Change** button.

- **One person: the same shop on every map.** For a named NPC such as a traveling peddler or the town smith. Every token of that NPC is the same shop, with the same stock, purse and memory of its customers.
- **A kind of merchant: every token is its own shop.** For commoners and market stalls. Set it up once on the actor in the Actors sidebar, then each token you place is its own shop. Tick **Roll new stock for each token** and every token rolls its own shelf the first time someone trades there.

A shop set up on an unlinked token lives on that token only, so deleting the token deletes the shop. Choose One person to move it onto the actor.

## Running a shop

- **The Shops window** (store icon in the token tools) lists every shop, grouped as This scene, Other scenes and Not on a map. Each row has **Open** or **Closed**, **Show on the map** and **Trade**. Click a shop to configure it, or right-click it for Show to players, Post Open Shop card, Restock and Stop being a shop. A line at the top counts the market rules in force, with **Edit**.
- **Token HUD:** the scales button opens a trade. Right-click it for Configure shop.
- **Configure shop** has three tabs. **Shop** holds the status, what it sells, the rules and who the merchant is. **Shelf** sets prices and pins, restocks, and shows the Wanted board. **Customers** holds each customer's attitude and the last 50 trades, with **Revert**.
- **In the barter window**, the GM's menu opens Configure shop, restocks, shows the shop to players, and switches between Instant Trade and GM Approval. To undo a trade, click **Revert** on its receipt in chat.

## Trading between players

Players open the **Shops** window and click **Trade** next to someone in their party, or drag an item from their sheet onto another player's token. The other player gets an invite to answer with **Trade** or **Not now**. Both put up items and coins, and the trade goes through when both press **Accept**.

## Removing a shop

Open Configure shop and choose **Stop being a shop** in its window menu, or right-click the shop in the Shops window. The NPC keeps its items. Tick **Also forget its shop records** to clear its prices, pins, attitude, ledger and Wanted board as well. Otherwise they come back if you turn the shop on again.

## Settings

**Features** (in Configure Settings) picks a complexity preset (Simple, Standard or Crunchy), turns single features on or off, such as haggling, appraisal, the Wanted board, market rules and theft, and sets the rules for every trade. Theft is off in every preset.

**No trading during combat** is on by default: while a character or the merchant fights in a combat that has started, players can't start a trade. Trades already open can finish, and the GM can always trade.
