# RS3 traveling merchant

This workflow is triggered by a cronjob to read the current stock of the traveling merchant from the [official wiki](https://runescape.wiki/w/Travelling_Merchant%27s_Shop) and send a notification through telegram.



## Requirements

* [A telegram bot](https://docs.n8n.io/integrations/credentials/telegram/)
* Configuring an environment variable `PERSONAL_TELEGRAM_ID` containing the user's telegram id
  * This workflow has been tested in the docker version of n8n and reads the environment through shell.