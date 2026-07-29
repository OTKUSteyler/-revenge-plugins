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
const originalEffects = new Map();

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

// Discord stores the profile effect on the profile object under
// `profileEffectID` (and sometimes a nested `profileEffect` object with
// `id` / `expiresAtMs`). Adjust the field names below if a client update
// changes them — pop open the debugger and inspect a UserProfileStore
// result to confirm.
const EFFECT_FIELDS = ["profileEffectID", "profileEffectId"];

const applyEffectState = (obj, id) => {
  if (!obj || typeof obj !== "object" || !id) return obj;
  const shouldHide = storage.removeEffect && !isExempt(id);

  if (shouldHide) {
    const hasEffect = EFFECT_FIELDS.some((f) => obj[f]) || obj.profileEffect;
    if (hasEffect) {
      if (!originalEffects.has(id)) {
        const saved = {};
        for (const f of EFFECT_FIELDS) saved[f] = obj[f] ?? null;
        saved.profileEffect = obj.profileEffect ?? null;
        originalEffects.set(id, saved);
      }
      for (const f of EFFECT_FIELDS) obj[f] = null;
      obj.profileEffect = null;
    }
  } else if (originalEffects.has(id)) {
    const orig = originalEffects.get(id);
    for (const f of EFFECT_FIELDS) {
      if (obj[f] === null) obj[f] = orig[f];
    }
    if (obj.profileEffect === null) obj.profileEffect = orig.profileEffect;
  }
  return obj;
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
    View,
    null,
    h(
      FormSection,
      { title: "General" },
      h(FormSwitchRow, {
        label: "Remove profile effects",
        subLabel: "Strips Nitro profile effects from users everywhere",
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
  );
}

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());

    const applyPatches = () => {
      unloadPatches();
      patches = [];

      const userStore = findByStoreName("UserStore");
      if (userStore?.getUser) {
        patches.push(
          after("getUser", userStore, safe((args, res) => {
            if (!res) return res;
            applyEffectState(res, res.id);
            return res;
          }))
        );
      }

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? res.user?.id ?? args?.[0];
            applyEffectState(res, id);
            if (res.user) applyEffectState(res.user, id);
            return res;
          }))
        );
      }

      // Some clients expose a dedicated store for cosmetics/collectibles —
      // grab it if present so avatar decorations aren't accidentally
      // affected, only the profile effect layer.
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
