import { findByProps } from "@vendetta/metro";
import { instead } from "@vendetta/patcher";

const MessageActions = findByProps("pinMessage", "unpinMessage");
const Alerts = findByProps("show", "close", "openLazy");

const PIN_TITLES = [
    "Pin Message",
    "Nachricht anpinnen",
    "Épingler le message",
    "Fijar mensaje",
    "Fissa messaggio",
    "Bericht vastmaken",
    "Fixera meddelande",
    "Fastgør besked",
    "Fest melding",
    "Kiinnitä viesti",
    "Rögzítsd az üzenetet",
    "Przypnij wiadomość",
    "Fixar mensagem",
    "Закрепить сообщение",
    "メッセージをピン留め",
    "固定消息",
    "메시지 고정",
    "Sabitle mesajı",
    "Prikvači poruku",
    "Prikvačite poruku",
    "Mesajı Sabitle",
    "Anexar mensagem",
    "Pripnúť správu",
    "Připnout zprávu",
    "Закріпити повідомлення",
    "ปักหมุดข้อความ",
    "Ghim tin nhắn",
    "Sematkan Pesan",
];

let patches: (() => void)[] = [];

export default {
    name: "BypassPinPrompt",
    description: "Bypass the confirmation prompt when pinning or unpinning messages.",
    authors: [
        { name: "btmc727 (ported)" },
        { name: "thororen (original)" },
    ],

    onLoad() {
        if (!MessageActions || !Alerts) return;

        patches.push(
            instead("show", Alerts, (args, orig) => {
                const alert = args[0];
                const title: string = alert?.title ?? "";

                if (PIN_TITLES.includes(title)) {
                    const confirmAction = alert?.confirmText
                        ? alert?.onConfirm ?? alert?.actions?.find((a: any) => a.preferred)?.onPress
                        : null;
                    confirmAction?.();
                    return;
                }

                return orig(...args);
            })
        );
    },

    onUnload() {
        patches.forEach(p => p());
        patches = [];
    },
};
