import { registerCommand } from "@vendetta/commands";
import { findByProps } from "@vendetta/metro";

const messageUtil = findByProps("sendMessage", "editMessage");
const UserSettingsActionCreators = findByProps("FrecencyUserSettingsActionCreators");

function getMessage() {
    const frecencyStore = UserSettingsActionCreators?.FrecencyUserSettingsActionCreators?.getCurrentValue?.();
    
    if (!frecencyStore?.favoriteGifs?.gifs) {
        return "❌ You don't have any favorite GIFs! Add some by favoriting GIFs in Discord first.";
    }

    const gifsArray = Object.keys(frecencyStore.favoriteGifs.gifs);
    
    if (gifsArray.length === 0) {
        return "❌ You don't have any favorite GIFs! Add some by favoriting GIFs in Discord first.";
    }

    const chosenGifUrl = gifsArray[Math.floor(Math.random() * gifsArray.length)];
    
    return chosenGifUrl;
}

let unregisterCommand;

export default {
    onLoad: () => {
        unregisterCommand = registerCommand({
            name: "gifroulette",
            displayName: "GIF Roulette",
            description: "Sends a random GIF from your favorites",
            options: [],
            execute: async (args, ctx) => {
                const content = getMessage();
                
                messageUtil.sendMessage(
                    ctx.channel.id,
                    { content: content },
                    void 0,
                    { nonce: Date.now().toString() }
                );
            },
            applicationId: "-1",
            inputType: 1,
            type: 1,
        });
    },
    
    onUnload: () => {
        if (unregisterCommand) {
            unregisterCommand();
        }
    }
};
