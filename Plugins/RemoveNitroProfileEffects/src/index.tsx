import { after } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.removeEffect ??= true;
storage.exemptFriends ??= true;
storage.effectExceptions ??= [];

let patches = [];

const isFriend = (id) => {
  if (!id) return false;
  try {
    const store = findByStoreName("RelationshipStore");
    if (!store) return false;
    if (store.isFriend) return store.isFriend(id);
    return store.getRelationshipType?.(id) === 1;
  } catch {
    return false;
  }
};

const isExempt = (id) => {
  if (!id) return false;
  const strId = String(id);
  if (storage.effectExceptions.includes(strId)) return true;
  if (storage.exemptFriends && isFriend(strId)) return true;
  return false;
};

// Field names for the profile effect can vary by client build — confirm
// via debugger against a live getUserProfile() result if this list needs
// adjusting.
const EFFECT_FIELDS = ["profileEffectID", "profileEffectId"];

// Returns a shallow clone with effect fields nulled — never mutates the
// original, since Discord's profile records are frequently frozen and a
// direct assignment silently no-ops (or throws, which safe() swallows).
const stripEffectFields = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  const clone = { ...obj };
  for (const f of EFFECT_FIELDS) clone[f] = null;
  if ("profileEffect" in clone) clone.profileEffect = null;
  return clone;
};

// Server-specific ("per-guild") profiles can carry their own overrides,
// nested under a key that's commonly `guildMemberProfile`. If the field
// name differs on your client build, inspect a live getUserProfile()
// result in the debugger and adjust the key below.
const GUILD_PROFILE_KEY = "guildMemberProfile";

const applyEffectState = (profile, id) => {
  if (!profile || typeof profile !== "object" || !id) return profile;
  if (!storage.removeEffect || isExempt(id)) return profile;

  let result = stripEffectFields(profile);

  if (result[GUILD_PROFILE_KEY]) {
    result = {
      ...result,
      [GUILD_PROFILE_KEY]: stripEffectFields(result[GUILD_PROFILE_KEY]),
    };
  }

  return result;
};

const safe = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};

function Settings() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [input, setInput] = React.useState("");
  const { FormSwitchRow, FormInput, FormRow, FormSection, FormDivider } = Forms;
  const { View, TouchableOpacity, Text } = ReactNative;
  const { ScrollView } = findByProps("ScrollView");
  const h = React.createElement;
  const UserStore = findByStoreName("UserStore");

  const addException = () => {
    const id = input.trim();
    if (!id) return;
    if (!/^\d+$/.test(id)) {
      showToast("Enter a valid user ID");
      return;
    }
    if (storage.effectExceptions.includes(id)) {
      showToast("Already in the list");
      return;
    }
    storage.effectExceptions.push(id);
    setInput("");
    forceUpdate();
    showToast("Added to exceptions");
  };

  const removeException = (id) => {
    storage.effectExceptions = storage.effectExceptions.filter((x) => x !== id);
    forceUpdate();
  };

  return h(
    ScrollView, // switched from View to ScrollView cuz someone forgot
    { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 24 } },
    h(
      View,
      null,
      h(
        FormSection,
        { title: "General" },
        h(FormSwitchRow, {
          label: "Remove profile effects",
          subLabel: "Strips Nitro profile effects from users everywhere, including server profiles",
          value: storage.removeEffect,
          onValueChange: (v) => {
            storage.removeEffect = v;
            forceUpdate();
          },
        }),
        h(FormSwitchRow, {
          label: "Keep friends' effects",
          subLabel: "Friends are automatically whitelisted",
          value: storage.exemptFriends,
          onValueChange: (v) => {
            storage.exemptFriends = v;
            forceUpdate();
          },
        })
      ),
      h(
        FormSection,
        { title: "Other exceptions" },
        h(FormInput, {
          title: "User ID",
          placeholder: "Add a non-friend's user ID to keep their effect",
          value: input,
          onChange: setInput,
          onSubmitEditing: addException,
          returnKeyType: "done",
        }),
        h(
          TouchableOpacity,
          {
            onPress: addException,
            style: {
              marginHorizontal: 16,
              marginTop: 8,
              marginBottom: 4,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: "#5865F2",
              alignItems: "center",
            },
          },
          h(Text, { style: { color: "#fff", fontWeight: "600" } }, "Add User ID")
        ),
        h(FormDivider, null),
        storage.effectExceptions.length === 0 &&
          h(FormRow, { label: "No manual exceptions added" }),
        ...storage.effectExceptions.map((id) => {
          const user = UserStore?.getUser?.(id);
          return h(FormRow, {
            key: id,
            label: user?.username ?? id,
            subLabel: id,
            onPress: () => removeException(id),
          });
        })
      )
    )
  );
}

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());

    const applyPatches = () => {
      unloadPatches();
      patches = [];

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? res.user?.id ?? args?.[0];
            let next = applyEffectState(res, id);
            if (next.user) next = { ...next, user: applyEffectState(next.user, id) };
            return next;
          }))
        );
      }

      // Separate store some clients use specifically for per-guild member
      // profiles (server-specific effect/bio overrides). Not always present.
      const guildMemberProfileStore = findByStoreName("GuildMemberProfileStore");
      if (guildMemberProfileStore?.getGuildMemberProfile) {
        patches.push(
          after("getGuildMemberProfile", guildMemberProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? args?.[1] ?? args?.[0];
            return applyEffectState(res, id);
          }))
        );
      }

      const profileEffectMod = findByProps("getUserProfileEffectURL");
      if (profileEffectMod?.getUserProfileEffectURL) {
        patches.push(
          after("getUserProfileEffectURL", profileEffectMod, safe((args, url) => {
            const id = args?.[0]?.id ?? args?.[0];
            if (!storage.removeEffect || isExempt(id)) return url;
            return null;
          }))
        );
      }

      const hookMod = findByProps("useProfileEffect");
      if (hookMod?.useProfileEffect) {
        patches.push(
          after("useProfileEffect", hookMod, safe((args, res) => {
            const id = args?.[0];
            if (!storage.removeEffect || isExempt(id)) return res;
            return null;
          }))
        );
      }
    };

    applyPatches();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
  settings: Settings,
};
