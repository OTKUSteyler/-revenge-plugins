import { registerCommand } from "@vendetta/commands";
import { findByProps } from "@vendetta/metro";
import { fetchImage } from "./utils";

const { sendBotMessage } = findByProps("sendBotMessage");

let konoSelf = registerCommand({
  name: "konoSelf",
  displayName: "konoSelf",
  description: "Fetch a random image from KonoChan for yourself.",
  displayDescription: "Fetch a random image from KonoChan for yourself.",
  options: [
    {
      name: "nsfw",
      description: "Include NSFW content?",
      type: 5,
      required: false,
      displayName: "nsfw",
      displayDescription: "Include NSFW content?",
    },
  ],
  execute: async function (args, ctx) {
    const options = new Map(args.map((option) => [option.name, option]));
    const isNSFW = options.get("nsfw")?.value || false;

    const imageUrl = await fetchImage(isNSFW);

    if (!imageUrl) {
      sendBotMessage(ctx.channel.id, "No image found. Try again later.");
      return;
    }

    sendBotMessage(ctx.channel.id, `Here's your random image: ${imageUrl}`);
    return;
  },
  // @ts-ignore
  applicationId: "-1",
  inputType: 1,
  type: 1,
});

export default konoSelf;

