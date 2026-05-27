import { findByStoreName, findByName } from "@vendetta/metro";
import { after, unpatchAll } from "@vendetta/patcher";

const RelationshipStore = findByStoreName("RelationshipStore");
const { getSince, isFriend } = RelationshipStore;
const BioText = findByName("BioText", false);

function formatDate(timestamp: number): string {
return new Date(timestamp).toLocaleDateString(undefined, {
year: "numeric",
month: "short",
day: "numeric",
});
}

after("default", BioText, ([props], res) => {
if (!res?.props || !props.userId) return res;

const userId = props.userId;

if (!isFriend(userId)) return res;

const date = getSince(userId);
if (!date) return res;

const formatted = formatDate(date);
const extraLine = `\n\nFriends since: ${formatted}`;
const children = res.props.children;

const childrenStr = Array.isArray(children)
? children.join("")
: typeof children === "string"
? children
: "";

if (!childrenStr.includes(extraLine.trim())) {
if (typeof children === "string") {
res.props.children += extraLine;
} else if (Array.isArray(children)) {
children.push(extraLine);
} else {
res.props.children = [children, extraLine];
}
}

return res;
});

export const onUnload = () => {
unpatchAll();
};

