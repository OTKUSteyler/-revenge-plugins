/*
 * Kettu port of Vencord's NoTypingAnimation / SilentTyping-style behavior
 * Original: Vencord (c) 2023 Vendicated and contributors — GPL-3.0-or-later
 */

import { instead } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";

const patches: Array<() => void> = [];


const TypingStore = findByProps("getTypingUsers");
if (TypingStore) {
    patches.push(instead("getTypingUsers", TypingStore, () => ({})));
}

export const onUnload = () => {
    patches.forEach((unpatch) => unpatch());
    patches.length = 0;
};
