# Kozmos Trade

Turns any NPC token into a merchant in two clicks. Players trade on a barter scale where coins and goods sit on one balance, and skills, attitude and the merchant's own stat block move the numbers.

For Foundry VTT 14 and the dnd5e system 6.0 or newer. No other modules needed.

**Status:** in development. Not ready for play yet.

## Getting started

1. Select an NPC token and click **Configure the selected shop** in the token tools on the left. The store button in the token HUD does the same.
2. Choose whether it is one person or a kind of merchant (see below), then pick what it sells (the archetype) and how wealthy it is.
3. Click **Generate stock and open** to roll a fresh shelf from the compendiums, or **Open with its own items** to sell what the NPC already carries.

Players can now trade with it. They walk up to its token and press the Trade button that appears, or use an Open Shop card or a `@Trade[...]` link in a journal.

## One person, or a kind of merchant

Configure Shop asks **Who is this merchant?**

- **One person: the same shop on every map.** For a named NPC such as a traveling peddler or the town smith. Every token of that NPC is the same shop, with the same stock, purse and memory of its customers.
- **A kind of merchant: every token is its own shop.** For commoners and market stalls. Set it up once on the actor in the Actors sidebar, then each token you place is its own shop. Tick **Roll new stock for each token** and every token rolls its own shelf the first time someone trades there.

A shop set up on an unlinked token lives on that token only, so deleting the token deletes the shop. Choose One person to move it onto the actor.

## Running a shop

- **Left toolbar:** in the token tools, **Shops** lists every shop. For the GM, **Open the selected shop** and **Configure the selected shop** work on the NPC token you have selected.
- **Token HUD:** the scales button opens the shop. Right-click it for Configure Shop.
- **Configure Shop** has five tabs. **Shop** holds the status, what it sells, the rules, and buttons to show it to players or post an Open Shop card. **Shelf** sets prices and pins. **Attitude**, **Wanted** and **Ledger** hold each customer's standing, the Wanted board and the last 50 trades.
- **In the barter window**, the GM tools switch between Instant Trade and GM Approval, show the shop to players, restock, undo the last trade, and open Configure Shop.
- **Shops list:** the store tool in the token controls lists every shop, with Market rules for the GM.
- **Actors sidebar:** right-click an NPC to set up, configure, show or remove a shop.

## Removing a shop

Open Configure Shop, go to the **Shop** tab and click **Stop being a shop**, or right-click the actor in the Actors sidebar. The NPC keeps its items. Tick **Also forget its shop records** to clear its prices, pins, attitude, ledger and Wanted board as well. Otherwise they come back if you turn the shop on again.

## Settings

The **Complexity** setting picks a preset (Simple, Standard or Crunchy). **Feature toggles** turns single features on or off on top of it, such as haggling, appraisal, the Wanted board, market rules and theft. Theft is off in every preset.
