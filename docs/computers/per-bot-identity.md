# Per-bot identity

Grok connectors are account-wide. One OAuth login is stored for the Grok account and shared by every bot on that account. After a computer is bound to that login, every bot would share the same computer.

`FLOK_PER_BOT_KEYS` defaults to off. With the flag off, the OAuth token stays bound to one computer, as it does today.

With the flag on:

- The OAuth token is the account. It carries the subject, the flock, and billing. It does not authorize `computer_*`.
- A bot key is a capability minted for one computer. The raw key is returned once and stored only as a digest.
- The first time a bot calls `computer_pair` with no arguments, it receives a pair code and an `approve_url`. A signed-in human opens that page, names the bot, and picks or buys its computer. The bot calls `computer_pair` again with the pair code and receives `capability_token`.
- One live key occupies a computer. Approving that computer for another bot revokes the previous key.
- The bot should keep the pair code and the capability token in its own memory. A key copied into Grok's shared workspace or into account-wide secrets can be used by another of the owner's bots. Handing a key to a helper bot on purpose is allowed.

Idle and out-of-hours still suspend the devbox, so the disk stays. A devbox that cannot resume is rebuilt, and the tool call tells the bot that files from before are gone before that replacement is used.
